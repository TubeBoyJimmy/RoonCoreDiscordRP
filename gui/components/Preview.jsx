import React, { useState, useEffect } from "react";

function formatTime(seconds) {
  if (!seconds || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function DiscordCard({ appState }) {
  const { activeZone, lastActivity } = appState;
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!activeZone || activeZone.state !== "playing") {
      setElapsed(activeZone?.seekPosition || 0);
      return;
    }
    const startTime = Date.now();
    const startSeek = activeZone.seekPosition;
    const tick = () => setElapsed(startSeek + (Date.now() - startTime) / 1000);
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [activeZone]);

  if (!activeZone || !lastActivity) {
    return (
      <div className="discord-preview-empty">
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
          </svg>
          <p>No active Discord presence</p>
          <p style={{ fontSize: 12, marginTop: 4 }}>Start playing music in Roon to see the preview</p>
        </div>
      </div>
    );
  }

  const remaining = activeZone.length > 0 ? activeZone.length - elapsed : 0;

  return (
    <div className="discord-card">
      <div className="discord-card-header">
        <span className="discord-listening-label">LISTENING TO ROON</span>
      </div>
      <div className="discord-card-body">
        <div className="discord-art-container">
          {activeZone.coverArtUrl ? (
            <img className="discord-large-art" src={activeZone.coverArtUrl} alt="Cover" />
          ) : (
            <div className="discord-large-art discord-art-placeholder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>
          )}
          <div className={`discord-small-art ${activeZone.state}`}>
            {activeZone.state === "playing" ? (
              <svg viewBox="0 0 16 16" fill="white">
                <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393"/>
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="white">
                <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5"/>
              </svg>
            )}
          </div>
        </div>
        <div className="discord-info">
          <div className="discord-details">{lastActivity.details || ""}</div>
          <div className="discord-state">{lastActivity.state || ""}</div>
          {lastActivity.assets?.large_text && (
            <div className="discord-album">{lastActivity.assets.large_text}</div>
          )}
          {activeZone.state === "playing" && activeZone.length > 0 && (
            <div className="discord-timestamps">
              {formatTime(elapsed)} / {formatTime(activeZone.length)}
            </div>
          )}
        </div>
      </div>
      {activeZone.state === "playing" && activeZone.length > 0 && (
        <div className="discord-progress">
          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{ width: `${activeZone.length > 0 ? (elapsed / activeZone.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function Preview({ appState }) {
  return (
    <div className="preview-page">
      <h2 className="settings-page-title">Discord Preview</h2>
      <p style={{ color: "var(--text-secondary)", marginBottom: 24, fontSize: 13 }}>
        Live preview of how your Rich Presence appears on Discord
      </p>
      <div className="preview-container">
        <DiscordCard appState={appState} />
      </div>
      {appState.lastActivity && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="card-title">Raw Activity Data</div>
          <pre className="activity-json">{JSON.stringify(appState.lastActivity, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
