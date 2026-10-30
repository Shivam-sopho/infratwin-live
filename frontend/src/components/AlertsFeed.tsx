import { useTwin } from "../store";
import { StatusBadge } from "./StatusBadge";

const fmtTime = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour12: false });

export function AlertsFeed() {
  const alerts = useTwin((s) => s.alerts);
  const selectComponent = useTwin((s) => s.selectComponent);

  return (
    <section className="flex min-h-0 flex-col">
      <h2 className="border-b border-line px-3 py-2 text-[11px] uppercase tracking-wider text-ink-3">
        Alerts <span className="tabular-nums">({alerts.length})</span>
      </h2>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {alerts.length === 0 && <li className="px-3 py-3 text-xs text-ink-3">No alerts. All monitored components nominal.</li>}
        {alerts.map((a) => (
          <li key={a.id}>
            <button
              onClick={() => selectComponent(a.component_id)}
              className="w-full border-b border-line/60 px-3 py-2 text-left hover:bg-white/[0.03]"
            >
              <div className="flex items-center justify-between">
                <StatusBadge status={a.level} />
                <span className="text-[11px] tabular-nums text-ink-3">
                  {a.id} · {fmtTime(a.t)}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-ink">{a.message}</div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
