const fs = require("fs");
const path = require("path");
const os = require("os");

function quoteExec(value) {
  if (/[\r\n\0]/.test(value)) throw new Error("Invalid autostart argument");
  // Desktop Entry escaping is distinct from shell quoting: string unescape,
  // then Exec quoting, then percent field-code processing. No shell is used.
  return '"' + value.replace(/%/g, "%%").replace(/[\\"`$]/g, "\\$&").replace(/\\/g, "\\\\") + '"';
}

function createAutoLaunch(app, { platform = process.platform, env = process.env,
  home = os.homedir(), execPath = process.execPath, mainScript = path.join(__dirname, "main.js") } = {}) {
  const configHome = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME)
    ? env.XDG_CONFIG_HOME : path.join(home, ".config");
  const desktopPath = path.join(configHome, "autostart", "roon-core-discord-rp.desktop");
  return {
    desktopPath,
    get() {
      if (platform !== "linux") return app.getLoginItemSettings().openAtLogin;
      try { return !/^Hidden=true\s*$/m.test(fs.readFileSync(desktopPath, "utf8")); }
      catch (err) { if (err.code === "ENOENT") return false; throw err; }
    },
    set(enabled) {
      if (typeof enabled !== "boolean") throw new Error("Autostart requires a boolean");
      if (platform !== "linux") {
        app.setLoginItemSettings({ openAtLogin: enabled });
        return this.get();
      }
      if (!enabled) { fs.rmSync(desktopPath, { force: true }); return false; }
      const executable = env.APPIMAGE || execPath;
      if (executable.includes("=")) throw new Error("Autostart executable path cannot contain =");
      const args = [executable];
      if (!app.isPackaged) args.push(mainScript);
      args.push("--autostart");
      // Preserve explicit state/socket overrides when the desktop logs in later.
      const overrides = ["ROON_DISCORD_DATA_DIR", "DISCORD_IPC_PATH"]
        .filter((key) => env[key]).map((key) => `${key}=${env[key]}`);
      const command = ["/usr/bin/env", "-u", "ELECTRON_RUN_AS_NODE", ...overrides, ...args];
      const contents = ["[Desktop Entry]", "Type=Application", "Name=RoonCoreDiscordRP",
        `Exec=${command.map(quoteExec).join(" ")}`, "Terminal=false", "Hidden=false", ""].join("\n");
      fs.mkdirSync(path.dirname(desktopPath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(desktopPath, contents, { mode: 0o600 });
      return this.get();
    },
  };
}

module.exports = { createAutoLaunch, quoteExec };
