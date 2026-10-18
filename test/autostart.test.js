const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAutoLaunch, quoteExec } = require("../electron/autostart");

test("Linux login entry roundtrip never calls unsupported Electron APIs", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "roon-autostart-test-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(home)), path.resolve(os.tmpdir()));
    fs.rmSync(home, { recursive: true, force: true });
  });
  const adapter = createAutoLaunch({ isPackaged: false }, {
    platform: "linux", home, env: { XDG_CONFIG_HOME: path.join(home, "config") },
    execPath: "/home/user/Roon App/electron", mainScript: "/home/user/Roon App/electron/main.js",
  });
  assert.equal(adapter.get(), false);
  assert.equal(adapter.set(true), true);
  const content = fs.readFileSync(adapter.desktopPath, "utf8");
  assert.match(content, /"\/home\/user\/Roon App\/electron"/);
  assert.match(content, /"--autostart"/);
  assert.match(content, /"-u" "ELECTRON_RUN_AS_NODE"/);
  assert.equal(adapter.set(false), false);
  assert.equal(fs.existsSync(adapter.desktopPath), false);
});

test("AppImage autostart uses persistent image path and carries explicit overrides", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "roon-appimage-test-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(home)), path.resolve(os.tmpdir()));
    fs.rmSync(home, { recursive: true, force: true });
  });
  const adapter = createAutoLaunch({ isPackaged: true }, { platform: "linux", home,
    env: { APPIMAGE: "/home/user/Roon.AppImage", ROON_DISCORD_DATA_DIR: "/home/user/state" },
    execPath: "/tmp/.mount_roon/roon" });
  adapter.set(true);
  const content = fs.readFileSync(adapter.desktopPath, "utf8");
  assert.match(content, /Roon\.AppImage/);
  assert.doesNotMatch(content, /\.mount_roon/);
  assert.match(content, /ROON_DISCORD_DATA_DIR=\/home\/user\/state/);
});

test("desktop Exec quotes reserved characters and rejects newlines", () => {
  assert.equal(quoteExec('/home/a b/100%'), '"/home/a b/100%%"');
  assert.equal(quoteExec('$x'), '"\\\\$x"');
  assert.equal(quoteExec('a\\b'), '"a\\\\\\\\b"');
  assert.throws(() => quoteExec("a\nHidden=true"), /Invalid/);
});

test("Windows still delegates to Electron login settings", () => {
  let enabled = false;
  const adapter = createAutoLaunch({
    getLoginItemSettings: () => ({ openAtLogin: enabled }),
    setLoginItemSettings: (settings) => { enabled = settings.openAtLogin; },
  }, { platform: "win32" });
  assert.equal(adapter.set(true), true);
  assert.equal(adapter.set(false), false);
});
