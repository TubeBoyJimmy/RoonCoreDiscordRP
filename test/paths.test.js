const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { resolveDataPaths } = require("../src/paths");

test("Linux uses writable XDG directories, including packaged /opt installs", () => {
  assert.deepEqual(resolveDataPaths({ platform: "linux", env: {}, home: "/home/music", appRoot: "/opt/Roon" }), {
    dataDir: "/home/music/.local/state/roon-core-discord-rp",
    configPath: "/home/music/.config/roon-core-discord-rp/config.yaml",
    cachePath: "/home/music/.cache/roon-core-discord-rp/cache.json",
    roonStatePath: "/home/music/.local/state/roon-core-discord-rp/roon-state.json",
  });
  const paths = resolveDataPaths({ platform: "linux", env: {
    XDG_CONFIG_HOME: "/config", XDG_CACHE_HOME: "relative-invalid", XDG_STATE_HOME: "/state",
  }, home: "/home/music" });
  assert.equal(paths.configPath, "/config/roon-core-discord-rp/config.yaml");
  assert.equal(paths.cachePath, "/home/music/.cache/roon-core-discord-rp/cache.json");
});

test("Windows portable configuration and pairing remain at original paths", () => {
  const paths = resolveDataPaths({ platform: "win32", env: {}, appRoot: "C:\\Roon" });
  assert.equal(paths.configPath, "C:\\Roon\\data\\config.yaml");
  assert.equal(paths.roonStatePath, "C:\\Roon\\config.json");
});

test("explicit state directory persists settings and cache across processes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roon-state-test-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const env = { ...process.env, ROON_DISCORD_DATA_DIR: path.join(root, "private") };
  const write = spawnSync(process.execPath, ["-e", `
    const config = require('./src/config'); const cache = require('./src/cache');
    config.load(); config.get().display.showCoverArt = false; config.save();
    cache.set('synthetic-image', 'https://example.invalid/cover', 0);
  `], { cwd: path.join(__dirname, ".."), env, encoding: "utf8" });
  assert.equal(write.status, 0, write.stderr);
  const read = spawnSync(process.execPath, ["-e", `
    const config = require('./src/config'); const cache = require('./src/cache');
    config.load(); cache.load();
    console.log(JSON.stringify([config.get().display.showCoverArt, cache.get('synthetic-image')]));
  `], { cwd: path.join(__dirname, ".."), env, encoding: "utf8" });
  assert.equal(read.status, 0, read.stderr);
  assert.deepEqual(JSON.parse(read.stdout), [false, "https://example.invalid/cover"]);
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(env.ROON_DISCORD_DATA_DIR, "config.yaml")).mode & 0o777, 0o600);
});

test("relative data override fails before creating files", () => {
  assert.throws(() => resolveDataPaths({ platform: "linux", env: { ROON_DISCORD_DATA_DIR: "relative" } }), /absolute/);
});
