const config = require("./config");

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_BUFFER_SIZE = 500;

let logBuffer = [];
let onLogCallback = null;

function timestamp() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function log(level, prefix, ...args) {
  if (LEVELS[level] < LEVELS[config.getLogLevel()]) return;
  const tag = prefix ? `[${prefix}]` : "";
  const label = `[${level.toUpperCase()}]`;
  const ts = timestamp();
  const message = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");

  console.log(`${ts} ${label}${tag}`, ...args);

  const entry = { timestamp: ts, level, prefix: prefix || "", message };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) {
    logBuffer = logBuffer.slice(-LOG_BUFFER_SIZE);
  }

  if (onLogCallback) {
    try {
      onLogCallback(entry);
    } catch {}
  }
}

function createLogger(prefix) {
  return {
    debug: (...args) => log("debug", prefix, ...args),
    info: (...args) => log("info", prefix, ...args),
    warn: (...args) => log("warn", prefix, ...args),
    error: (...args) => log("error", prefix, ...args),
  };
}

function getBuffer() {
  return [...logBuffer];
}

function setOnLog(cb) {
  onLogCallback = cb;
}

module.exports = { createLogger, getBuffer, setOnLog };
