const net = require("net");
const path = require("path");
const { createLogger } = require("./logger");
const constants = require("./constants");

const log = createLogger("Discord");
const OP_HANDSHAKE = 0, OP_FRAME = 1, OP_CLOSE = 2, OP_PING = 3, OP_PONG = 4;
const MAX_FRAME_BYTES = 1024 * 1024;

function getIpcPaths(pipeNumber = 0, { platform = process.platform, env = process.env, ipcPath = "" } = {}) {
  const override = env.DISCORD_IPC_PATH || ipcPath;
  if (override) {
    const p = platform === "win32" ? path.win32 : path.posix;
    if (!p.isAbsolute(override)) throw new Error("Discord IPC path must be absolute");
    return [override];
  }
  if (!Number.isInteger(pipeNumber) || pipeNumber < 0 || pipeNumber > 9) {
    throw new Error("Discord pipeNumber must be an integer from 0 to 9");
  }
  const result = [];
  const roots = [...new Set([env.XDG_RUNTIME_DIR, env.TMPDIR, env.TMP, env.TEMP, "/tmp"]
    .filter((root) => root && path.posix.isAbsolute(root)))];
  for (let n = pipeNumber; n < 10; n++) {
    if (platform === "win32") {
      result.push(`\\\\?\\pipe\\discord-ipc-${n}`);
    } else {
      for (const root of roots) {
        for (const prefix of ["", "app/com.discordapp.Discord", ".flatpak/com.discordapp.Discord/xdg-run", "snap.discord"]) {
          result.push(path.posix.join(root, prefix, `discord-ipc-${n}`));
        }
      }
    }
  }
  return result;
}

class DiscordIpcService {
  constructor(clientId, pipeNumber = 0, options = {}) {
    this.clientId = clientId;
    this.pipeNumber = pipeNumber;
    this.options = options;
    this.socket = null;
    this.connected = false;
    this.connectedPath = null;
    this._readBuffer = Buffer.alloc(0);
    this._reconnectTimer = null;
    this._reconnectDelay = 5000;
    this._autoReconnect = false;
    this._connectPromise = null;
    this._generation = 0;
    this._handshakeWaiter = null;
    this.onReconnected = null;
    this.onDisconnected = null;
  }

  _encode(op, payload) {
    const data = Buffer.from(JSON.stringify(payload));
    const header = Buffer.alloc(8);
    header.writeInt32LE(op, 0);
    header.writeInt32LE(data.length, 4);
    return Buffer.concat([header, data]);
  }

  connect() {
    if (this.connected) return Promise.resolve();
    if (this._connectPromise) return this._connectPromise;
    const generation = this._generation;
    this._connectPromise = this._connect(generation).finally(() => { this._connectPromise = null; });
    return this._connectPromise;
  }

  async _connect(generation) {
    let lastError;
    for (const pipePath of getIpcPaths(this.pipeNumber, this.options)) {
      if (generation !== this._generation) throw new Error("Discord connection cancelled");
      log.debug(`Trying pipe: ${pipePath}`);
      try {
        await this._openAndHandshake(pipePath);
        if (!this.socket || this.socket.destroyed) throw new Error("Discord closed IPC session");
        if (generation !== this._generation) {
          this.socket?.destroy();
          throw new Error("Discord connection cancelled");
        }
        this.connected = true;
        this._stopReconnect();
        this.connectedPath = pipePath;
        this._autoReconnect = true;
        this._reconnectDelay = 5000;
        log.info("Connected to Discord IPC");
        return;
      } catch (err) {
        lastError = err;
        const failed = this.socket;
        this.socket = null;
        this._readBuffer = Buffer.alloc(0);
        failed?.destroy();
        log.debug(`IPC unavailable: ${err.message}`);
      }
    }
    throw new Error(`Could not connect to Discord IPC (${lastError?.message || "no candidates"}). Run Discord desktop as the same user/session; use npm run doctor for diagnostics.`);
  }

  _openAndHandshake(pipePath) {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(pipePath);
      this.socket = sock;
      this._readBuffer = Buffer.alloc(0);
      const timer = setTimeout(() => finish(new Error("Discord IPC connection/handshake timed out")), this.options.timeoutMs ?? 3000);
      const finish = (error) => {
        if (this._handshakeWaiter !== finish) return;
        clearTimeout(timer);
        this._handshakeWaiter = null;
        if (error) { sock.destroy(); reject(error); } else resolve();
      };
      this._handshakeWaiter = finish;
      sock.once("connect", () => sock.write(this._encode(OP_HANDSHAKE, { v: 1, client_id: this.clientId })));
      sock.on("data", (chunk) => {
        if (this.socket !== sock) return;
        this._readBuffer = Buffer.concat([this._readBuffer, chunk]);
        try {
          while (this._readBuffer.length >= 8) {
            const op = this._readBuffer.readInt32LE(0);
            const len = this._readBuffer.readInt32LE(4);
            if (len < 0 || len > MAX_FRAME_BYTES) throw new Error("Invalid Discord IPC frame length");
            if (this._readBuffer.length < 8 + len) break;
            const payload = JSON.parse(this._readBuffer.subarray(8, 8 + len).toString());
            this._readBuffer = this._readBuffer.subarray(8 + len);
            if (op === OP_PING) { sock.write(this._encode(OP_PONG, payload)); continue; }
            if (op === OP_CLOSE) throw new Error("Discord closed IPC session");
            if (this._handshakeWaiter && op === OP_FRAME) {
              if (payload?.evt !== "READY") throw new Error("Discord IPC handshake failed");
              finish();
            } else if (payload?.evt === "ERROR") {
              log.warn("Discord rejected RPC:", payload.data?.message || "unknown error");
            }
          }
        } catch (err) {
          finish(err);
          sock.destroy();
        }
      });
      sock.on("error", (err) => {
        finish(err);
        sock.destroy();
      });
      sock.on("close", () => {
        finish(new Error("Discord IPC closed before handshake completed"));
        if (this.socket !== sock) return;
        const wasConnected = this.connected;
        this.connected = false;
        this.connectedPath = null;
        this.socket = null;
        this._readBuffer = Buffer.alloc(0);
        if (wasConnected) {
          log.info("Discord IPC connection closed");
          this.onDisconnected?.();
          if (this._autoReconnect) this._scheduleReconnect();
        }
      });
    });
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    log.info(`Discord reconnect in ${this._reconnectDelay / 1000}s...`);
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      try {
        await this.connect();
        if (this._autoReconnect) await this.onReconnected?.();
      } catch {
        if (!this._autoReconnect) return;
        this._reconnectDelay = Math.min(this._reconnectDelay * 2, 60000);
        this._scheduleReconnect();
      }
    }, this._reconnectDelay);
  }

  _stopReconnect() {
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
  }

  async setActivity(activity) {
    if (!this.connected || !this.socket || this.socket.destroyed) return false;
    this.socket.write(this._encode(OP_FRAME, {
      cmd: "SET_ACTIVITY", args: { pid: constants.processId, activity }, nonce: `${Date.now()}`,
    }));
    // This confirms a local write; RPC errors are logged when Discord responds.
    return true;
  }

  async clearActivity() { return this.setActivity(null); }

  disconnect() {
    this._generation++;
    this._autoReconnect = false;
    this._stopReconnect();
    this._handshakeWaiter?.(new Error("Discord connection cancelled"));
    this.socket?.destroy();
    this.socket = null;
    this.connected = false;
    this.connectedPath = null;
    this._readBuffer = Buffer.alloc(0);
  }
}

module.exports = { DiscordIpcService, getIpcPaths };
