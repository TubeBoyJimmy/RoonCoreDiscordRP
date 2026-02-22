const config = require("./config");
const { createLogger } = require("./logger");

const log = createLogger("Activity");

const ACTIVITY_TYPE_LISTENING = 2;

function truncate(text, maxLen) {
  if (!text) return "";
  if (text.length > maxLen) return text.slice(0, maxLen - 3) + "...";
  if (text.length < 2) return text.padEnd(2, " ");
  return text;
}

function buildActivity(zone, coverArtUrl) {
  const { now_playing, state, seek_position } = zone;
  if (!now_playing) return null;

  const cfg = config.get().display;
  const threeLine = now_playing.three_line || {};

  const trackName = threeLine.line1 || "Unknown Track";
  const artistName = threeLine.line2 || "";
  const albumName = threeLine.line3 || "";

  const activity = {
    type: ACTIVITY_TYPE_LISTENING,
    details: truncate(trackName, 120),
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

  if (cfg.showProgress && state === "playing") {
    const length = now_playing.length;
    const seek = seek_position ?? now_playing.seek_position ?? 0;

    if (length && length > 0) {
      const now = Date.now();
      activity.timestamps = {
        start: Math.round(now - seek * 1000),
        end: Math.round(now + (length - seek) * 1000),
      };
    }
  }

  if (cfg.buttons && cfg.buttons.length > 0) {
    activity.buttons = cfg.buttons.slice(0, 2).map((b) => ({
      label: truncate(b.label, 30),
      url: b.url,
    }));
  }

  return activity;
}

module.exports = { buildActivity };
