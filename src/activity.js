const config = require("./config");
const clock = require("./clock");

const ACTIVITY_TYPE_LISTENING = 2;

// status_display_type (Discord, July 2025): which field shows in the member
// list status, e.g. "Listening to <track>" instead of the app name.
const STATUS_DISPLAY = { app: 0, artist: 1, track: 2 };

function truncate(text, maxLen) {
  if (!text) return "";
  if (text.length > maxLen) return text.slice(0, maxLen - 3) + "...";
  if (text.length < 2) return text.padEnd(2, " ");
  return text;
}

function statusDisplayType(cfg) {
  const mode = cfg.statusDisplay;
  return STATUS_DISPLAY[mode] ?? STATUS_DISPLAY.track;
}

function applyButtons(activity, cfg) {
  if (cfg.buttons && cfg.buttons.length > 0) {
    activity.buttons = cfg.buttons.slice(0, 2).map((b) => ({
      label: truncate(b.label, 30),
      url: b.url,
    }));
  }
}

function buildActivity(zone, coverArtUrl, trackStartTimestamp) {
  const { now_playing, state } = zone;
  if (!now_playing) return null;

  const cfg = config.get().display;
  const threeLine = now_playing.three_line || {};

  const trackName = threeLine.line1 || "Unknown Track";
  const artistName = threeLine.line2 || "";
  const albumName = threeLine.line3 || "";

  const activity = {
    type: ACTIVITY_TYPE_LISTENING,
    details: truncate(trackName, 120),
    status_display_type: statusDisplayType(cfg),
  };

  if (cfg.showArtist && artistName) {
    activity.state = truncate(artistName, 120);
  }

  const assets = {};

  if (coverArtUrl) {
    assets.large_image = coverArtUrl;
  }

  if (cfg.showAlbum && albumName) {
    assets.large_text = truncate(albumName, 120);
  }

  if (state === "paused") {
    assets.small_image = "paused";
    assets.small_text = "Paused";
  } else if (state === "playing") {
    assets.small_image = "playing";
    assets.small_text = "Playing";
  }

  if (Object.keys(assets).length > 0) {
    activity.assets = assets;
  }

  if (cfg.showProgress) {
    const length = now_playing.length;

    if (length && length > 0) {
      // Timestamps cross the machine boundary into Discord clients that
      // render against THEIR clocks — convert local epoch ms to true time.
      if (state === "playing" && trackStartTimestamp) {
        // Use pre-computed start timestamp from event time
        const start = clock.toTrue(trackStartTimestamp);
        activity.timestamps = {
          start,
          end: start + Math.round(length * 1000),
        };
      } else {
        // For paused: shows progress bar frozen at current position
        const seek = now_playing.seek_position ?? 0;
        const now = clock.trueNow();
        activity.timestamps = {
          start: Math.round(now - seek * 1000),
          end: Math.round(now + (length - seek) * 1000),
        };
      }
    }
  }

  applyButtons(activity, cfg);

  return activity;
}

module.exports = { buildActivity };
