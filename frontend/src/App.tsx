import { useEffect } from "react";
import { api, setUnauthorizedHandler } from "./api";
import { SideFeed } from "./components/SideFeed";
import { LoginGate } from "./components/LoginGate";
import { TimeTravel } from "./components/TimeTravel";
import { CorridorMap } from "./components/CorridorMap";
import { Inspector } from "./components/Inspector";
import { TopBar } from "./components/TopBar";
import { CenterPane } from "./components/CenterPane";
import { useTwin } from "./store";
import { useTelemetry } from "./useTelemetry";

export default function App() {
  useTelemetry();
  useEffect(() => {
    setUnauthorizedHandler(() => useTwin.getState().setAuthRequired(true));
    api.assets().then(useTwin.getState().setAssets, console.error);
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-bg text-ink">
      <TopBar />
      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[1fr_1fr_380px] lg:overflow-hidden">
        <div className="h-[50vh] border-b border-line lg:h-auto lg:border-r lg:border-b-0">
          <CorridorMap />
        </div>
        <div className="h-[50vh] border-b border-line lg:h-auto lg:border-r lg:border-b-0">
          <CenterPane />
        </div>
        <aside className="grid min-h-0 grid-rows-[minmax(0,1.25fr)_minmax(0,1fr)] bg-panel">
          <div className="min-h-0 overflow-y-auto border-b border-line">
            <Inspector />
          </div>
          <SideFeed />
        </aside>
      </main>
      <TimeTravel />
      <LoginGate />
    </div>
  );
}
