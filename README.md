# RoonCoreDiscordRP

> Discord Rich Presence powered by Roon Core Extension API

**[🌐 繁體中文](README.zh-TW.md)**

Display your Roon playback status on Discord — including track name, artist, album, cover art, and a live progress bar. Unlike other solutions that rely on detecting a local Roon client, this project connects directly to Roon Core via the Extension API, so it works regardless of which zone or device is playing.

<!-- ![Discord Rich Presence Screenshot](assets/screenshot.png) -->

## Features

- **Direct Roon Core connection** — queries the server, not a local client
- **Auto-discovery or manual IP** — works on the same network or across subnets
- **All zones monitored** — automatically tracks the most recently active zone
- **Cover art upload** — fetches album art from Roon and uploads to [Catbox](https://catbox.moe) (free, no API key)
- **Live progress bar** — shows elapsed/remaining time in Discord
- **Pause & stop handling** — updates status on pause, clears after configurable timeout
- **Seek detection** — progress bar updates when you skip forward/backward
- **Auto-reconnect** — recovers from both Roon Core and Discord disconnections
- **Lightweight** — no Discord library needed (raw IPC), no image processing library (Roon API handles resizing)

## Prerequisites

- **Node.js** 18+ (uses native `fetch` and `FormData`)
- **Roon Core** running on your network
- **Discord** desktop app running on the same machine

## Installation

```bash
git clone https://github.com/TubeBoyJimmy/RoonCoreDiscordRP.git
cd RoonCoreDiscordRP
npm install
```

## Discord Application Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** and name it (e.g. `Roon`) — this name appears as "Listening to **Roon**" on your profile
3. Copy the **Application ID** and paste it into `data/config.yaml` under `discord.clientId`
4. Go to **Rich Presence > Art Assets** and upload two icons:
   - `playing` — a play icon (512x512 PNG, white on transparent recommended)
   - `paused` — a pause icon (512x512 PNG, white on transparent recommended)
   - Sample SVG files are provided in the `assets/` folder

## First Run

```bash
npm start
```

On the first run, the app will guide you through setup:

1. Choose connection mode: **auto-discover** (same network) or **manual IP:port**
2. Authorize "Discord Rich Presence" in **Roon > Settings > Extensions**
3. Once connected, all available zones are listed and monitoring begins
4. Configuration is saved to `data/config.yaml`

## Configuration

After the first run, you can edit `data/config.yaml`:

```yaml
roon:
  coreAddress: ''              # Leave empty for auto-discovery, or 'IP:port' for manual

display:
  showAlbum: true              # Show album name as large image tooltip
  showArtist: true             # Show artist name in activity state
  showCoverArt: true           # Upload and display cover art
  showProgress: true           # Show progress bar (timestamps)
  pauseTimeout: 30             # Seconds to wait before clearing activity on pause (0 = never)
  buttons: []                  # Custom buttons: [{label: "...", url: "..."}] (max 2)

discord:
  clientId: '...'              # Your Discord Application ID
  pipeNumber: 0                # IPC pipe number (0-9)

logging:
  debug: false                 # Enable verbose logging
```

## How It Works

```
Roon Core
  │  WebSocket (subscribe_zones)
  ▼
RoonService ─── zone state change events
  │
  │  now_playing + state
  ▼
buildActivity() ─── constructs Discord Activity
  │
  │  cover art needed?
  ▼
ImageUploader ─── cache lookup / upload to Catbox
  │
  │  Activity object (with public image URL)
  ▼
DiscordIpcService ─── IPC SET_ACTIVITY
  │
  ▼
Discord client updates Rich Presence
```

The app registers as a Roon Extension. Once authorized, it receives real-time push events for all zones via `subscribe_zones()`. Zone state changes trigger activity updates sent to Discord through the local IPC pipe.

## Multi-Zone Behavior

| Scenario | Behavior |
|----------|----------|
| Single zone playing | That zone is shown |
| Multiple zones playing | Most recently started zone wins |
| Active zone paused | Pause state shown, timeout timer starts |
| Active zone paused → another starts | New zone takes over ("last active wins") |
| All zones stopped | Activity cleared |
| Cold start with stale paused zones | Ignored until a zone starts playing |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Extension not appearing in Roon | Ensure the app is running and on the same network as Roon Core. Try specifying `coreAddress` manually. |
| Discord status not updating | Make sure Discord desktop app is running. Check that `clientId` matches your Discord Application. |
| Cover art not showing | Catbox may be temporarily unreachable. The activity will still show without an image. Check `logging.debug: true` for details. |
| "Discord IPC handshake failed" | Discord may still be starting up. The app will auto-reconnect. |
| Progress bar not updating on seek | Seek detection uses a 5-second threshold. Very small seeks may not trigger an update. |

## Limitations

- **Roon Arc**: Playback via Roon Arc is not visible to the Extension API. This is a Roon platform limitation.
- **Discord desktop required**: Rich Presence uses local IPC, so the Discord desktop app must be running on the same machine.
- **Single activity**: Discord only supports one Rich Presence activity per user. The most recently active zone is shown.

## Project Structure

```
RoonCoreDiscordRP/
├── src/
│   ├── index.js        # Entry point, zone monitoring, lifecycle
│   ├── roon.js         # Roon Core connection & zone subscription
│   ├── discord.js      # Discord IPC (raw named pipe)
│   ├── activity.js     # Zone → Discord Activity builder
│   ├── images.js       # Catbox upload + caching
│   ├── config.js       # YAML config with defaults
│   ├── cache.js        # TTL-based key-value cache
│   ├── logger.js       # Timestamped logging
│   └── constants.js    # App constants
├── assets/             # SVG icons for Rich Presence
├── data/               # Runtime data (gitignored)
│   ├── config.yaml     # User configuration
│   └── cache.json      # Image URL cache
└── package.json
```

## License

MIT
