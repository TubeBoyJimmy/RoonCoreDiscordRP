const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } = require("electron");
const path = require("path");
const zlib = require("zlib");
const { AppController } = require("../src/app");
const config = require("../src/config");

let mainWindow = null;
let appController = null;
let tray = null;

const isDev = process.argv.includes("--dev");
const isAutoLaunch = app.getLoginItemSettings().wasOpenedAtLogin;

// ─── Tray icon generation (16x16 purple circle PNG) ───

function createTrayIconImage() {
  const w = 16, h = 16;
  const rgba = Buffer.alloc(w * h * 4, 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      if (dx * dx + dy * dy <= 36) {
        const i = (y * w + x) * 4;
        rgba[i] = 124; rgba[i + 1] = 58; rgba[i + 2] = 237; rgba[i + 3] = 255;
      }
    }
  }

  // Build minimal PNG from raw RGBA pixels
  const filtered = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    filtered[y * (1 + w * 4)] = 0; // filter: none
    rgba.copy(filtered, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(filtered);

  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const t = Buffer.from(type, "ascii");
    const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([l, t, data, c]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);

  return nativeImage.createFromBuffer(png);
}

// ─── Window ───

function createWindow() {
  const cfg = config.get();
  const startHidden = isAutoLaunch && !isDev && cfg.gui?.startMinimized !== false;

  mainWindow = new BrowserWindow({
    width: 1060,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    show: !startHidden,
    frame: false,
    backgroundColor: "#1a1a2e",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "gui", "dist", "index.html"));
  }

  // Close behavior: minimize to tray or quit, with first-time prompt
  mainWindow.on("close", (e) => {
    if (app.isQuitting) return;

    const cfg = config.get();
    const pref = cfg.gui?.minimizeToTray;

    // User explicitly chose NOT to minimize to tray → quit
    if (pref === false) return;

    // User chose to minimize, or hasn't decided yet → prevent close
    e.preventDefault();

    if (pref === null || pref === undefined) {
      // First time — ask the user
      dialog
        .showMessageBox(mainWindow, {
          type: "question",
          title: "RoonCoreDiscordRP",
          message: "要在關閉視窗時縮小到系統匣嗎？",
          detail: "縮小到系統匣後，程式會在背景繼續運作。\n可隨時在設定頁面更改此選項。",
          buttons: ["縮小到系統匣", "直接結束程式"],
          defaultId: 0,
          cancelId: 1,
          checkboxLabel: "記住我的選擇",
          checkboxChecked: true,
        })
        .then(({ response, checkboxChecked }) => {
          const wantTray = response === 0;

          if (checkboxChecked) {
            // Save the preference
            cfg.gui = { ...cfg.gui, minimizeToTray: wantTray };
            config.save();
            // Notify renderer of config change
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("config-changed", cfg);
            }
          }

          if (wantTray) {
            mainWindow.hide();
          } else {
            app.isQuitting = true;
            app.quit();
          }
        });
    } else {
      // Already decided: minimize to tray
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ─── System Tray ───

function createTray() {
  const icon = createTrayIconImage();
  tray = new Tray(icon);
  tray.setToolTip("RoonCoreDiscordRP");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Window",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ─── IPC Handlers ───

function setupIpcHandlers() {
  // State
  ipcMain.handle("get-state", () => appController.getState());

  // Config
  ipcMain.handle("get-config", () => appController.getConfig());
  ipcMain.handle("update-config", (_e, patch) => appController.updateConfig(patch));

  // Cache
  ipcMain.handle("get-cache", () => appController.getCache());
  ipcMain.handle("clear-cache", () => {
    appController.clearCache();
    return true;
  });
  ipcMain.handle("remove-cache-entry", (_e, key) => {
    appController.removeCacheEntry(key);
    return true;
  });

  // Logs
  ipcMain.handle("get-logs", () => appController.getLogs());

  // Auto-launch (start on boot)
  ipcMain.handle("get-auto-launch", () => {
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle("set-auto-launch", (_e, enabled) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return app.getLoginItemSettings().openAtLogin;
  });

  // Window controls
  ipcMain.on("window-minimize", () => mainWindow?.minimize());
  ipcMain.on("window-maximize", () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on("window-close", () => mainWindow?.close());
}

function bridgeEvents() {
  const send = (channel, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  };

  appController.on("state-changed", (state) => send("state-changed", state));
  appController.on("log", (entry) => send("log", entry));
  appController.on("activity-updated", (activity) => send("activity-updated", activity));
  appController.on("cache-changed", (entries) => send("cache-changed", entries));
}

// ─── App Lifecycle ───

app.whenReady().then(async () => {
  config.load();

  appController = new AppController();
  setupIpcHandlers();

  createTray();
  createWindow();
  bridgeEvents();

  await appController.start();
});

app.on("window-all-closed", () => {
  // Don't quit — app stays in system tray
});

app.on("before-quit", async () => {
  app.isQuitting = true;
  if (appController) {
    await appController.stop();
  }
});

app.on("activate", () => {
  if (mainWindow) {
    mainWindow.show();
  } else {
    createWindow();
  }
});
