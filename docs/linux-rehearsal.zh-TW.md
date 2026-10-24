# Linux 桌面使用指南

更新：2026-10-24。本分支已在 Debian 13＋Xfce 桌面（Proxmox VE 虛擬機）實機部署並驗證，見文末「實機驗證」。本分支的 Windows 版本尚未重新實測。

## 承載方式

Roon Server 可留在原本機器，透過 LAN 連線；Discord **桌面程式**與本工具則在同一 Linux 一般使用者的桌面工作階段執行。CLI 只省掉本工具的視窗，仍需本機 Discord IPC。瀏覽器版 Discord 不提供這個本機 IPC。不要把本工具當成系統層級的 root service，也不要跨容器直接暴露 Discord socket。

可放在實體 Linux 桌面，或虛擬化平台上的 Linux 桌面 VM。若在容器中執行時 Electron sandbox 不可用，先保留錯誤供分析，不以 privileged、unconfined 或 `--no-sandbox` 作預設解法。

## 初次操作

1. 在 Linux 桌面登入一般使用者，安裝並開啟[官方 Discord Linux 桌面版](https://discord.com/download)，以 GUI 登入。優先使用一般安裝版，減少 Flatpak／Snap socket 隔離變數。
2. 安裝 Node.js 22.12+（或 Node.js 24）、Git 與 curl。本工具沿用現有 lockfile；不要為移植執行 `npm audit fix --force`。
3. 在專案資料夾開終端機，執行下列建置命令。這部分需要命令列；設定與驗收使用既有 GUI。

   ```sh
   npm ci
   npm test
   npm run gui:build
   npm run gui
   ```

4. 在 Settings → Roon Connection 填現有 Core 的 `IP:port`，或留空使用同網段探索。修改連線設定後重新開啟工具。到 Roon → Settings → Extensions 授權 **Discord Rich Presence**，不需搬 Roon Server。
5. Dashboard 確認 Roon／Discord 連線。若需要排查，從同一桌面使用者終端機執行 `npm run doctor`；這只列環境和 socket 路徑。`npm run doctor -- --connect` 另做一次 IPC 握手，不發送 Rich Presence。
6. Settings → Application → **Start at Login** 可選擇登入桌面後自動啟動；初始不自動開啟。這不是開機即產生桌面登入。Discord 自己也需在該桌面工作階段開啟。

啟用封面顯示會沿用原程式，將封面上傳 Uguu／Catbox；不想上傳時先在 Settings 關閉 Show Cover Art，再播放。沒有改為另外的服務或新增帳號 token 登入方式。

## 設定與 Windows 轉移

Linux 預設位置遵循使用者的 XDG 目錄：

| 內容 | 預設位置 |
|---|---|
| 設定 | `~/.config/roon-core-discord-rp/config.yaml` |
| 封面 URL 快取 | `~/.cache/roon-core-discord-rp/cache.json` |
| Roon 配對狀態 | `~/.local/state/roon-core-discord-rp/roon-state.json` |
| 登入啟動項目（主動啟用才建立） | `~/.config/autostart/roon-core-discord-rp.desktop` |

`XDG_CONFIG_HOME`、`XDG_CACHE_HOME`、`XDG_STATE_HOME` 可更改對應根目錄。`ROON_DISCORD_DATA_DIR` 指定絕對路徑時，三種應用資料共置該處，檔名為 `config.yaml`、`cache.json`、`roon-state.json`。登入啟動項目記住此 override。不會自動搬動或刪除舊檔。

Windows 的 `data/config.yaml`、`data/cache.json` 與根目錄 `config.json` 位置維持原樣。將設定用檔案管理員複製到 Linux 的設定位置即可；配對建議在 Linux 重新授權。若確實要沿用配對，根目錄 `config.json` 是配對資料，需改以 Linux 的 `roon-state.json` 名稱存放，切勿提交 Git 或貼入聊天。不要同時讓原、新工具重複控制同一狀態。

Discord socket 預設會掃描目前使用者的 runtime/temp 及已知 Flatpak／Snap 路徑；另可於 Settings → Discord → IPC Socket Path 指定絕對路徑，重開工具生效。環境變數 `DISCORD_IPC_PATH` 優先於設定。這不會跨越作業系統權限，也不是遠端 RPC 入口。

## 最小驗收與回復

- 選一首原本可播的曲目，確認曲名、歌手、進度與封面（若啟用）在 Discord 個人資料實際顯示。
- 暫停超過設定時間，確認清除；繼續、跳轉、換曲及換 zone 各檢查一次。
- 關閉再開啟 Discord，確認本工具恢復 IPC 並更新目前播放。終止工具後不應繼續重連。
- 若啟用了登入啟動，登出／登入桌面後再檢查。
- 與 Plex 等其他 Presence 工具共存時，逐項確認哪個活動被 Discord 顯示；本版本未加入跨工具優先權仲裁。

未通過時關閉 Linux 工具即可回到原 Windows 工具；來源設定和配對檔仍保留。

## 打包與自動測試

在 Linux 建置 `npm run dist:linux` 可產生 `release/linux-unpacked`，沿用 Electron sandbox。`npm run dist` 保留原 Windows 打包行為。

自動測試（`npm test`）2026-10-24 在 Windows Node 上 **19/19 通過**；2026-10-18 的 Linux 部分曾在 Debian bookworm／Node 24 的一般使用者（UID 1000）環境通過。覆蓋 Windows 路徑相容、XDG 路徑、設定/快取持久化、登入項目、IPC 的分片／PING／無回應／提早斷線／重新連線／關閉取消，以及封面抓取逾時不阻塞狀態更新。這些測試不連 Roon、不登入 Discord、不上傳封面。

## 實機驗證（2026-10-24）

- 環境：Debian 13＋Xfce 桌面 VM，Electron 35.7.5，一般使用者工作階段；Discord 官方桌面版；Roon Core 2.74 在同網段另一台主機。
- 已驗證：Roon Extension 授權、Discord 狀態（曲名／歌手／進度／封面）、系統匣選單、登入桌面後自動啟動並最小化。
- 封面修正：封面暫時抓不到時（例如 Roon Core 取不到串流來源的封面），舊版會讓播放事件排隊延遲、之後送出過時的狀態；本分支在封面請求逾時或失敗時先更新文字狀態、稍後補上封面，實機確認換歌即時更新。
- 未驗證：本分支的 Windows 打包與 Windows 實機行為。

機制參考：[Discord RPC](https://github.com/discord/discord-api-docs/blob/main/developers/topics/rpc.mdx)、[Electron login APIs](https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings-macos-windows)、[XDG Autostart](https://specifications.freedesktop.org/autostart/latest/)。
