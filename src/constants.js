const path = require("path");
const { resolveDataPaths } = require("./paths");

// In a packaged Electron app, __dirname is inside app.asar (read-only).
// Writable data (config, cache, roon state) goes next to the .exe instead.
const isPackaged = __dirname.includes("app.asar");
const appRoot = isPackaged
  ? path.dirname(process.execPath)
  : path.join(__dirname, "..");

module.exports = {
  name: "RoonCoreDiscordRP",
  version: "2.2.0",
  extensionId: "com.rooncorerdp.discord",
  extensionDisplayName: "Discord Rich Presence",
  extensionPublisher: "RoonCoreDiscordRP",

  discordClientId: "1475071196708995145",

  appRoot,
  ...resolveDataPaths({ appRoot }),

  isPackaged,
  isWindows: process.platform === "win32",
  processId: process.pid,

  imageSize: 512,
  imageFormat: "image/jpeg",
};
