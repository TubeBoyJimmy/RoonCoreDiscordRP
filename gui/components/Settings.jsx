import React, { useState, useEffect } from "react";
import { useConfig } from "../hooks/useIpc";

function ToggleField({ label, hint, checked, onChange }) {
  return (
    <div className="settings-field">
      <div className="settings-field-row">
        <div>
          <div className="form-label" style={{ marginBottom: 0 }}>{label}</div>
          {hint && <div className="form-hint">{hint}</div>}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
          <span className="toggle-slider" />
        </label>
      </div>
    </div>
  );
}

function InputField({ label, hint, value, onChange, type = "text", placeholder }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input
        className="form-input"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {hint && <div className="form-hint">{hint}</div>}
    </div>
  );
}

export default function Settings() {
  const { config, update, reload } = useConfig();
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(false);
  const [autoLaunch, setAutoLaunch] = useState(false);

  useEffect(() => {
    if (config && !draft) {
      setDraft(JSON.parse(JSON.stringify(config)));
    }
  }, [config]);

  useEffect(() => {
    window.api?.getAutoLaunch?.().then(setAutoLaunch).catch(() => {});
  }, []);

  if (!draft) return <div className="empty-state"><p>Loading configuration...</p></div>;

  const patchDraft = (section, key, value) => {
    setDraft((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }));
    setSaved(false);
  };

  const handleSave = async () => {
    await update({
      roon: draft.roon,
      display: draft.display,
      discord: draft.discord,
      logging: draft.logging,
      gui: draft.gui,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    setDraft(JSON.parse(JSON.stringify(config)));
    setSaved(false);
  };

  return (
    <div className="settings">
      <div className="settings-header">
        <h2 className="settings-page-title">Settings</h2>
        <div className="settings-actions">
          <button className="btn" onClick={handleReset}>Reset</button>
          <button className="btn btn-primary" onClick={handleSave}>
            {saved ? "Saved!" : "Save"}
          </button>
        </div>
      </div>

      <div className="card settings-section">
        <div className="card-title">Roon Connection</div>
        <InputField
          label="Core Address"
          hint="Leave empty for auto-discovery, or enter IP:port for manual connection"
          value={draft.roon.coreAddress}
          onChange={(v) => patchDraft("roon", "coreAddress", v)}
          placeholder="e.g. 192.168.1.100:9100"
        />
      </div>

      <div className="card settings-section">
        <div className="card-title">Display Options</div>
        <ToggleField
          label="Show Album"
          hint="Display album name as large image tooltip"
          checked={draft.display.showAlbum}
          onChange={(v) => patchDraft("display", "showAlbum", v)}
        />
        <ToggleField
          label="Show Artist"
          hint="Display artist name in activity state"
          checked={draft.display.showArtist}
          onChange={(v) => patchDraft("display", "showArtist", v)}
        />
        <ToggleField
          label="Show Cover Art"
          hint="Upload and display album cover art"
          checked={draft.display.showCoverArt}
          onChange={(v) => patchDraft("display", "showCoverArt", v)}
        />
        <ToggleField
          label="Show Progress"
          hint="Display progress bar with timestamps"
          checked={draft.display.showProgress}
          onChange={(v) => patchDraft("display", "showProgress", v)}
        />
        <div className="form-group">
          <label className="form-label">Pause Timeout (seconds)</label>
          <input
            className="form-input"
            type="number"
            min="0"
            value={draft.display.pauseTimeout}
            onChange={(e) => patchDraft("display", "pauseTimeout", Math.max(0, parseInt(e.target.value) || 0))}
            style={{ width: "120px" }}
          />
          <div className="form-hint">Seconds to wait before clearing activity on pause (0 = never)</div>
        </div>
      </div>

      <div className="card settings-section">
        <div className="card-title">Discord</div>
        <InputField
          label="Client ID"
          hint="Discord Application ID (pre-configured, change only if using custom app)"
          value={draft.discord.clientId}
          onChange={(v) => patchDraft("discord", "clientId", v)}
        />
        <div className="form-group">
          <label className="form-label">IPC Pipe Number</label>
          <input
            className="form-input"
            type="number"
            min="0"
            max="9"
            value={draft.discord.pipeNumber}
            onChange={(e) => patchDraft("discord", "pipeNumber", Math.min(9, Math.max(0, parseInt(e.target.value) || 0)))}
            style={{ width: "80px" }}
          />
          <div className="form-hint">0-9, change if you have multiple Discord instances</div>
        </div>
      </div>

      <div className="card settings-section">
        <div className="card-title">Application</div>
        <ToggleField
          label="Start on Boot"
          hint="Automatically launch when Windows starts"
          checked={autoLaunch}
          onChange={async (v) => {
            const result = await window.api.setAutoLaunch(v);
            setAutoLaunch(result);
          }}
        />
        <ToggleField
          label="Minimize to Tray"
          hint="Close window minimizes to system tray instead of quitting"
          checked={draft.gui?.minimizeToTray !== false}
          onChange={(v) => patchDraft("gui", "minimizeToTray", v)}
        />
      </div>

      <div className="card settings-section">
        <div className="card-title">Logging</div>
        <ToggleField
          label="Debug Mode"
          hint="Enable verbose logging output"
          checked={draft.logging.debug}
          onChange={(v) => patchDraft("logging", "debug", v)}
        />
      </div>
    </div>
  );
}
