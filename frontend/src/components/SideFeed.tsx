import { useTwin } from "../store";
import { AlertsFeed } from "./AlertsFeed";
import { CognitiveTwinPanel } from "./CognitiveTwinPanel";
import { MissionsPanel } from "./MissionsPanel";

export function SideFeed() {
  const tab = useTwin((s) => s.sideTab);
  const setTab = useTwin((s) => s.setSideTab);
  const nAlerts = useTwin((s) => s.alerts.length);
  const running = useTwin((s) => s.triages.some((t) => t.status === "running"));
  const planning = useTwin((s) => s.missions.some((m) => m.status === "running"));
  const tabs = [
    { id: "alerts" as const, label: `Alerts (${nAlerts})` },
    { id: "twin" as const, label: "Cognitive Twin" },
    { id: "missions" as const, label: "Missions" },
  ];
  return (
    <section className="flex min-h-0 flex-col">
      <div className="flex border-b border-line" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-[11px] uppercase tracking-wider ${
              tab === t.id ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink-2"
            }`}
          >
            {t.label}
            {((t.id === "twin" && running) || (t.id === "missions" && planning)) && (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-label="working" />
            )}
          </button>
        ))}
      </div>
      {tab === "alerts" ? <AlertsFeed /> : tab === "twin" ? <CognitiveTwinPanel /> : <MissionsPanel />}
    </section>
  );
}
