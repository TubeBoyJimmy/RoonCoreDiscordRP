import React, { useState } from "react";
import { useCache } from "../hooks/useIpc";

function localImageUrl(coreHttpBase, imageKey) {
  if (!coreHttpBase || !imageKey) return null;
  return `${coreHttpBase}/api/image/${imageKey}?scale=fit&width=300&height=300&format=image/jpeg`;
}

function CacheEntry({ entry, onRemove, coreHttpBase }) {
  const [showPreview, setShowPreview] = useState(false);

  const expiryDate = entry.expiry > 0
    ? new Date(entry.expiry).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Never";

  const isExpiringSoon =
    entry.expiry > 0 && entry.expiry - Date.now() < 3 * 24 * 60 * 60 * 1000;

  // Use Roon Core's local HTTP image API for preview (catbox URLs may be unreachable from Electron)
  const previewSrc = localImageUrl(coreHttpBase, entry.key) || entry.value;

  return (
    <div className="cache-entry">
      <div className="cache-entry-main">
        <div
          className="cache-entry-preview-thumb"
          onClick={() => setShowPreview(!showPreview)}
        >
          <img src={previewSrc} alt="" loading="lazy" />
        </div>
        <div className="cache-entry-info">
          <div className="cache-entry-key" title={entry.key}>
            {entry.key}
          </div>
          <div className="cache-entry-url">
            <a href={entry.value} target="_blank" rel="noreferrer">
              {entry.value}
            </a>
          </div>
          <div className="cache-entry-expiry">
            Expires: <span className={isExpiringSoon ? "expiring-soon" : ""}>{expiryDate}</span>
          </div>
        </div>
        <button className="btn btn-sm btn-danger" onClick={() => onRemove(entry.key)}>
          Remove
        </button>
      </div>
      {showPreview && (
        <div className="cache-entry-preview-large">
          <img src={previewSrc} alt="Cover preview" />
        </div>
      )}
    </div>
  );
}

export default function CachePage({ appState }) {
  const { entries, clear, remove, reload } = useCache();

  return (
    <div className="cache-page">
      <div className="settings-header">
        <div>
          <h2 className="settings-page-title">Image Cache</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 4 }}>
            {entries.length} cached image{entries.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="settings-actions">
          <button className="btn" onClick={reload}>Refresh</button>
          {entries.length > 0 && (
            <button className="btn btn-danger" onClick={clear}>Clear All</button>
          )}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            </svg>
            <p>No cached images</p>
            <p style={{ fontSize: 12, marginTop: 4 }}>Images will appear here when cover art is uploaded</p>
          </div>
        </div>
      ) : (
        <div className="cache-list">
          {entries.map((entry) => (
            <CacheEntry
              key={entry.key}
              entry={entry}
              onRemove={remove}
              coreHttpBase={appState?.coreHttpBase}
            />
          ))}
        </div>
      )}
    </div>
  );
}
