const RoonApi = require("node-roon-api");
const RoonApiTransport = require("node-roon-api-transport");
const RoonApiImage = require("node-roon-api-image");
const RoonApiStatus = require("node-roon-api-status");
const constants = require("./constants");
const { createLogger } = require("./logger");

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
  }

  _onCorePaired(core) {
    log.info(`Paired with Roon Core: ${core.display_name} (v${core.display_version})`);
    this.core = core;
    this.transport = core.services.RoonApiTransport;
    this.image = core.services.RoonApiImage;
    this._reconnectDelay = 1000;

    this.transport.subscribe_zones((cmd, data) => {
      this._handleZoneEvent(cmd, data);
    });
  }

  _onCoreUnpaired(core) {
    log.warn(`Unpaired from Roon Core: ${core.display_name}`);
    this.core = null;
    this.transport = null;
    this.image = null;
    this.zones = {};
    if (this.onCoreLost) this.onCoreLost();
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

  start(coreAddress) {
    this.api = new RoonApi({
      extension_id: constants.extensionId,
      display_name: constants.extensionDisplayName,
      display_version: constants.version,
      publisher: constants.extensionPublisher,
      email: "",
      website: "",
      log_level: "none",

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
