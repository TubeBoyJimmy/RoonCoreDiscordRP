const config = require("./config");

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function timestamp() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function log(level, prefix, ...args) {
  if (LEVELS[level] < LEVELS[config.getLogLevel()]) return;
  const tag = prefix ? `[${prefix}]` : "";
  const label = `[${level.toUpperCase()}]`;
  console.log(`${timestamp()} ${label}${tag}`, ...args);
}

function createLogger(prefix) {
  return {
    debug: (...args) => log("debug", prefix, ...args),
    info: (...args) => log("info", prefix, ...args),
    warn: (...args) => log("warn", prefix, ...args),
    error: (...args) => log("error", prefix, ...args),
  };
}

module.exports = { createLogger };
