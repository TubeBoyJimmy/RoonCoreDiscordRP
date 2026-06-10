# RoonCoreDiscordRP

> 透過 Roon Core Extension API 驅動的 Discord Rich Presence

**[🌐 English](README.md)**

在 Discord 上顯示你的 Roon 播放狀態 — 包含曲目名稱、藝人、專輯、封面圖片及即時進度條。不同於偵測本機 Roon Client 的方案，本專案直接透過 Extension API 連線至 Roon Core，無論是哪個 Zone 或裝置正在播放都能運作。

包含 **CLI 模式**（適合無頭/伺服器環境）及 **Electron GUI**（儀表板、設定編輯、Discord 預覽、圖片快取管理、即時日誌檢視）。

![Discord Rich Presence](assets/DCRP.jpg)

![GUI 儀表板](assets/dashboard.jpg)

![GUI Discord 預覽](assets/preview.jpg)

## 功能特色

- **直連 Roon Core** — 查詢伺服器端，而非偵測本機 Client
- **自動探索或手動 IP** — 支援同網段自動發現，也可跨子網手動指定
- **監聽所有 Zone** — 自動追蹤最近活躍的播放區域
- **封面圖上傳** — 從 Roon 取得專輯封面並上傳至 [Uguu](https://uguu.se)（主要）或 [Catbox](https://catbox.moe)（備用），免費、免 API Key
- **即時進度條** — 在 Discord 顯示已播放/剩餘時間
- **暫停與停止處理** — 暫停時更新狀態，逾時後自動清除
- **快轉偵測** — 拖動進度時自動更新進度條
- **自動重連** — Roon Core 或 Discord 斷線後自動恢復
- **輕量化** — 不需要 Discord 函式庫（原生 IPC）、不需要圖片處理函式庫（Roon API 原生處理縮放）
- **Electron GUI** — 儀表板、設定編輯、Discord 預覽、快取管理、即時日誌
- **系統匣** — 縮小到系統匣，背景持續運作
- **開機啟動** — 可選擇隨 Windows 開機啟動，自動最小化至系統匣
- **時鐘偏移補償** — 以標準時間校正時間戳，即使主機時鐘漂移，顯示的播放時間依然精準
- **自訂狀態文字** — 好友列表可顯示「Listening to *歌名*」（或藝人/應用程式名稱）

## 前置需求

- **Node.js** 18+
- **Roon Core** 在你的網路上運行
- **Discord** 桌面版在同一台機器上運行

## 安裝

```bash
git clone https://github.com/TubeBoyJimmy/RoonCoreDiscordRP.git
cd RoonCoreDiscordRP
npm install
```

## 使用方式

### CLI 模式

```bash
npm start
```

首次執行時，程式會引導你完成設定：

1. 選擇連線方式：**自動探索**（同網段）或**手動輸入 IP:port**
2. 在 **Roon > 設定 > Extensions** 中授權「Discord Rich Presence」

   ![Roon Extensions](assets/Extensions.jpg)

3. 連線成功後，列出所有可用的 Zone 並開始監聽
4. 設定儲存至 `data/config.yaml`

### GUI 模式（Electron）

```bash
npm run gui
```

開啟桌面視窗，包含：
- **儀表板** — 連線狀態、正在播放卡片、Zone 列表
- **設定** — 編輯所有設定並即時生效
- **Discord 預覽** — 即時預覽 Rich Presence 在 Discord 上的呈現
- **圖片快取** — 管理已上傳的封面圖快取
- **日誌** — 即時日誌檢視，支援等級篩選

程式可縮小到系統匣在背景運作（首次關閉時會詢問，可在設定頁面變更）。

已內建預設的 Discord Application — 不需要到 Developer Portal 做任何設定。

## 設定說明

首次執行後，可編輯 `data/config.yaml`：

```yaml
roon:
  coreAddress: ''              # 留空 = 自動探索，填入 'IP:port' = 手動連線

display:
  showAlbum: true              # 顯示專輯名稱（大圖提示文字）
  showArtist: true             # 顯示藝人名稱
  showCoverArt: true           # 上傳並顯示封面圖
  showProgress: true           # 顯示進度條（時間戳記）
  pauseTimeout: 30             # 暫停後幾秒清除狀態（0 = 不清除）
  buttons: []                  # 自訂按鈕：[{label: "...", url: "..."}]（最多 2 個）
  statusDisplay: track         # 好友列表狀態文字：track（歌名）| artist（藝人）| app（程式名）

discord:
  clientId: '...'              # Discord Application ID（已預設，不需修改）
  pipeNumber: 0                # IPC pipe 編號（0-9）

logging:
  debug: false                 # 啟用詳細日誌

gui:
  minimizeToTray: null         # null = 首次關閉時詢問，true = 縮小到系統匣，false = 直接結束
```

## 運作原理

```
Roon Core
  │  WebSocket (subscribe_zones)
  ▼
RoonService ─── Zone 狀態變化事件
  │
  │  now_playing + state
  ▼
buildActivity() ─── 建構 Discord Activity
  │
  │  需要封面圖？
  ▼
ImageUploader ─── 查詢快取 / 透過 curl 上傳（Uguu → Catbox 備用）
  │
  │  Activity 物件（含公開圖片 URL）
  ▼
DiscordIpcService ─── IPC SET_ACTIVITY
  │
  ▼
Discord 客戶端更新 Rich Presence
```

程式註冊為 Roon Extension。授權後，透過 `subscribe_zones()` 接收所有 Zone 的即時推播事件。Zone 狀態變化時觸發 Activity 更新，經由本地 IPC pipe 送至 Discord。

封面圖使用系統的 `curl` 指令上傳，確保在 CLI 和 Electron 環境中都能穩定連線。

## 多 Zone 行為

| 場景 | 行為 |
|------|------|
| 單一 Zone 播放中 | 顯示該 Zone |
| 多個 Zone 同時播放 | 最近開始播放的 Zone 優先（後來後贏） |
| 活躍 Zone 暫停 | 顯示暫停狀態，啟動逾時計時器 |
| 活躍 Zone 暫停 → 另一個開始播放 | 新 Zone 接手（後來後贏） |
| 所有 Zone 停止 | 清除 Activity |
| 冷啟動時有殘留暫停 Zone | 忽略，直到有 Zone 開始播放 |

## 自訂 Discord Application（選用）

預設情況下，程式使用內建的 Discord Application，你的 Discord 個人檔案會顯示「正在聽 **Roon**」。如果你想自訂顯示名稱或圖示：

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications)
2. 點選 **New Application** — 你取的名稱會顯示為「正在聽 **你的名稱**」
3. 複製 **Application ID**，設定到 `data/config.yaml` 的 `discord.clientId`
4. 可選：前往 **Rich Presence > Art Assets**，上傳名為 `playing` 和 `paused` 的圖示（512×512 PNG）

## 疑難排解

| 問題 | 解決方式 |
|------|---------|
| Roon 設定中看不到 Extension | 確認程式正在執行且與 Roon Core 在同一網路。嘗試在 `coreAddress` 手動指定 IP。 |
| Discord 狀態未更新 | 確認 Discord 桌面版正在執行。若使用自訂 `clientId`，請確認與你的 Discord Application 一致。 |
| 封面圖未顯示 | 圖床可能暫時無法連線。Activity 會正常顯示但沒有圖片。開啟 `logging.debug: true` 查看詳情。 |
| "Discord IPC handshake failed" | Discord 可能還在啟動中，程式會自動重連。 |
| 快轉後進度條未更新 | 快轉偵測使用 5 秒閾值，非常小的快轉可能不會觸發更新。 |
| GUI 出現 Electron 網路錯誤 | 圖片上傳使用系統 `curl` 繞過 Electron 網路限制。請確認 `curl` 可用（Windows 10/11 內建）。 |

## 已知限制

- **Roon Arc**：透過 Roon Arc 的播放對 Extension API 不可見，這是 Roon 平台的限制。
  （曾評估以 ListenBrainz scrobbling 作為替代資料來源：Roon 對 scrobble 服務的上報是惰性批次，
  通常延遲數分鐘（串流內容亦然），無法做到即時狀態顯示，故未採用。）
- **需要 Discord 桌面版**：Rich Presence 使用本地 IPC，Discord 桌面版必須在同一台機器上執行。
- **單一 Activity**：Discord 每個使用者同時只能顯示一個 Rich Presence Activity，會顯示最近活躍的 Zone。

## 專案結構

```
RoonCoreDiscordRP/
├── src/
│   ├── index.js        # CLI 入口點、首次設定
│   ├── app.js          # AppController — 共用核心邏輯（CLI + GUI）
│   ├── roon.js         # Roon Core 連線與 Zone 訂閱
│   ├── discord.js      # Discord IPC（原生 named pipe）
│   ├── activity.js     # Zone → Discord Activity 建構
│   ├── clock.js        # 系統時鐘偏移量測與補償
│   ├── images.js       # 透過 curl 上傳圖片（Uguu/Catbox）+ 快取
│   ├── config.js       # YAML 設定與預設值
│   ├── cache.js        # 帶 TTL 的 Key-Value 快取
│   ├── logger.js       # 帶時間戳的日誌與緩衝區
│   └── constants.js    # 應用程式常數
├── electron/
│   ├── main.js         # Electron 主程序
│   └── preload.js      # Context bridge（IPC 橋接）
├── gui/
│   ├── index.html      # Renderer 入口
│   ├── renderer.jsx    # React 根元件
│   ├── App.jsx         # 主佈局（側邊欄 + 頁面路由）
│   ├── styles/
│   │   └── theme.css   # 暗色主題、CSS 變數
│   ├── components/
│   │   ├── Dashboard.jsx   # 連線狀態、正在播放、Zone 列表
│   │   ├── Settings.jsx    # 設定編輯器
│   │   ├── Preview.jsx     # Discord Rich Presence 預覽
│   │   ├── Cache.jsx       # 圖片快取管理
│   │   ├── Logs.jsx        # 即時日誌檢視
│   │   └── Sidebar.jsx     # 側邊導航
│   └── hooks/
│       └── useIpc.js   # IPC 通訊 hooks
├── assets/             # Rich Presence 用 SVG 圖示
├── scripts/
│   └── launch-gui.js   # Electron 啟動器（清理環境變數）
├── data/               # 執行時資料（已 gitignore）
│   ├── config.yaml     # 使用者設定
│   └── cache.json      # 圖片 URL 快取
├── vite.config.js      # Vite 打包設定（renderer）
└── package.json
```

## 授權

MIT
