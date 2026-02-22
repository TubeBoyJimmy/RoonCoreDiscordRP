import { useState, useEffect, useCallback } from "react";

export function useAppState() {
  const [state, setState] = useState({
    roon: "disconnected",
    discord: "disconnected",
    activeZone: null,
    zones: [],
    lastActivity: null,
  });

  useEffect(() => {
    // Initial fetch
    window.api.getState().then(setState);

    // Subscribe to updates
    const unsub = window.api.onStateChanged(setState);
    return unsub;
  }, []);

  return state;
}

export function useLogs() {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    window.api.getLogs().then(setLogs);

    const unsub = window.api.onLog((entry) => {
      setLogs((prev) => {
        const next = [...prev, entry];
        return next.length > 500 ? next.slice(-500) : next;
      });
    });
    return unsub;
  }, []);

  return logs;
}

export function useConfig() {
  const [config, setConfig] = useState(null);

  const load = useCallback(async () => {
    const cfg = await window.api.getConfig();
    setConfig(cfg);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = useCallback(
    async (patch) => {
      const updated = await window.api.updateConfig(patch);
      setConfig(updated);
    },
    []
  );

  return { config, update, reload: load };
}

export function useCache() {
  const [entries, setEntries] = useState([]);

  const load = useCallback(async () => {
    const data = await window.api.getCache();
    setEntries(data);
  }, []);

  useEffect(() => {
    load();
    const unsub = window.api.onCacheChanged(setEntries);
    return unsub;
  }, [load]);

  const clear = useCallback(async () => {
    await window.api.clearCache();
    setEntries([]);
  }, []);

  const remove = useCallback(async (key) => {
    await window.api.removeCacheEntry(key);
  }, []);

  return { entries, clear, remove, reload: load };
}
