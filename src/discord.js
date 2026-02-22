const net = require("net");
const { createLogger } = require("./logger");
const constants = require("./constants");

const log = createLogger("Discord");

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;

class DiscordIpcService {
  constructor(clientId, pipeNumber = 0) {
    this.clientId = clientId;
    this.pipeNumber = pipeNumber;
    this.socket = null;
    this.connected = false;
    this._readBuffer = Buffer.alloc(0);
    this._reconnectTimer = null;
    this._reconnectDelay = 5000;
    this._autoReconnect = false;
    this.onReconnected = null; // callback when reconnection succeeds
    this.onDisconnected = null; // callback when connection is lost
  }

  _getPipePath(n) {
    if (constants.isWindows) {
      return `\\\\?\\pipe\\discord-ipc-${n}`;
    }
    const base =
      process.env.XDG_RUNTIME_DIR ||
      process.env.TMPDIR ||
      process.env.TMP ||
      process.env.TEMP ||
      "/tmp";
    const paths = [
      `${base}/discord-ipc-${n}`,
      `${base}/app/com.discordapp.Discord/discord-ipc-${n}`,
      `${base}/.flatpak/com.discordapp.Discord/xdg-run/discord-ipc-${n}`,
      `${base}/snap.discord/discord-ipc-${n}`,
    ];
    return paths;
  }

  _encode(op, payload) {
    const data = Buffer.from(JSON.stringify(payload));
    const header = Buffer.alloc(8);
    header.writeInt32LE(op, 0);
    header.writeInt32LE(data.length, 4);
    return Buffer.concat([header, data]);
  }

  _tryConnect(pipePath) {
    return new Promise((resolve) => {
      const sock = net.createConnection(pipePath, () => resolve(sock));
      sock.once("error", () => resolve(null));
    });
  }

  async connect() {
    this._stopReconnect();
    for (let n = this.pipeNumber; n < 10; n++) {
      const paths = this._getPipePath(n);
      const candidates = Array.isArray(paths) ? paths : [paths];

      for (const pipePath of candidates) {
        log.debug(`Trying pipe: ${pipePath}`);
        const sock = await this._tryConnect(pipePath);
        if (sock) {
          this.socket = sock;
          this._setupListeners();
          await this._handshake();
          this._autoReconnect = true;
          this._reconnectDelay = 5000;
          return;
        }
      }
    }
    throw new Error("Could not connect to Discord IPC. Is Discord running?");
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    log.info(`Discord reconnect in ${this._reconnectDelay / 1000}s...`);
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      try {
        this._autoReconnect = false; // prevent nested reconnect from close listener
        await this.connect();
        log.info("Discord reconnected successfully");
        if (this.onReconnected) this.onReconnected();
      } catch {
        this._autoReconnect = true;
        this._reconnectDelay = Math.min(this._reconnectDelay * 2, 60000);
        this._scheduleReconnect();
      }
    }, this._reconnectDelay);
  }

  _stopReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  _setupListeners() {
    this.socket.on("data", (chunk) => {
      this._readBuffer = Buffer.concat([this._readBuffer, chunk]);
    });
    this.socket.on("close", () => {
      log.info("Discord IPC connection closed");
      this.connected = false;
      this.socket = null;
      this._readBuffer = Buffer.alloc(0);
      if (this.onDisconnected) this.onDisconnected();
      if (this._autoReconnect) {
        this._scheduleReconnect();
      }
    });
    this.socket.on("error", (err) => {
      log.error("Discord IPC error:", err.message);
      this.connected = false;
    });
  }

  _readMessage() {
    return new Promise((resolve) => {
      const tryParse = () => {
        if (this._readBuffer.length >= 8) {
          const len = this._readBuffer.readInt32LE(4);
          if (this._readBuffer.length >= 8 + len) {
            const payload = JSON.parse(
              this._readBuffer.subarray(8, 8 + len).toString()
            );
            this._readBuffer = this._readBuffer.subarray(8 + len);
            resolve(payload);
            return;
          }
        }
        this.socket.once("data", tryParse);
      };
      tryParse();
    });
  }

  async _handshake() {
    const payload = { v: 1, client_id: this.clientId };
    this.socket.write(this._encode(OP_HANDSHAKE, payload));
    const response = await this._readMessage();
    if (response?.evt === "READY") {
      this.connected = true;
      log.info(
        `Connected to Discord (user: ${response.data?.user?.username || "unknown"})`
      );
    } else {
      throw new Error("Discord IPC handshake failed");
    }
  }

  async setActivity(activity) {
    if (!this.connected) {
      log.warn("Not connected to Discord, skipping activity update");
      return false;
    }
    const payload = {
      cmd: "SET_ACTIVITY",
      args: {
        pid: constants.processId,
        activity,
      },
      nonce: `${Date.now()}`,
    };
    try {
      this.socket.write(this._encode(OP_FRAME, payload));
      log.debug("Activity updated");
      return true;
    } catch (err) {
      log.error("Failed to set activity:", err.message);
      this.connected = false;
      return false;
    }
  }

  async clearActivity() {
    if (!this.connected) return;
    const payload = {
      cmd: "SET_ACTIVITY",
      args: {
        pid: constants.processId,
        activity: null,
      },
      nonce: `${Date.now()}`,
    };
    try {
      this.socket.write(this._encode(OP_FRAME, payload));
      log.debug("Activity cleared");
    } catch (err) {
      log.error("Failed to clear activity:", err.message);
      this.connected = false;
    }
  }

  disconnect() {
    this._autoReconnect = false;
    this._stopReconnect();
    if (this.socket) {
      try {
        this.socket.write(this._encode(OP_CLOSE, {}));
      } catch {}
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this._readBuffer = Buffer.alloc(0);
    log.info("Disconnected from Discord");
  }
}

module.exports = { DiscordIpcService };
