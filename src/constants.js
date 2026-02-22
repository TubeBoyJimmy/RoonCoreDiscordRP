const path = require("path");

module.exports = {
  name: "RoonCoreDiscordRP",
  version: "1.0.0",
  extensionId: "com.rooncorerdp.discord",
  extensionDisplayName: "Discord Rich Presence",
  extensionPublisher: "RoonCoreDiscordRP",

  discordClientId: "1475071196708995145",

  dataDir: path.join(__dirname, "..", "data"),
  configPath: path.join(__dirname, "..", "data", "config.yaml"),
  cachePath: path.join(__dirname, "..", "data", "cache.json"),

  isWindows: process.platform === "win32",
  processId: process.pid,

  imageSize: 512,
  imageFormat: "image/jpeg",
};
