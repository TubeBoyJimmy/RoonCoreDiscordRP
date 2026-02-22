import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLogs } from "../hooks/useIpc";

const LEVEL_COLORS = {
  debug: "var(--log-debug)",
  info: "var(--log-info)",
  warn: "var(--log-warn)",
  error: "var(--log-error)",
};

const ALL_LEVELS = ["debug", "info", "warn", "error"];

function LogEntry({ entry }) {
  return (
    <div className="log-entry">
      <span className="log-timestamp">{entry.timestamp}</span>
      <span className="log-level" style={{ color: LEVEL_COLORS[entry.level] }}>
        [{entry.level.toUpperCase()}]
      </span>
      {entry.prefix && <span className="log-prefix">[{entry.prefix}]</span>}
      <span className="log-message">{entry.message}</span>
    </div>
  );
}

export default function Logs() {
  const logs = useLogs();
  const [autoScroll, setAutoScroll] = useState(true);
  const [levelFilter, setLevelFilter] = useState(new Set(ALL_LEVELS));
  const [prefixFilter, setPrefixFilter] = useState("");
  const containerRef = useRef(null);
  const wasAutoScroll = useRef(true);

  const filteredLogs = logs.filter((entry) => {
    if (!levelFilter.has(entry.level)) return false;
    if (prefixFilter && !entry.prefix.toLowerCase().includes(prefixFilter.toLowerCase())) {
      return false;
    }
    return true;
  });

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filteredLogs.length, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 30;
    if (wasAutoScroll.current && !isAtBottom) {
      setAutoScroll(false);
    } else if (!wasAutoScroll.current && isAtBottom) {
      setAutoScroll(true);
    }
    wasAutoScroll.current = isAtBottom;
  }, []);

  const toggleLevel = (level) => {
    setLevelFilter((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  };

  return (
    <div className="logs-page">
      <div className="settings-header">
        <h2 className="settings-page-title">Logs</h2>
        <div className="settings-actions">
          <button
            className={`btn btn-sm ${autoScroll ? "btn-primary" : ""}`}
            onClick={() => setAutoScroll(!autoScroll)}
          >
            Auto-scroll {autoScroll ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      <div className="logs-filters">
        <div className="logs-level-filters">
          {ALL_LEVELS.map((level) => (
            <button
              key={level}
              className={`btn btn-sm log-filter-btn ${levelFilter.has(level) ? "active" : ""}`}
              style={{
                borderColor: levelFilter.has(level) ? LEVEL_COLORS[level] : undefined,
                color: levelFilter.has(level) ? LEVEL_COLORS[level] : undefined,
              }}
              onClick={() => toggleLevel(level)}
            >
              {level.toUpperCase()}
            </button>
          ))}
        </div>
        <input
          className="form-input logs-search"
          type="text"
          placeholder="Filter by prefix..."
          value={prefixFilter}
          onChange={(e) => setPrefixFilter(e.target.value)}
        />
      </div>

      <div className="logs-container" ref={containerRef} onScroll={handleScroll}>
        {filteredLogs.length === 0 ? (
          <div className="empty-state" style={{ padding: "32px 0" }}>
            <p>No log entries{logs.length > 0 ? " matching filters" : ""}</p>
          </div>
        ) : (
          filteredLogs.map((entry, i) => <LogEntry key={i} entry={entry} />)
        )}
      </div>
    </div>
  );
}
