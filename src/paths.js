const path = require("path");
const os = require("os");

function resolveDataPaths({ platform = process.platform, env = process.env,
  home = os.homedir(), appRoot } = {}) {
  const p = platform === "win32" ? path.win32 : path.posix;
  const override = env.ROON_DISCORD_DATA_DIR;
  if (override) {
    if (!p.isAbsolute(override)) throw new Error("ROON_DISCORD_DATA_DIR must be absolute");
    return {
      dataDir: override,
      configPath: p.join(override, "config.yaml"),
      cachePath: p.join(override, "cache.json"),
      roonStatePath: p.join(override, "roon-state.json"),
    };
  }
  if (platform === "linux") {
    const xdg = (key, fallback) => env[key] && p.isAbsolute(env[key]) ? env[key] : p.join(home, fallback);
    const appName = "roon-core-discord-rp";
    const dataDir = p.join(xdg("XDG_STATE_HOME", ".local/state"), appName);
    return {
      dataDir,
      configPath: p.join(xdg("XDG_CONFIG_HOME", ".config"), appName, "config.yaml"),
      cachePath: p.join(xdg("XDG_CACHE_HOME", ".cache"), appName, "cache.json"),
      roonStatePath: p.join(dataDir, "roon-state.json"),
    };
  }
  // Keep existing Windows portable installs (and existing macOS paths) intact.
  return {
    dataDir: p.join(appRoot, "data"),
    configPath: p.join(appRoot, "data", "config.yaml"),
    cachePath: p.join(appRoot, "data", "cache.json"),
    roonStatePath: p.join(appRoot, "config.json"),
  };
}

module.exports = { resolveDataPaths };
