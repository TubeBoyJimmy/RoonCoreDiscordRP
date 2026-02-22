const fs = require("fs");
const yaml = require("js-yaml");
const constants = require("./constants");

const defaults = {
  roon: {
    coreAddress: "",
  },
  display: {
    showAlbum: true,
    showArtist: true,
    showCoverArt: true,
    showProgress: true,
    pauseTimeout: 30,
    buttons: [],
  },
  discord: {
    clientId: constants.discordClientId,
    pipeNumber: 0,
  },
  logging: {
    debug: false,
  },
  gui: {
    minimizeToTray: null, // null = not yet decided (will prompt), true/false = user choice
  },
};

let config = null;

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function load() {
  if (!fs.existsSync(constants.configPath)) {
    config = JSON.parse(JSON.stringify(defaults));
    return config;
  }
  try {
    const raw = fs.readFileSync(constants.configPath, "utf8");
    const parsed = yaml.load(raw) || {};
    config = deepMerge(defaults, parsed);
  } catch (err) {
    console.error("Failed to load config, using defaults:", err.message);
    config = JSON.parse(JSON.stringify(defaults));
  }
  return config;
}

function save() {
  fs.mkdirSync(constants.dataDir, { recursive: true });
  fs.writeFileSync(constants.configPath, yaml.dump(config, { lineWidth: -1 }));
}

function get() {
  if (!config) load();
  return config;
}

function isFirstRun() {
  return !fs.existsSync(constants.configPath);
}

function getLogLevel() {
  if (!config) return "info";
  return config.logging.debug ? "debug" : "info";
}

module.exports = { load, save, get, isFirstRun, getLogLevel };
