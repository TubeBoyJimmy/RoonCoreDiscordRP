const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { once } = require("node:events");
const { DiscordIpcService, getIpcPaths } = require("../src/discord");

function frame(op, payload) {
  const data = Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0); header.writeInt32LE(data.length, 4);
  return Buffer.concat([header, data]);
}

async function fakeDiscord(t, onMessage) {
  const ipcPath = process.platform === "win32" ? `\\\\?\\pipe\\roon-test-${randomUUID()}`
    : path.join(os.tmpdir(), `roon-${randomUUID()}.sock`);
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 8) {
        const length = buffer.readInt32LE(4);
        if (buffer.length < length + 8) return;
        const op = buffer.readInt32LE(0);
        const payload = JSON.parse(buffer.subarray(8, length + 8));
        buffer = buffer.subarray(length + 8);
        onMessage(socket, op, payload);
      }
    });
  });
  server.listen(ipcPath);
  await once(server, "listening");
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  const service = new DiscordIpcService("123456789", 0, { ipcPath, env: {}, timeoutMs: 150 });
  t.after(() => service.disconnect());
  return service;
}

test("Linux searches runtime + temp sockets, sandbox paths, then later pipe numbers", () => {
  const paths = getIpcPaths(8, { platform: "linux", env: { XDG_RUNTIME_DIR: "/run/user/1000", TMPDIR: "/tmp/custom" } });
  assert.equal(paths[0], "/run/user/1000/discord-ipc-8");
  assert.ok(paths.includes("/run/user/1000/app/com.discordapp.Discord/discord-ipc-8"));
  assert.ok(paths.includes("/tmp/discord-ipc-9"));
  assert.equal(new Set(paths).size, paths.length);
  assert.deepEqual(getIpcPaths(0, { platform: "linux", env: { DISCORD_IPC_PATH: "/chosen" }, ipcPath: "/ignored" }), ["/chosen"]);
  assert.throws(() => getIpcPaths(10, { env: {} }), /0 to 9/);
});

test("fragmented READY, coalesced messages, activity/clear and PING work", async (t) => {
  const received = [];
  let resolvePong;
  const pong = new Promise((resolve) => { resolvePong = resolve; });
  const service = await fakeDiscord(t, (socket, op, payload) => {
    if (op === 0) {
      const ready = frame(1, { evt: "READY", data: {} });
      socket.write(ready.subarray(0, 5));
      setTimeout(() => socket.write(Buffer.concat([ready.subarray(5), frame(3, { check: 1 })])), 5);
    } else if (op === 4) resolvePong(payload);
    else if (op === 1) received.push(payload.args.activity);
  });
  await Promise.all([service.connect(), service.connect()]);
  assert.equal(service.connected, true);
  assert.deepEqual(await pong, { check: 1 });
  await service.setActivity({ details: "synthetic test" });
  await service.clearActivity();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(received, [{ details: "synthetic test" }, null]);
  assert.equal(service._readBuffer.length, 0);
});

test("silent peer and peer closed before READY reject within deadline", async (t) => {
  const silent = await fakeDiscord(t, () => {});
  await assert.rejects(silent.connect(), /timed out/);
  assert.equal(silent.connected, false);
  const closed = await fakeDiscord(t, (socket) => socket.destroy());
  await assert.rejects(closed.connect(), /closed before handshake/);
});

test("malformed frames reject without crashing or waiting forever", async (t) => {
  const service = await fakeDiscord(t, (socket) => {
    const header = Buffer.alloc(8); header.writeInt32LE(-1, 4); socket.write(header);
  });
  await assert.rejects(service.connect(), /Invalid Discord IPC frame length/);
});

test("READY immediately followed by CLOSE is not reported as connected", async (t) => {
  const service = await fakeDiscord(t, (socket) => {
    socket.write(Buffer.concat([frame(1, { evt: "READY" }), frame(2, {})]));
  });
  await assert.rejects(service.connect(), /closed IPC/);
  assert.equal(service.connected, false);
});

test("disconnect reconnects and explicit shutdown cancels subsequent reconnect", async (t) => {
  let peer;
  let connects = 0;
  const service = await fakeDiscord(t, (socket, op) => {
    if (op === 0) { peer = socket; connects++; socket.write(frame(1, { evt: "READY" })); }
  });
  await service.connect();
  service._reconnectDelay = 10;
  const reconnected = new Promise((resolve) => { service.onReconnected = resolve; });
  peer.destroy();
  await reconnected;
  assert.equal(connects, 2);
  assert.equal(service.connected, true);
  service.disconnect();
  assert.equal(service._reconnectTimer, null);
  assert.equal(service.connected, false);
});

test("shutdown cancels a handshake already in progress", async (t) => {
  const service = await fakeDiscord(t, () => {});
  const pending = service.connect();
  service.disconnect();
  await assert.rejects(pending, /cancelled/);
  assert.equal(service.connected, false);
  assert.equal(service._reconnectTimer, null);
});
