const fs = require("fs");
const { spawnSync } = require("child_process");
const constants = require("../src/constants");
const config = require("../src/config");
const { DiscordIpcService, getIpcPaths } = require("../src/discord");

async function main() {
  const cfg = config.load();
  const options = { ipcPath: cfg.discord.ipcPath };
  console.log(`Platform: ${process.platform}; Node: ${process.version}; UID: ${process.getuid?.() ?? "n/a"}`);
  console.log(`Desktop session: ${process.env.DISPLAY || process.env.WAYLAND_DISPLAY || "not detected"}`);
  console.log(`XDG_RUNTIME_DIR: ${process.env.XDG_RUNTIME_DIR || "not set"}`);
  for (const key of ["configPath", "cachePath", "roonStatePath"]) console.log(`${key}: ${constants[key]}`);
  const curl = spawnSync("curl", ["--version"], { encoding: "utf8", timeout: 3000, windowsHide: true });
  console.log(`curl: ${curl.status === 0 ? "available" : "not available (cover art / clock sync need curl)"}`);
  const candidates = getIpcPaths(cfg.discord.pipeNumber, options);
  const present = candidates.filter((candidate) => fs.existsSync(candidate));
  console.log(`IPC candidates: ${candidates.length}; existing: ${present.length}`);
  for (const candidate of present) console.log(`  ${candidate}`);
  if (!process.argv.includes("--connect")) {
    console.log("Read-only diagnosis completed. Add --connect to test an IPC handshake; no activity is sent.");
    return;
  }
  const service = new DiscordIpcService(cfg.discord.clientId, cfg.discord.pipeNumber, options);
  try {
    await service.connect();
    console.log(`IPC handshake passed: ${service.connectedPath}`);
  } finally { service.disconnect(); }
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
