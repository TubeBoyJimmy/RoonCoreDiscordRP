const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Isolate config/cache from the real machine before any src module loads
process.env.ROON_DISCORD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "roon-app-test-"));
const COVER_URL = "https://covers.test/a.jpg";
require("../src/images").upload = async () => COVER_URL; // no curl, no cache writes
const config = require("../src/config");
const { AppController } = require("../src/app");
const { RoonService } = require("../src/roon");

config.get().display.showCoverArt = true;
config.get().display.pauseTimeout = 0; // no pause timer left running

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function zone(overrides = {}) {
  return {
    zone_id: "d900", display_name: "D900", state: "playing",
    now_playing: {
      image_key: "img-a", seek_position: 5, length: 200,
      three_line: { line1: "Song A", line2: "Artist", line3: "Album" },
    },
    ...overrides,
  };
}

function setup() {
  const app = new AppController();
  const images = {};
  app.roon = {
    zones: {},
    getImage: (key) => (images[key] ||= deferred()).promise,
    getImageUrl: () => null,
  };
  const sent = [];
  app.discord = {
    connected: true,
    async setActivity(activity) { sent.push(activity); return true; },
    async clearActivity() { return this.setActivity(null); },
  };
  const update = async (z) => {
    app.roon.zones = { [z.zone_id]: z };
    await app._handleZoneChanged(app.roon.zones);
  };
  return { app, images, sent, update };
}

test("text presence goes out before a slow cover, which is added afterwards", async () => {
  const { images, sent, update } = setup();
  await update(zone());
  assert.equal(sent.length, 1);
  assert.equal(sent[0].details, "Song A");
  assert.equal(sent[0].assets.large_image, undefined);

  images["img-a"].resolve(Buffer.from("jpeg"));
  await flush();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].assets.large_image, COVER_URL);
  assert.deepEqual(sent[1].timestamps, sent[0].timestamps);
});

test("a late cover never overwrites a stop that happened meanwhile", async () => {
  const { images, sent, update } = setup();
  await update(zone());
  await update(zone({ state: "stopped" }));
  assert.equal(sent.at(-1), null);

  images["img-a"].resolve(Buffer.from("jpeg"));
  await flush();
  assert.equal(sent.at(-1), null);
});

test("a late cover never brings back an older timestamp after a seek", async () => {
  const { images, sent, update } = setup();
  await update(zone());
  const seeked = zone();
  seeked.now_playing.seek_position = 120;
  await update(seeked);
  assert.equal(sent.length, 2);
  const afterSeek = sent[1].timestamps.start;

  images["img-a"].resolve(Buffer.from("jpeg"));
  await flush();
  assert.equal(sent.at(-1).timestamps.start, afterSeek);
});

test("getImage gives up when Core does not answer in time", async () => {
  const roon = new RoonService({});
  let lateReply;
  roon.image = { get_image: (key, opts, cb) => { lateReply = cb; } };
  const started = Date.now();
  assert.equal(await roon.getImage("img-a", 50), null);
  assert.ok(Date.now() - started < 1000);
  lateReply("NetworkError"); // Core's answer ~100s later is ignored
});
