const fs = require("fs");
const RoonApi = require("node-roon-api");
const RoonApiTransport = require("node-roon-api-transport");
const RoonApiImage = require("node-roon-api-image");
const RoonApiStatus = require("node-roon-api-status");
const constants = require("./constants");
const { createLogger } = require("./logger");

// Use centralized path for Roon state file (writable location in packaged app)
const ROON_STATE_PATH = constants.roonStatePath;

// ─── Monkey-patch: node-roon-api treats empty WebSocket messages as fatal ───
// Roon Core occasionally sends empty frames which cause "MOO: empty message
// received" → transport.close() → disconnect. Patch to silently ignore them.
const Moo = require("node-roon-api/moo");

const _origParse = Moo.prototype.parse;
Moo.prototype.parse = function (buf) {
  if (buf && buf.length === 0) {
    // Return a synthetic no-op message instead of undefined (which triggers close)
    return { verb: "COMPLETE", name: "Success", request_id: "__noop__", headers: {} };
  }
  return _origParse.call(this, buf);
};

const _origHandleResponse = Moo.prototype.handle_response;
Moo.prototype.handle_response = function (msg, body) {
  if (msg.request_id === "__noop__") return true; // silently discard
  return _origHandleResponse.call(this, msg, body);
};

// Patch WSTransport to log WebSocket close codes for diagnostics
const WSTransport = require("node-roon-api/transport-websocket");
const _origTransportClose = WSTransport.prototype.close;
WSTransport.prototype.close = function () {
  if (this.ws) {
    // ws library stores close info internally
    const code = this.ws._closeCode;
    const reason = this.ws._closeMessage?.toString() || "";
    if (code !== undefined) {
      log.debug(`WebSocket close: code=${code}${reason ? " reason=" + reason : ""}`);
    }
  }
  return _origTransportClose.call(this);
};

const log = createLogger("Roon");

class RoonService {
  constructor({ onZoneChanged, onCoreLost }) {
    this.onZoneChanged = onZoneChanged;
    this.onCoreLost = onCoreLost;
    this.core = null;
    this.transport = null;
    this.image = null;
    this.zones = {};
    this._reconnectDelay = 1000;
    this._reconnectTimer = null;
    this.api = null;
    this.svc_status = null;
    this.coreHttpBase = null; // e.g. "http://192.168.x.x:9330"
  }

  _onCorePaired(core) {
    // Suppress noisy log on quick reconnects (Roon Core drops connection every ~30s)
    if (this._lastPairTime && Date.now() - this._lastPairTime < 60000) {
      log.debug(`Re-paired with Roon Core: ${core.display_name}`);
    } else {
      log.info(`Paired with Roon Core: ${core.display_name} (v${core.display_version})`);
    }
    this._lastPairTime = Date.now();
    this.core = core;
    this.transport = core.services.RoonApiTransport;
    this.image = core.services.RoonApiImage;
    this._reconnectDelay = 1000;

    // Save HTTP base URL for image API (used by GUI)
    const reg = core.registration || {};
    if (reg.http_port) {
      const host = core.moo?.transport?.host || reg.extension_host || "127.0.0.1";
      this.coreHttpBase = `http://${host}:${reg.http_port}`;
      log.debug(`Roon Core HTTP: ${this.coreHttpBase}`);
    }

    if (this.svc_status) {
      this.svc_status.set_status("Connected", false);
    }

    this.transport.subscribe_zones((cmd, data) => {
      this._handleZoneEvent(cmd, data);
    });
  }

  _onCoreUnpaired(core) {
    // Only log as WARN on first disconnect; quick reconnect cycles log as DEBUG
    if (this._lastPairTime && Date.now() - this._lastPairTime < 60000) {
      log.debug(`Roon Core connection cycle (${core.display_name})`);
    } else {
      log.warn(`Unpaired from Roon Core: ${core.display_name}`);
    }
    this.core = null;
    this.transport = null;
    this.image = null;
    this.zones = {};
    if (this.onCoreLost) this.onCoreLost();

    // Trigger immediate SOOD re-scan for fast reconnection (instead of waiting up to 10s)
    if (this.api?._sood) {
      this.api._sood.query({ query_service_id: "00720724-5143-4a9b-abac-0e50cba674bb" });
    }
  }

  _handleZoneEvent(cmd, data) {
    switch (cmd) {
      case "Subscribed":
        if (data.zones) {
          for (const zone of data.zones) {
            this.zones[zone.zone_id] = zone;
          }
          log.info(`Subscribed to ${data.zones.length} zone(s): ${data.zones.map((z) => z.display_name).join(", ")}`);
        }
        if (this.onZoneChanged) this.onZoneChanged(this.zones);
        break;

      case "Changed":
        if (data.zones_changed) {
          for (const zone of data.zones_changed) {
            this.zones[zone.zone_id] = zone;
          }
        }
        if (data.zones_seek_changed) {
          for (const update of data.zones_seek_changed) {
            const zone = this.zones[update.zone_id];
            if (zone) {
              zone.seek_position = update.seek_position;
              if (zone.now_playing) {
                zone.now_playing.seek_position = update.seek_position;
              }
              if (update.queue_time_remaining !== undefined) {
                zone.queue_time_remaining = update.queue_time_remaining;
              }
            }
          }
        }
        if (data.zones_added) {
          for (const zone of data.zones_added) {
            this.zones[zone.zone_id] = zone;
          }
        }
        if (data.zones_removed) {
          for (const id of data.zones_removed) {
            delete this.zones[id];
          }
        }
        if (this.onZoneChanged) this.onZoneChanged(this.zones);
        break;

      default:
        break;
    }
  }

  start(coreAddress, { debug = false } = {}) {
    this.api = new RoonApi({
      extension_id: constants.extensionId,
      display_name: constants.extensionDisplayName,
      display_version: constants.version,
      publisher: constants.extensionPublisher,
      email: "",
      website: "",
      log_level: debug ? "all" : "none",

      // Use absolute path for state persistence (CWD may differ in Electron)
      get_persisted_state: () => {
        try {
          const content = fs.readFileSync(ROON_STATE_PATH, "utf8");
          return JSON.parse(content).roonstate || {};
        } catch {
          return {};
        }
      },
      set_persisted_state: (state) => {
        try {
          let config = {};
          try {
            config = JSON.parse(fs.readFileSync(ROON_STATE_PATH, "utf8")) || {};
          } catch {}
          config.roonstate = state;
          fs.writeFileSync(ROON_STATE_PATH, JSON.stringify(config, null, "    "));
        } catch {}
      },

      core_paired: (core) => this._onCorePaired(core),
      core_unpaired: (core) => this._onCoreUnpaired(core),
    });

    this.svc_status = new RoonApiStatus(this.api);

    this.api.init_services({
      required_services: [RoonApiTransport, RoonApiImage],
      provided_services: [this.svc_status],
    });

    if (coreAddress) {
      const [host, port] = coreAddress.includes(":")
        ? [coreAddress.split(":")[0], parseInt(coreAddress.split(":")[1])]
        : [coreAddress, 9100];
      log.info(`Connecting to Roon Core at ${host}:${port}`);
      this.api.ws_connect({
        host,
        port,
        onclose: () => this._scheduleReconnect(coreAddress),
      });
    } else {
      log.info("Starting Roon Core discovery...");
      this.api.start_discovery();
    }
  }

  _scheduleReconnect(coreAddress) {
    if (this._reconnectTimer) return;
    log.info(`Reconnecting in ${this._reconnectDelay / 1000}s...`);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, 60000);
      const [host, port] = coreAddress.includes(":")
        ? [coreAddress.split(":")[0], parseInt(coreAddress.split(":")[1])]
        : [coreAddress, 9100];
      this.api.ws_connect({
        host,
        port,
        onclose: () => this._scheduleReconnect(coreAddress),
      });
    }, this._reconnectDelay);
  }

  getImage(imageKey) {
    return new Promise((resolve) => {
      if (!this.image || !imageKey) {
        resolve(null);
        return;
      }
      this.image.get_image(
        imageKey,
        { scale: "fit", width: constants.imageSize, height: constants.imageSize, format: constants.imageFormat },
        (err, contentType, buffer) => {
          if (err) {
            log.error("Failed to get image:", err);
            resolve(null);
          } else {
            resolve(buffer);
          }
        }
      );
    });
  }

  getImageUrl(imageKey, size = 300) {
    if (!this.coreHttpBase || !imageKey) return null;
    return `${this.coreHttpBase}/api/image/${imageKey}?scale=fit&width=${size}&height=${size}&format=image/jpeg`;
  }

  getZoneByName(name) {
    for (const zone of Object.values(this.zones)) {
      if (zone.display_name === name) return zone;
    }
    return null;
  }

  getZoneList() {
    return Object.values(this.zones).map((z) => ({
      id: z.zone_id,
      name: z.display_name,
      state: z.state,
    }));
  }

  stop() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }
}

module.exports = { RoonService };
