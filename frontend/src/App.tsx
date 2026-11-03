import { useEffect } from "react";
import { api, setUnauthorizedHandler } from "./api";
import { SideFeed } from "./components/SideFeed";
import { LoginGate } from "./components/LoginGate";
import { TimeTravel } from "./components/TimeTravel";
import { Autopilot } from "./components/Autopilot";
import { Spotlight } from "./components/Spotlight";
import { Welcome } from "./components/Welcome";
import { CorridorMap } from "./components/CorridorMap";
import { Inspector } from "./components/Inspector";
import { TopBar } from "./components/TopBar";
import { CenterPane } from "./components/CenterPane";
import { GlobeView } from "./components/GlobeView";
import { useTwin } from "./store";
import { useTelemetry } from "./useTelemetry";

export default function App() {
  useTelemetry();
  useEffect(() => {
    setUnauthorizedHandler(() => useTwin.getState().setAuthRequired(true));
    api.assets().then(useTwin.getState().setAssets, console.error);
  }, []);

  const presenting = useTwin((s) => s.tourOpen);
  const view = useTwin((s) => s.view);
  const focus = useTwin((s) => s.stage.focus);
  // Presentation "camera": the panel the story is about gets the space (animated on large screens).
  const columns = { map: "2.4fr 1fr 0px", center: "0.45fr 2.2fr 0px", "twin+side": "0.5fr 1.6fr 460px" }[focus ?? "map"];

  return (
    <div className={`flex h-dvh flex-col bg-bg text-ink ${presenting ? "pb-[124px]" : ""}`}>
      <TopBar />
      {view === "globe" && (
        <div className="min-h-0 flex-1">
          <GlobeView />
        </div>
      )}
      <main
        hidden={view === "globe"}
        className="app-grid grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:overflow-hidden"
        style={{ "--cols": focus ? columns : "1fr 1fr 380px" } as React.CSSProperties}
      >
        <div data-spot="map" className="h-[50vh] min-w-0 border-b border-line lg:h-auto lg:border-r lg:border-b-0">
          <CorridorMap />
        </div>
        <div data-spot="center" className="h-[50vh] min-w-0 border-b border-line lg:h-auto lg:border-r lg:border-b-0">
          <CenterPane />
        </div>
        <aside data-spot="side" className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1.25fr)_minmax(0,1fr)] overflow-hidden bg-panel">
          <div className="min-h-0 overflow-y-auto border-b border-line">
            <Inspector />
          </div>
          <SideFeed />
        </aside>
      </main>
      <TimeTravel />
      <Spotlight />
      <Welcome />
      <Autopilot />
      <LoginGate />
    </div>
  );
}
