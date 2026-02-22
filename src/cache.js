const fs = require("fs");
const constants = require("./constants");

let store = {};

function load() {
  if (!fs.existsSync(constants.cachePath)) {
    store = {};
    return;
  }
  try {
    store = JSON.parse(fs.readFileSync(constants.cachePath, "utf8"));
  } catch {
    store = {};
  }
}

function persist() {
  fs.mkdirSync(constants.dataDir, { recursive: true });
  fs.writeFileSync(constants.cachePath, JSON.stringify(store, null, 2));
}

function get(key) {
  const entry = store[key];
  if (!entry) return null;
  if (entry.expiry > 0 && Date.now() > entry.expiry) {
    delete store[key];
    persist();
    return null;
  }
  return entry.value;
}

function set(key, value, ttlMs) {
  store[key] = {
    value,
    expiry: ttlMs > 0 ? Date.now() + ttlMs : 0,
  };
  persist();
}

module.exports = { load, get, set };
