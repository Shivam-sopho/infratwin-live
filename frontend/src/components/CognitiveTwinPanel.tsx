import { api } from "../api";
import { useTwin } from "../store";
import { SEVERITY_STATUS, STATUS_COLOR, STATUS_ICON } from "../theme";
import type { Triage } from "../types";

const fmtTime = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour12: false });

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-3">{title}</div>
      <ul className="ml-3 list-disc text-ink-2 marker:text-ink-3">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function TriageCard({ tri }: { tri: Triage }) {
  const components = useTwin((s) => s.components);
  const selectComponent = useTwin((s) => s.selectComponent);
  const setCenterTab = useTwin((s) => s.setCenterTab);
  const comp = components[tri.component_id];
  const r = tri.result;
  const sevStatus = r ? SEVERITY_STATUS[r.severity] : null;

  return (
    <article className="flex flex-col gap-1.5 border-b border-line/60 px-3 py-2.5 text-xs">
      <header className="flex items-center justify-between gap-2">
        <button className="truncate font-medium text-ink hover:underline" onClick={() => selectComponent(tri.component_id)}>
          {comp?.name ?? tri.component_id}
        </button>
        <span className="shrink-0 text-[11px] tabular-nums text-ink-3">
          {tri.id} · {tri.alert_id} · {fmtTime(tri.t)}
        </span>
      </header>

      {(tri.reasoning || tri.status === "running") && (
        <p className="border-l-2 border-line pl-2 italic text-ink-2">
          {tri.reasoning}
          {tri.status === "running" && <span className="ml-0.5 inline-block animate-pulse not-italic text-accent">▍</span>}
          {!tri.reasoning && tri.status === "running" && <span className="text-ink-3">{tri.model} is assessing the alert…</span>}
        </p>
      )}

      {tri.status === "error" && <p className="rounded border border-critical/40 px-2 py-1 text-ink-2">Triage failed: {tri.error}</p>}

      {r && sevStatus && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 font-medium text-ink">
              <span style={{ color: STATUS_COLOR[sevStatus] }} aria-hidden>
                {STATUS_ICON[sevStatus]}
              </span>
              {r.severity[0].toUpperCase() + r.severity.slice(1)} severity
            </span>
            <span className="text-ink-3">· confidence {Math.round(r.confidence * 100)}%</span>
          </div>
          <p className="text-ink">{r.summary}</p>
          <Section title="Likely causes" items={r.likely_causes} />
          <Section title="Evidence" items={r.evidence} />
          <Section title="Recommended actions" items={r.recommended_actions} />
          {r.visual_audit_needed && (
            <div className="flex items-center justify-between gap-2 rounded border border-accent/40 bg-accent/5 px-2 py-1.5">
              <span className="text-ink-2">
                Visual audit: <span className="text-ink">{r.visual_audit_target}</span>
              </span>
              <span className="flex shrink-0 gap-1">
                <button
                  className="rounded border border-accent px-2 py-0.5 text-[11px] text-ink hover:bg-accent/15"
                  onClick={() => void api.createMission(tri.component_id)}
                >
                  Plan drone re-scan
                </button>
                <button
                  className="rounded border border-line px-2 py-0.5 text-[11px] text-ink-2 hover:text-ink"
                  onClick={() => {
                    selectComponent(tri.component_id);
                    setCenterTab("inspect");
                  }}
                >
                  Open inspection
                </button>
              </span>
            </div>
          )}
          <div className="text-[10px] text-ink-3">
            {tri.model}
            {tri.ms != null && ` · ${(tri.ms / 1000).toFixed(1)}s`}
          </div>
        </div>
      )}
    </article>
  );
}

export function CognitiveTwinPanel() {
  const triages = useTwin((s) => s.triages);
  if (triages.length === 0) {
    return (
      <p className="px-3 py-3 text-xs text-ink-3">
        When a sensor goes critical, Muse Spark assesses the component using its live traces, neighbouring sensors and
        pinned inspection findings. Reasoning streams here.
      </p>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {[...triages].reverse().map((t) => (
        <TriageCard key={t.id} tri={t} />
      ))}
    </div>
  );
}
