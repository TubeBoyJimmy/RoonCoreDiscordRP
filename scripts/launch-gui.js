// Launcher script: ensures ELECTRON_RUN_AS_NODE is not set before starting Electron.
// This is needed because editors like VS Code set this env var in their terminal,
// which prevents Electron from initializing the browser process.

const { spawn } = require("child_process");
const path = require("path");
const electron = require("electron");

const mainScript = path.join(__dirname, "..", "electron", "main.js");

// Build clean env without ELECTRON_RUN_AS_NODE
// VS Code sets this to "1" which makes Electron run as plain Node.js
const cleanEnv = { ...process.env };
delete cleanEnv.ELECTRON_RUN_AS_NODE;

// Forward extra args (e.g. --dev)
const extraArgs = process.argv.slice(2);
const child = spawn(electron, [mainScript, ...extraArgs], {
  stdio: "inherit",
  env: cleanEnv,
});

child.on("close", (code) => process.exit(code ?? 0));

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
