const readline = require("readline");
const config = require("./config");
const cache = require("./cache");
const { RoonService } = require("./roon");
const { DiscordIpcService } = require("./discord");
const { buildActivity } = require("./activity");
const { upload: uploadImage } = require("./images");
const constants = require("./constants");
const { createLogger } = require("./logger");

const log = createLogger("Main");

let discord = null;
let roon = null;
let lastImageKey = null;
let lastTrackKey = null;
let lastActiveZoneId = null;
let lastState = null;
let updateInProgress = false;
let pauseTimer = null;
let hasSeenPlaying = false; // cold start guard: ignore paused until we've seen a play
let lastSeekPosition = null;
let lastUpdateTime = null;
let zonePlayStartTimes = {}; // zone_id → timestamp when it last started playing

function findActiveZone(zones) {
  const allZones = Object.values(zones);

  // Priority 1: playing zones — pick the one that started playing most recently
  const playingZones = allZones.filter((z) => z.state === "playing" && z.now_playing);
  if (playingZones.length > 0) {
    hasSeenPlaying = true;
    // Sort by play start time descending (most recent first)
    playingZones.sort((a, b) => {
      const ta = zonePlayStartTimes[a.zone_id] || 0;
      const tb = zonePlayStartTimes[b.zone_id] || 0;
      return tb - ta;
    });
    return playingZones[0];
  }

  // Before we've ever seen a playing zone, ignore paused states (stale from before launch)
  if (!hasSeenPlaying) return null;

  // Priority 2: only the previously active zone if it's paused
  if (lastActiveZoneId && zones[lastActiveZoneId]) {
    const prev = zones[lastActiveZoneId];
    if (prev.state === "paused" && prev.now_playing) return prev;
    // If previous zone is loading (track transition), hold and wait — don't fall through to stale zones
    if (prev.state === "loading") return null;
  }

  // No fallback to random paused zones — they could be stale for hours
  return null;
}

function startPauseTimer() {
  clearPauseTimer();
  const timeout = config.get().display.pauseTimeout;
  if (timeout <= 0) return;

  log.debug(`Pause timer started (${timeout}s)`);
  pauseTimer = setTimeout(async () => {
    pauseTimer = null;
    log.info("Pause timeout reached, clearing activity");
    lastState = "timeout";
    lastTrackKey = null;
    lastImageKey = null;
    lastActiveZoneId = null;
    lastSeekPosition = null;
    lastUpdateTime = null;
    hasSeenPlaying = false;
    zonePlayStartTimes = {};
    if (discord?.connected) {
      await discord.clearActivity();
    }
  }, timeout * 1000);
}

function clearPauseTimer() {
  if (pauseTimer) {
    clearTimeout(pauseTimer);
    pauseTimer = null;
  }
}

async function handleZoneChanged(zones) {
  const cfg = config.get();

  // Diagnostic: log all zone states on every event
  const summary = Object.values(zones)
    .map((z) => `${z.display_name}:${z.state}`)
    .join(", ");
  log.debug(`Zone states: ${summary}`);

  // Track when each zone transitions to playing (for "last active wins" priority)
  for (const z of Object.values(zones)) {
    if (z.state === "playing" && !zonePlayStartTimes[z.zone_id]) {
      zonePlayStartTimes[z.zone_id] = Date.now();
    } else if (z.state !== "playing") {
      delete zonePlayStartTimes[z.zone_id];
    }
  }

  const zone = findActiveZone(zones);

  if (!zone || !zone.now_playing) {
    if (lastState && lastState !== "stopped" && lastState !== "timeout") {
      lastState = "stopped";
      lastImageKey = null;
      lastTrackKey = null;
      lastActiveZoneId = null;
      clearPauseTimer();
      if (discord?.connected) {
        await discord.clearActivity();
        log.info("No active zones, activity cleared");
      }
    }
    return;
  }

  const { state, now_playing } = zone;
  if (state === "loading") return;

  const zoneChanged = lastActiveZoneId !== null && lastActiveZoneId !== zone.zone_id;
  if (zoneChanged) {
    log.info(`Zone switched to [${zone.display_name}] (last active wins)`);
  }
  lastActiveZoneId = zone.zone_id;

  if (state === "paused") {
    if (lastState !== "paused") {
      lastState = "paused";
      const trackInfo = now_playing.three_line;
      log.info(`⏸ ${trackInfo?.line1 || "?"} - ${trackInfo?.line2 || "?"} [${zone.display_name}]`);
      startPauseTimer();

      // Update activity to show paused state
      let coverArtUrl = now_playing.image_key ? cache.get(now_playing.image_key) : null;
      if (!coverArtUrl && cfg.display.showCoverArt && now_playing.image_key) {
        const imageBuffer = await roon.getImage(now_playing.image_key);
        if (imageBuffer) {
          coverArtUrl = await uploadImage(now_playing.image_key, imageBuffer);
        }
      }
      const activity = buildActivity(zone, coverArtUrl);
      if (activity && discord?.connected) {
        await discord.setActivity(activity);
      }
    }
    return;
  }

  // State is "playing" — cancel any pause timer
  clearPauseTimer();

  const trackKey = now_playing.image_key || now_playing.three_line?.line1 || "";
  const sameTrack = lastState === "playing" && lastTrackKey === trackKey && !zoneChanged;

  // Detect seek: compare actual position vs expected position
  let seekDetected = false;
  if (sameTrack && lastSeekPosition !== null && lastUpdateTime !== null) {
    const elapsed = (Date.now() - lastUpdateTime) / 1000;
    const expectedSeek = lastSeekPosition + elapsed;
    const actualSeek = now_playing.seek_position ?? 0;
    if (Math.abs(actualSeek - expectedSeek) > 5) {
      seekDetected = true;
    }
  }

  if (sameTrack && !seekDetected) return;
  if (updateInProgress) return;

  updateInProgress = true;

  try {
    lastState = "playing";
    lastTrackKey = trackKey;

    let coverArtUrl = null;
    if (cfg.display.showCoverArt && now_playing.image_key) {
      if (now_playing.image_key !== lastImageKey) {
        lastImageKey = now_playing.image_key;
        const imageBuffer = await roon.getImage(now_playing.image_key);
        if (imageBuffer) {
          coverArtUrl = await uploadImage(now_playing.image_key, imageBuffer);
        }
      } else {
        coverArtUrl = cache.get(now_playing.image_key);
      }
    }

    const activity = buildActivity(zone, coverArtUrl);
    if (!activity) return;

    if (!discord?.connected) {
      try {
        await discord.connect();
      } catch (err) {
        log.warn("Discord not available:", err.message);
        return;
      }
    }

    await discord.setActivity(activity);
    lastSeekPosition = now_playing.seek_position ?? 0;
    lastUpdateTime = Date.now();
    const trackInfo = now_playing.three_line;
    if (seekDetected) {
      log.info(`⏩ Seek detected [${zone.display_name}]`);
    } else {
      log.info(
        `▶ ${trackInfo?.line1 || "?"} - ${trackInfo?.line2 || "?"} [${zone.display_name}]`
      );
    }
  } catch (err) {
    log.error("Failed to update activity:", err.message);
  } finally {
    updateInProgress = false;
  }
}

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function firstRunSetup() {
  console.log();
  console.log("=".repeat(50));
  console.log("  RoonCoreDiscordRP - First Run Setup");
  console.log("=".repeat(50));
  console.log();

  const cfg = config.get();

  const mode = await prompt(
    "Connect to Roon Core:\n  1) Auto-discover (same network)\n  2) Manual IP address\nChoice [1]: "
  );

  if (mode === "2") {
    const addr = await prompt("Enter Roon Core address (IP:port, e.g. 192.168.1.100:9100): ");
    cfg.roon.coreAddress = addr || "";
  }

  console.log("\nConnecting to Roon Core...");
  console.log('Please authorize "Discord Rich Presence" in:');
  console.log("  Roon > Settings > Extensions\n");

  return new Promise((resolve) => {
    roon = new RoonService({
      onZoneChanged: (zones) => {
        const zoneList = Object.values(zones);
        if (zoneList.length === 0) return;

        console.log(`\nFound ${zoneList.length} zone(s):`);
        zoneList.forEach((z) => {
          const status =
            z.state === "playing" && z.now_playing
              ? ` ▶ ${z.now_playing.three_line?.line1 || "?"}`
              : z.state === "paused" && z.now_playing
                ? ` ⏸ ${z.now_playing.three_line?.line1 || "?"}`
                : "";
          console.log(`  - ${z.display_name}${status}`);
        });
        console.log("\nAll zones will be monitored. Any playback will update Discord RP.");

        config.save();
        console.log("Configuration saved!\n");
        resolve();
      },
      onCoreLost: () => {
        log.warn("Lost connection to Roon Core during setup");
      },
    });

    roon.start(cfg.roon.coreAddress || undefined);
  });
}

async function main() {
  console.log(`${constants.name} v${constants.version}`);
  console.log();

  config.load();
  cache.load();

  const cfg = config.get();

  if (config.isFirstRun()) {
    await firstRunSetup();
    roon.onZoneChanged = (zones) => handleZoneChanged(zones);
  } else {
    roon = new RoonService({
      onZoneChanged: (zones) => handleZoneChanged(zones),
      onCoreLost: () => {
        log.warn("Lost connection to Roon Core");
        clearPauseTimer();
        if (discord?.connected) {
          discord.clearActivity().catch(() => {});
        }
      },
    });

    roon.start(cfg.roon.coreAddress || undefined);
  }

  discord = new DiscordIpcService(cfg.discord.clientId, cfg.discord.pipeNumber);

  // When Discord reconnects, resend current activity
  discord.onReconnected = async () => {
    if (!roon || !lastActiveZoneId) return;
    const zone = roon.zones[lastActiveZoneId];
    if (!zone || !zone.now_playing) return;
    if (zone.state !== "playing" && zone.state !== "paused") return;

    let coverArtUrl = zone.now_playing.image_key ? cache.get(zone.now_playing.image_key) : null;
    const activity = buildActivity(zone, coverArtUrl);
    if (activity) {
      await discord.setActivity(activity);
      log.info(`Resent activity after Discord reconnect [${zone.display_name}]`);
    }
  };

  try {
    await discord.connect();
  } catch (err) {
    log.warn("Discord not running yet, will reconnect automatically");
    discord._autoReconnect = true;
    discord._scheduleReconnect();
  }

  log.info("Monitoring all zones");
  log.info(`Pause timeout: ${cfg.display.pauseTimeout}s`);
  log.info("Waiting for playback events...");

  const shutdown = async () => {
    log.info("Shutting down...");
    clearPauseTimer();
    if (discord) {
      if (discord.connected) {
        await discord.clearActivity();
      }
      discord.disconnect();
    }
    roon?.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error("Fatal error:", err);
  process.exit(1);
});
