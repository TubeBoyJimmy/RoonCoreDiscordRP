const readline = require("readline");
const config = require("./config");
const cache = require("./cache");
const { RoonService } = require("./roon");
const { DiscordIpcService } = require("./discord");
const { buildActivity } = require("./activity");
const { upload: uploadImage } = require("./images");
const constants = require("./constants");
const { createLogger } = require("./logger");
const { AppController } = require("./app");

const log = createLogger("Main");

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function firstRunSetup() {
  console.log();
  console.log("=".repeat(50));
  console.log("  RoonCoreDiscordRP - First Run Setup");
  console.log("=".repeat(50));
  console.log();

  config.load();
  const cfg = config.get();

  const mode = await prompt(
    "Connect to Roon Core:\n  1) Auto-discover (same network)\n  2) Manual IP address\nChoice [1]: "
  );

  if (mode === "2") {
    const addr = await prompt("Enter Roon Core address (IP:port, e.g. 192.168.1.100:9100): ");
    cfg.roon.coreAddress = addr || "";
  }

  console.log("\nConnecting to Roon Core...");
  console.log('Please authorize "Discord Rich Presence" in:');
  console.log("  Roon > Settings > Extensions\n");

  return new Promise((resolve) => {
    const roon = new RoonService({
      onZoneChanged: (zones) => {
        const zoneList = Object.values(zones);
        if (zoneList.length === 0) return;

        console.log(`\nFound ${zoneList.length} zone(s):`);
        zoneList.forEach((z) => {
          const status =
            z.state === "playing" && z.now_playing
              ? ` ▶ ${z.now_playing.three_line?.line1 || "?"}`
              : z.state === "paused" && z.now_playing
                ? ` ⏸ ${z.now_playing.three_line?.line1 || "?"}`
                : "";
          console.log(`  - ${z.display_name}${status}`);
        });
        console.log("\nAll zones will be monitored. Any playback will update Discord RP.");

        config.save();
        console.log("Configuration saved!\n");
        roon.stop();
        resolve();
      },
      onCoreLost: () => {
        log.warn("Lost connection to Roon Core during setup");
      },
    });

    roon.start(cfg.roon.coreAddress || undefined);
  });
}

async function main() {
  console.log(`${constants.name} v${constants.version}`);
  console.log();

  if (config.isFirstRun()) {
    await firstRunSetup();
  }

  const app = new AppController();
  await app.start();

  const shutdown = async () => {
    await app.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error("Fatal error:", err);
  process.exit(1);
});
