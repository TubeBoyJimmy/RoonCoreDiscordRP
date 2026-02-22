import React, { useState } from "react";
import Sidebar from "./components/Sidebar";
import Dashboard from "./components/Dashboard";
import Settings from "./components/Settings";
import Preview from "./components/Preview";
import Cache from "./components/Cache";
import Logs from "./components/Logs";
import { useAppState } from "./hooks/useIpc";

const pages = {
  dashboard: Dashboard,
  settings: Settings,
  preview: Preview,
  cache: Cache,
  logs: Logs,
};

export default function App() {
  const [activePage, setActivePage] = useState("dashboard");
  const appState = useAppState();

  const PageComponent = pages[activePage];

  return (
    <div className="app-layout">
      <div className="titlebar">
        <span className="titlebar-title">RoonCoreDiscordRP</span>
        <div className="titlebar-controls">
          <button className="titlebar-btn" onClick={() => window.api.windowMinimize()} title="Minimize">
            &#x2212;
          </button>
          <button className="titlebar-btn" onClick={() => window.api.windowMaximize()} title="Maximize">
            &#x25A1;
          </button>
          <button className="titlebar-btn close" onClick={() => window.api.windowClose()} title="Close">
            &#x2715;
          </button>
        </div>
      </div>
      <div className="main-container">
        <Sidebar
          activePage={activePage}
          onNavigate={setActivePage}
          roonStatus={appState.roon}
          discordStatus={appState.discord}
        />
        <div className="content">
          <PageComponent appState={appState} />
        </div>
      </div>
    </div>
  );
}
