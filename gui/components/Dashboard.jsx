import React, { useState, useEffect } from "react";

function formatTime(seconds) {
  if (!seconds || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function NowPlayingCard({ activeZone }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!activeZone || activeZone.state !== "playing") {
      if (activeZone?.state === "paused") {
        setProgress(activeZone.length > 0 ? (activeZone.seekPosition / activeZone.length) * 100 : 0);
      }
      return;
    }

    const update = () => {
      const elapsed = activeZone.seekPosition + (Date.now() - updateStart) / 1000;
      const pct = activeZone.length > 0 ? Math.min((elapsed / activeZone.length) * 100, 100) : 0;
      setProgress(pct);
    };

    const updateStart = Date.now();
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [activeZone]);

  if (!activeZone) {
    return (
      <div className="card now-playing-card">
        <div className="card-title">Now Playing</div>
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <polygon points="10 8 16 12 10 16 10 8" />
          </svg>
          <p>No active playback</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card now-playing-card">
      <div className="card-title">Now Playing</div>
      <div className="now-playing-content">
        {activeZone.coverArtUrl && (
          <img
            className="cover-art"
            src={activeZone.coverArtUrl}
            alt="Cover"
            onError={(e) => { e.target.style.display = "none"; console.error("Cover art load failed:", activeZone.coverArtUrl); }}
          />
        )}
        {!activeZone.coverArtUrl && (
          <div className="cover-art cover-art-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
        )}
        <div className="now-playing-info">
          <div className="track-name">{activeZone.trackName || "Unknown Track"}</div>
          <div className="track-artist">{activeZone.artist || "Unknown Artist"}</div>
          <div className="track-album">{activeZone.album || ""}</div>
          <div className="track-meta">
            <span className={`badge badge-${activeZone.state}`}>
              {activeZone.state === "playing" ? "Playing" : "Paused"}
            </span>
            <span className="zone-name">{activeZone.displayName}</span>
          </div>
          <div className="track-progress">
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="progress-times">
              <span>{formatTime(activeZone.seekPosition)}</span>
              <span>{formatTime(activeZone.length)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ZoneList({ zones }) {
  if (zones.length === 0) {
    return (
      <div className="card">
        <div className="card-title">Zones</div>
        <div className="empty-state">
          <p>No zones available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title">Zones ({zones.length})</div>
      <div className="zone-list">
        {zones.map((zone) => (
          <div key={zone.id} className="zone-item">
            <div className="zone-item-header">
              <span className="zone-item-name">{zone.name}</span>
              <span className={`badge badge-${zone.state}`}>{zone.state}</span>
            </div>
            {zone.nowPlaying && (
              <div className="zone-item-track">
                {zone.nowPlaying.trackName}
                {zone.nowPlaying.artist ? ` — ${zone.nowPlaying.artist}` : ""}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard({ appState }) {
  return (
    <div className="dashboard">
      <div className="dashboard-status-bar">
        <div className={`status-indicator ${appState.roon === "connected" ? "connected" : "disconnected"}`}>
          <span className="status-dot-lg" />
          <span>Roon {appState.roon === "connected" ? "Connected" : "Disconnected"}</span>
        </div>
        <div className={`status-indicator ${appState.discord === "connected" ? "connected" : "disconnected"}`}>
          <span className="status-dot-lg" />
          <span>Discord {appState.discord === "connected" ? "Connected" : "Disconnected"}</span>
        </div>
      </div>
      <NowPlayingCard activeZone={appState.activeZone} />
      <ZoneList zones={appState.zones} />
    </div>
  );
}
