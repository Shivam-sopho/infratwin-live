import { useTwin } from "../store";
import type { Mission } from "../types";

const fmtTime = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour12: false });
const pct = (v: number | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);

function CoverageBar({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-ink-3">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full" style={{ width: `${value * 100}%`, background: tone }} />
      </div>
      <span className="w-9 text-right tabular-nums text-ink">{pct(value)}</span>
    </div>
  );
}

function MissionCard({ m }: { m: Mission }) {
  const components = useTwin((s) => s.components);
  const selected = useTwin((s) => s.selectedMissionId === m.id);
  const selectMission = useTwin((s) => s.selectMission);
  const best = m.chosen[0];

  return (
    <article className={`flex flex-col gap-1.5 border-b border-line/60 px-3 py-2.5 text-xs ${selected ? "bg-white/[0.03]" : ""}`}>
      <header className="flex items-center justify-between gap-2">
        <button className="truncate font-medium text-ink hover:underline" onClick={() => selectMission(m.id)}>
          UAV re-scan · {components[m.component_id]?.name}
          {m.finding_id && <span className="font-normal text-ink-3"> · {m.finding_id}</span>}
        </button>
        <span className="shrink-0 text-[11px] tabular-nums text-ink-3">
          {m.id} · {fmtTime(m.t)}
        </span>
      </header>

      {(m.reasoning || m.status === "running") && (
        <p className="border-l-2 border-line pl-2 italic text-ink-2">
          {m.reasoning}
          {m.status === "running" && <span className="ml-0.5 inline-block animate-pulse not-italic text-accent">▍</span>}
          {!m.reasoning && m.status === "running" && <span className="text-ink-3">{m.model} is planning the flight…</span>}
        </p>
      )}

      {m.tool_calls.length > 0 && (
        <ol className="flex flex-col gap-0.5 font-mono text-[11px] text-ink-2">
          {m.tool_calls.map((c, i) => (
            <li key={i}>
              <span className="text-accent">{c.name}</span>({Object.entries(c.args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}) → {c.summary}
            </li>
          ))}
        </ol>
      )}

      {m.status === "error" && <p className="rounded border border-critical/40 px-2 py-1 text-ink-2">Planning failed: {m.error}</p>}
      {m.note && <p className="text-ink-3">{m.note}</p>}

      {m.status === "done" && m.baseline && best && (
        <div className="flex flex-col gap-1">
          <CoverageBar label="Square-on" value={m.baseline.coverage} tone="#94a3b8" />
          <CoverageBar label="Planned" value={Math.max(...m.chosen.map((v) => v.coverage))} tone="#34d399" />
          {m.baseline.blocked_by.length > 0 && <div className="text-ink-3">Square-on view blocked by {m.baseline.blocked_by.join(", ")}</div>}
        </div>
      )}

      {m.plan && (
        <div className="flex flex-col gap-1">
          <p className="text-ink">{m.plan.summary}</p>
          <div className="text-ink-2">Gimbal: {m.plan.gimbal_notes}</div>
          {m.plan.rationale.length > 0 && (
            <ul className="ml-3 list-disc text-ink-2 marker:text-ink-3">
              {m.plan.rationale.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          {m.plan.safety_notes.length > 0 && (
            <div className="text-ink-2">
              <span className="text-[10px] uppercase tracking-wider text-ink-3">Safety </span>
              {m.plan.safety_notes.join(" · ")}
            </div>
          )}
        </div>
      )}

      {m.path && (
        <div className="flex items-center justify-between text-[11px] text-ink-3">
          <span>
            {m.chosen.map((v) => `yaw ${v.yaw_deg}° pitch ${v.pitch_deg}° @ ${v.standoff_m} m`).join(" + ")} · {m.path.waypoints.length} waypoints ·{" "}
            {m.path.length_m} m{m.path.detours ? ` · ${m.path.detours} detour` : ""}
          </span>
          <button className="text-accent hover:underline" onClick={() => selectMission(m.id)}>
            Show in twin
          </button>
        </div>
      )}
    </article>
  );
}

export function MissionsPanel() {
  const missions = useTwin((s) => s.missions);
  if (missions.length === 0) {
    return (
      <p className="px-3 py-3 text-xs text-ink-3">
        Plan a drone re-scan from a pinned finding or a component. Muse Wonder scores camera poses around occluders
        (Algorithm 2) and returns a collision-checked flight.
      </p>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {[...missions].reverse().map((m) => (
        <MissionCard key={m.id} m={m} />
      ))}
    </div>
  );
}
