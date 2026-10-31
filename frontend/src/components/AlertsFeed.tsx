import { api } from "../api";
import { useTwin } from "../store";
import { StatusBadge } from "./StatusBadge";

const fmtTime = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour12: false });

export function AlertsFeed() {
  const alerts = useTwin((s) => s.alerts);
  const selectComponent = useTwin((s) => s.selectComponent);
  const triages = useTwin((s) => s.triages);
  const setSideTab = useTwin((s) => s.setSideTab);
  const triageOf = Object.fromEntries(triages.map((t) => [t.alert_id, t]));
  const screens = useTwin((s) => s.screens);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {alerts.length === 0 && <li className="px-3 py-3 text-xs text-ink-3">No alerts. All monitored components nominal.</li>}
        {alerts.map((a) => (
          <li key={a.id}>
            <button
              onClick={() => selectComponent(a.component_id)}
              className="w-full px-3 py-2 text-left hover:bg-white/[0.03]"
            >
              <div className="flex items-center justify-between">
                <StatusBadge status={a.level} />
                <span className="text-[11px] tabular-nums text-ink-3">
                  {a.id} · {fmtTime(a.t)}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-ink">{a.message}</div>
            </button>
            {screens[a.id] && (
              <div className="-mt-1 px-3 pb-1 text-[11px] text-ink-2" title={`${screens[a.id].model} · ${screens[a.id].ms} ms`}>
                <span className="text-ink-3">Glimmer:</span> {screens[a.id].verdict.replace("_", " ")}
                {screens[a.id].escalate ? " · escalate" : ""} · {screens[a.id].reason}
              </div>
            )}
            <div className="-mt-1 border-b border-line/60 px-3 pb-2 text-[11px]">
              {triageOf[a.id] ? (
                <button className="text-accent hover:underline" onClick={() => setSideTab("twin")}>
                  {triageOf[a.id].status === "running"
                    ? "Cognitive Twin assessing…"
                    : triageOf[a.id].status === "done"
                      ? `Assessed: ${triageOf[a.id].result?.severity} severity →`
                      : "Assessment failed →"}
                </button>
              ) : (
                <button className="text-ink-3 hover:text-ink" onClick={() => void api.triage(a.id)}>
                  Ask the Cognitive Twin
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
