const { EventEmitter } = require("events");
const config = require("./config");
const cache = require("./cache");
const { RoonService } = require("./roon");
const { DiscordIpcService } = require("./discord");
const { buildActivity } = require("./activity");
const { upload: uploadImage } = require("./images");
const constants = require("./constants");
const { createLogger, getBuffer, setOnLog } = require("./logger");

const log = createLogger("App");

class AppController extends EventEmitter {
  constructor() {
    super();
    this.roon = null;
    this.discord = null;

    // Zone tracking state
    this._lastImageKey = null;
    this._lastTrackKey = null;
    this._lastActiveZoneId = null;
    this._lastState = null;
    this._updateInProgress = false;
    this._pendingZoneRetry = false;
    this._pauseTimer = null;
    this._hasSeenPlaying = false;
    this._lastSeekPosition = null;
    this._lastUpdateTime = null;
    this._zonePlayStartTimes = {};
    this._lastActivity = null;
    this._lastEmitTime = 0; // Throttle GUI state updates

    // Connection status
    this._roonStatus = "disconnected";
    this._discordStatus = "disconnected";
    this._roonDisconnectTimer = null;
    this._uiDebounceTimer = null; // Debounce UI state to avoid flashing on quick reconnects

    // Wire log callback
    setOnLog((entry) => this.emit("log", entry));
  }

  // ─── Public getters ───

  getState() {
    return {
      roon: this._roonStatus,
      discord: this._discordStatus,
      activeZone: this._buildActiveZoneInfo(),
      zones: this._buildZoneList(),
      lastActivity: this._lastActivity,
      coreHttpBase: this.roon?.coreHttpBase || null,
    };
  }

  getConfig() {
    return config.get();
  }

  updateConfig(patch) {
    const cfg = config.get();
    for (const [section, values] of Object.entries(patch)) {
      if (cfg[section] && typeof values === "object") {
        Object.assign(cfg[section], values);
      }
    }
    config.save();
    log.info("Configuration updated");
    this._emitState();
    return cfg;
  }

  getCache() {
    return cache.getAll();
  }

  clearCache() {
    cache.clear();
    log.info("Cache cleared");
    this.emit("cache-changed", []);
  }

  removeCacheEntry(key) {
    cache.remove(key);
    log.info(`Cache entry removed: ${key}`);
    this.emit("cache-changed", cache.getAll());
  }

  getLogs() {
    return getBuffer();
  }

  // ─── Lifecycle ───

  async start() {
    config.load();
    cache.load();

    const cfg = config.get();

    log.debug(`CWD: ${process.cwd()}`);

    // Start Roon
    this.roon = new RoonService({
      onZoneChanged: (zones) => {
        this._handleZoneChanged(zones).catch((err) =>
          log.error("Zone handler error:", err.message)
        );
      },
      onCoreLost: () => {
        // Only log as WARN on genuine disconnects (not quick Roon Core reconnect cycles)
        if (this._roonStatus === "connected") {
          log.debug("Roon Core connection cycle");
        } else {
          log.warn("Lost connection to Roon Core");
        }
        this._roonStatus = "disconnected";

        // Debounce UI notification — only show disconnected if still down after 2s
        // This prevents UI flashing during Roon Core's periodic ~30s reconnect cycle
        if (!this._uiDebounceTimer) {
          this._uiDebounceTimer = setTimeout(() => {
            this._uiDebounceTimer = null;
            if (this._roonStatus === "disconnected") {
              this._emitState();
            }
          }, 2000);
        }

        // Grace period: wait before clearing activity (auto-reconnect may restore quickly)
        if (!this._roonDisconnectTimer) {
          this._roonDisconnectTimer = setTimeout(() => {
            this._roonDisconnectTimer = null;
            // Still disconnected after grace period — clear activity
            if (this._roonStatus === "disconnected") {
              log.info("Roon disconnect grace period expired, clearing activity");
              this._clearPauseTimer();
              if (this.discord?.connected) {
                this.discord.clearActivity().catch(() => {});
              }
              this._lastState = "stopped";
              this._lastActivity = null;
              this._emitState();
            }
          }, 10000);
        }
      },
    });

    this.roon.start(cfg.roon.coreAddress || undefined, { debug: cfg.logging.debug });

    // Start Discord
    this.discord = new DiscordIpcService(cfg.discord.clientId, cfg.discord.pipeNumber);

    this.discord.onDisconnected = () => {
      this._discordStatus = "disconnected";
      this._emitState();
    };

    this.discord.onReconnected = async () => {
      this._discordStatus = "connected";
      this._emitState();
      if (!this.roon || !this._lastActiveZoneId) return;
      const zone = this.roon.zones[this._lastActiveZoneId];
      if (!zone || !zone.now_playing) return;
      if (zone.state !== "playing" && zone.state !== "paused") return;

      let coverArtUrl = zone.now_playing.image_key
        ? cache.get(zone.now_playing.image_key)
        : null;
      const activity = buildActivity(zone, coverArtUrl);
      if (activity) {
        await this.discord.setActivity(activity);
        log.info(`Resent activity after Discord reconnect [${zone.display_name}]`);
      }
    };

    try {
      await this.discord.connect();
      this._discordStatus = "connected";
    } catch {
      log.warn("Discord not running yet, will reconnect automatically");
      this.discord._autoReconnect = true;
      this.discord._scheduleReconnect();
    }

    this._emitState();
    log.info("Monitoring all zones");
    log.info(`Pause timeout: ${cfg.display.pauseTimeout}s`);
    log.info("Waiting for playback events...");
  }

  async stop() {
    log.info("Shutting down...");
    this._clearPauseTimer();
    if (this._uiDebounceTimer) {
      clearTimeout(this._uiDebounceTimer);
      this._uiDebounceTimer = null;
    }
    if (this._roonDisconnectTimer) {
      clearTimeout(this._roonDisconnectTimer);
      this._roonDisconnectTimer = null;
    }
    if (this.discord) {
      if (this.discord.connected) {
        await this.discord.clearActivity();
      }
      this.discord.disconnect();
    }
    this.roon?.stop();
  }

  // ─── Zone logic (ported from index.js) ───

  _findActiveZone(zones) {
    const allZones = Object.values(zones);

    const playingZones = allZones.filter(
      (z) => z.state === "playing" && z.now_playing
    );
    if (playingZones.length > 0) {
      this._hasSeenPlaying = true;
      playingZones.sort((a, b) => {
        const ta = this._zonePlayStartTimes[a.zone_id] || 0;
        const tb = this._zonePlayStartTimes[b.zone_id] || 0;
        return tb - ta;
      });
      return playingZones[0];
    }

    if (!this._hasSeenPlaying) return null;

    if (this._lastActiveZoneId && zones[this._lastActiveZoneId]) {
      const prev = zones[this._lastActiveZoneId];
      if (prev.state === "paused" && prev.now_playing) return prev;
      if (prev.state === "loading") return null;
    }

    return null;
  }

  _startPauseTimer() {
    this._clearPauseTimer();
    const timeout = config.get().display.pauseTimeout;
    if (timeout <= 0) return;

    log.debug(`Pause timer started (${timeout}s)`);
    this._pauseTimer = setTimeout(async () => {
      this._pauseTimer = null;
      log.info("Pause timeout reached, clearing activity");
      this._lastState = "timeout";
      this._lastTrackKey = null;
      this._lastImageKey = null;
      this._lastActiveZoneId = null;
      this._lastSeekPosition = null;
      this._lastUpdateTime = null;
      this._hasSeenPlaying = false;
      this._zonePlayStartTimes = {};
      this._lastActivity = null;
      if (this.discord?.connected) {
        await this.discord.clearActivity();
      }
      this._emitState();
    }, timeout * 1000);
  }

  _clearPauseTimer() {
    if (this._pauseTimer) {
      clearTimeout(this._pauseTimer);
      this._pauseTimer = null;
    }
  }

  async _handleZoneChanged(zones) {
    // Receiving zone events means Roon is connected
    if (this._roonStatus !== "connected") {
      this._roonStatus = "connected";
      // Cancel UI debounce timer — reconnected before UI noticed
      if (this._uiDebounceTimer) {
        clearTimeout(this._uiDebounceTimer);
        this._uiDebounceTimer = null;
      }
      // Cancel disconnect grace timer — reconnected successfully
      if (this._roonDisconnectTimer) {
        clearTimeout(this._roonDisconnectTimer);
        this._roonDisconnectTimer = null;
        log.debug("Roon reconnected within grace period");
      }
      this._emitState();
    }

    const cfg = config.get();

    const summary = Object.values(zones)
      .map((z) => `${z.display_name}:${z.state}`)
      .join(", ");
    log.debug(`Zone states: ${summary}`);

    for (const z of Object.values(zones)) {
      if (z.state === "playing" && !this._zonePlayStartTimes[z.zone_id]) {
        this._zonePlayStartTimes[z.zone_id] = Date.now();
      } else if (z.state !== "playing") {
        delete this._zonePlayStartTimes[z.zone_id];
      }
    }

    const zone = this._findActiveZone(zones);

    if (!zone || !zone.now_playing) {
      // If the last active zone is loading (track transition), hold current state
      if (this._lastActiveZoneId && zones[this._lastActiveZoneId]?.state === "loading") {
        log.debug(`Zone [${zones[this._lastActiveZoneId].display_name}] is loading, holding state`);
        return;
      }

      if (
        this._lastState &&
        this._lastState !== "stopped" &&
        this._lastState !== "timeout"
      ) {
        this._lastState = "stopped";
        this._lastImageKey = null;
        this._lastTrackKey = null;
        this._lastActiveZoneId = null;
        this._lastActivity = null;
        this._clearPauseTimer();
        if (this.discord?.connected) {
          await this.discord.clearActivity();
          log.info("No active zones, activity cleared");
        }
        this._emitState();
      }
      return;
    }

    const { state, now_playing } = zone;
    if (state === "loading") return;

    const zoneChanged =
      this._lastActiveZoneId !== null &&
      this._lastActiveZoneId !== zone.zone_id;
    if (zoneChanged) {
      log.info(
        `Zone switched to [${zone.display_name}] (last active wins)`
      );
    }
    this._lastActiveZoneId = zone.zone_id;

    if (state === "paused") {
      if (this._lastState !== "paused") {
        this._lastState = "paused";
        const trackInfo = now_playing.three_line;
        log.info(
          `⏸ ${trackInfo?.line1 || "?"} - ${trackInfo?.line2 || "?"} [${zone.display_name}]`
        );
        this._startPauseTimer();

        let coverArtUrl = now_playing.image_key
          ? cache.get(now_playing.image_key)
          : null;
        if (
          !coverArtUrl &&
          cfg.display.showCoverArt &&
          now_playing.image_key
        ) {
          const imageBuffer = await this.roon.getImage(now_playing.image_key);
          if (imageBuffer) {
            coverArtUrl = await uploadImage(
              now_playing.image_key,
              imageBuffer
            );
          }
        }
        const activity = buildActivity(zone, coverArtUrl);
        this._lastActivity = activity;
        if (activity && this.discord?.connected) {
          await this.discord.setActivity(activity);
        }
        this.emit("activity-updated", activity);
        this._emitState();
      }
      return;
    }

    // State is "playing"
    this._clearPauseTimer();

    // Capture event-time timestamp before any async ops — used for Discord timestamps
    const eventSeek = now_playing.seek_position ?? 0;
    const trackStartTimestamp = Math.round(Date.now() - eventSeek * 1000);

    // Include both image_key and track name to distinguish same-album tracks
    const trackName = now_playing.three_line?.line1 || "";
    const trackKey = `${now_playing.image_key || ""}:${trackName}`;
    const sameTrack =
      this._lastState === "playing" &&
      this._lastTrackKey === trackKey &&
      !zoneChanged;

    let seekDetected = false;
    if (
      sameTrack &&
      this._lastSeekPosition !== null &&
      this._lastUpdateTime !== null
    ) {
      const elapsed = (Date.now() - this._lastUpdateTime) / 1000;
      const expectedSeek = this._lastSeekPosition + elapsed;
      const actualSeek = now_playing.seek_position ?? 0;
      if (Math.abs(actualSeek - expectedSeek) > 5) {
        seekDetected = true;
      }
    }

    if (sameTrack && !seekDetected) {
      // Still emit state periodically so GUI timers stay in sync
      const now = Date.now();
      if (now - this._lastEmitTime > 3000) {
        this._lastEmitTime = now;
        this._emitState();
      }
      return;
    }
    if (this._updateInProgress) {
      // Don't drop zone switches or new tracks — mark for retry after current update finishes
      this._pendingZoneRetry = true;
      return;
    }

    this._updateInProgress = true;

    try {
      this._lastState = "playing";
      this._lastTrackKey = trackKey;

      let coverArtUrl = null;
      const needsUpload =
        cfg.display.showCoverArt &&
        now_playing.image_key &&
        now_playing.image_key !== this._lastImageKey;

      if (cfg.display.showCoverArt && now_playing.image_key) {
        if (needsUpload) {
          // Check cache first — upload may already have a cached URL
          coverArtUrl = cache.get(now_playing.image_key);
          this._lastImageKey = now_playing.image_key;

          if (!coverArtUrl) {
            const imageBuffer = await this.roon.getImage(now_playing.image_key);
            if (imageBuffer) {
              coverArtUrl = await uploadImage(
                now_playing.image_key,
                imageBuffer
              );
            }
          }
        } else {
          coverArtUrl = cache.get(now_playing.image_key);
        }
      }

      // Re-read zone for track info, but use pre-computed timestamp for accuracy
      const freshZone =
        this.roon?.zones[zone.zone_id] || zone;
      const activity = buildActivity(freshZone, coverArtUrl, trackStartTimestamp);
      if (!activity) return;

      this._lastActivity = activity;

      if (!this.discord?.connected) {
        try {
          await this.discord.connect();
          this._discordStatus = "connected";
        } catch (err) {
          log.warn("Discord not available:", err.message);
          this._emitState();
          return;
        }
      }

      await this.discord.setActivity(activity);
      const freshNowPlaying = freshZone.now_playing || now_playing;
      this._lastSeekPosition = freshNowPlaying.seek_position ?? 0;
      this._lastUpdateTime = Date.now();
      const trackInfo = freshNowPlaying.three_line;
      if (seekDetected) {
        log.info(`⏩ Seek detected [${zone.display_name}]`);
      } else {
        log.info(
          `▶ ${trackInfo?.line1 || "?"} - ${trackInfo?.line2 || "?"} [${zone.display_name}]`
        );
      }
      this.emit("activity-updated", activity);
      this._lastEmitTime = Date.now();
      this._emitState();
    } catch (err) {
      log.error("Failed to update activity:", err.message);
    } finally {
      this._updateInProgress = false;
      // Re-process if a zone event was dropped during the update
      if (this._pendingZoneRetry) {
        this._pendingZoneRetry = false;
        if (this.roon && Object.keys(this.roon.zones).length > 0) {
          this._handleZoneChanged(this.roon.zones).catch((err) =>
            log.error("Zone retry error:", err.message)
          );
        }
      }
    }
  }

  // ─── Helpers ───

  _buildActiveZoneInfo() {
    if (!this.roon || !this._lastActiveZoneId) return null;
    const zone = this.roon.zones[this._lastActiveZoneId];
    if (!zone || !zone.now_playing) return null;

    const threeLine = zone.now_playing.three_line || {};
    const imageKey = zone.now_playing.image_key || null;
    // Use Roon Core's local HTTP image API for GUI (Catbox URLs may be unreachable from Electron renderer)
    const coverArtUrl = this.roon.getImageUrl(imageKey);

    return {
      zoneId: zone.zone_id,
      displayName: zone.display_name,
      state: zone.state,
      trackName: threeLine.line1 || "",
      artist: threeLine.line2 || "",
      album: threeLine.line3 || "",
      imageKey,
      coverArtUrl,
      seekPosition: zone.now_playing.seek_position ?? 0,
      length: zone.now_playing.length ?? 0,
    };
  }

  _buildZoneList() {
    if (!this.roon) return [];
    return Object.values(this.roon.zones).map((z) => {
      const threeLine = z.now_playing?.three_line || {};
      return {
        id: z.zone_id,
        name: z.display_name,
        state: z.state,
        nowPlaying: z.now_playing
          ? {
              trackName: threeLine.line1 || "",
              artist: threeLine.line2 || "",
              album: threeLine.line3 || "",
            }
          : null,
      };
    });
  }

  _emitState() {
    this.emit("state-changed", this.getState());
  }
}

module.exports = { AppController };
