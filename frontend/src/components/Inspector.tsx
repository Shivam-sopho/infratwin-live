import { useState } from "react";
import { api } from "../api";
import { useTwin } from "../store";
import type { Finding, Sensor } from "../types";
import { Sparkline } from "./Sparkline";
import { metrologySummary, metrologyTooltip } from "./inspection/metrology";
import { StatusBadge } from "./StatusBadge";
import { VerifyAction } from "./VerifyResult";

function SensorRow({ sensor }: { sensor: Sensor }) {
  const values = useTwin((s) => s.history[sensor.id]) ?? [];
  const status = useTwin((s) => s.status.sensors[sensor.id]) ?? "nominal";
  const latest = values.at(-1);
  return (
    <div className="rounded-md border border-line bg-bg/60 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-ink-2">{sensor.label}</span>
        <StatusBadge status={status} />
      </div>
      <div className="text-lg font-semibold tabular-nums text-ink">
        {latest?.toFixed(2) ?? "—"} <span className="text-xs font-normal text-ink-3">{sensor.unit}</span>
      </div>
      <Sparkline sensor={sensor} values={values} />
      <div className="mt-1 text-[11px] text-ink-3">
        {sensor.watch >= 99 ? "informational · no alarm thresholds" : `watch ≥ ${sensor.watch} · critical ≥ ${sensor.critical}`}
      </div>
    </div>
  );
}

const fmtTime = (t: number) => new Date(t * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

function FindingCard({ f }: { f: Finding }) {
  const selected = useTwin((s) => s.selectedFindingId === f.id);
  const selectFinding = useTwin((s) => s.selectFinding);
  const setTimeTravel = useTwin((s) => s.setTimeTravel);
  const lifted = useTwin((s) => !!s.lifts[f.id]);
  const [lifting, setLifting] = useState<string | null>(null);
  return (
    <div
      onClick={() => selectFinding(f.id)}
      className={`flex cursor-pointer gap-2 rounded-md border p-1.5 ${selected ? "border-defect bg-defect/10" : "border-line bg-bg/60 hover:border-ink-3"}`}
    >
      <img src={f.thumbnail} alt={`${f.concept} thumbnail`} className="h-14 w-14 shrink-0 rounded object-cover" />
      <div className="min-w-0 flex-1 text-[11px] leading-snug">
        <div className="flex items-baseline justify-between gap-1">
          <span className="truncate text-xs font-medium text-ink">{f.concept}</span>
          <span className="flex shrink-0 items-center gap-2">
            <button
              className="text-[11px] text-accent hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                setTimeTravel(f.id);
              }}
            >
              Time-travel
            </button>
            <button
              className="text-[11px] text-accent hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                void api.createMission(f.component_id, f.id);
              }}
            >
              Plan re-scan
            </button>
            <button
            aria-label={`Delete ${f.id}`}
            onClick={(e) => {
              e.stopPropagation();
              void api.deleteFinding(f.id);
            }}
            className="text-ink-3 hover:text-ink"
          >
            ×
          </button>
          </span>
        </div>
        <div className="text-ink-2">
          {f.id}
          {f.confidence != null && ` · conf ${f.confidence.toFixed(2)}`}
          {f.host_label && ` · on ${f.host_label}`}
        </div>
        {f.metrology && (
          <div className="tabular-nums text-ink" title={metrologyTooltip(f.metrology)}>
            {f.metrology.warnings.length > 0 && <span className="mr-1 text-watch">⚠</span>}
            {metrologySummary(f.metrology)}
          </div>
        )}
        <VerifyAction f={f} />
        {f.thumbnail_mask_png && (
          <div onClick={(e) => e.stopPropagation()}>
            {lifted ? (
              <span className="text-[11px] text-ink-2">3D reconstruction on twin (SAM 3D Objects)</span>
            ) : (
              <button
                className="text-[11px] text-accent hover:underline disabled:opacity-50"
                disabled={lifting === "busy"}
                onClick={() => {
                  setLifting("busy");
                  api.lift(f.id).then(
                    () => setLifting(null),
                    (e) => setLifting(e instanceof Error ? e.message : String(e)),
                  );
                }}
              >
                {lifting === "busy" ? "Lifting with SAM 3D (cold start can take minutes)…" : "Lift to 3D (SAM 3D)"}
              </button>
            )}
            {lifting && lifting !== "busy" && <p className="text-[11px] text-ink-3">{lifting}</p>}
          </div>
        )}
        <div className="truncate text-ink-3">
          {f.source === "video" ? `video, ${f.frames_tracked} frames` : "photo"} · {f.source_name} · {fmtTime(f.t)}
        </div>
      </div>
    </div>
  );
}

export function Inspector() {
  const assets = useTwin((s) => s.assets);
  const selectedAssetId = useTwin((s) => s.selectedAssetId);
  const selectedComponentId = useTwin((s) => s.selectedComponentId);
  const componentStatus = useTwin((s) => s.status.components);
  const sensors = useTwin((s) => s.sensors);
  const selectComponent = useTwin((s) => s.selectComponent);
  const selectAsset = useTwin((s) => s.selectAsset);
  const findings = useTwin((s) => s.findings);
  const notes = useTwin((s) => s.notes);

  const asset = assets.find((a) => a.id === selectedAssetId) ?? assets[0];
  if (!asset) return null;
  const comp = asset.components.find((c) => c.id === selectedComponentId);
  const findingCount: Record<string, number> = {};
  for (const f of findings) findingCount[f.component_id] = (findingCount[f.component_id] ?? 0) + 1;
  const compFindings = comp ? findings.filter((f) => f.component_id === comp.id).sort((a, b) => b.t - a.t) : [];

  return (
    <section className="flex min-h-0 flex-col gap-3 p-3">
      <div>
        <div className="text-[11px] uppercase tracking-wider text-ink-3">Asset</div>
        <select
          value={asset.id}
          onChange={(e) => selectAsset(e.target.value)}
          aria-label="Asset"
          className="-ml-1 max-w-full rounded border border-transparent bg-transparent px-1 font-semibold text-ink hover:border-line"
        >
          {[...new Set(assets.map((a) => a.region))].map((r) => (
            <optgroup key={r} label={r}>
              {assets
                .filter((a) => a.region === r)
                .map((a) => (
                  <option key={a.id} value={a.id} className="bg-panel">
                    {a.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <p className="text-xs text-ink-2">{asset.description}</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {asset.components.map((c) => (
          <button
            key={c.id}
            onClick={() => selectComponent(c.id)}
            className={`rounded border px-2 py-1 text-xs transition-colors ${
              c.id === selectedComponentId ? "border-accent bg-accent/10 text-ink" : "border-line text-ink-2 hover:border-ink-3"
            }`}
          >
            <StatusBadge status={componentStatus[c.id] ?? "nominal"} compact /> <span className="ml-0.5">{c.name}</span>
            {findingCount[c.id] ? (
              <span className="ml-1 inline-flex items-center gap-0.5 text-ink-2" title={`${findingCount[c.id]} pinned findings`}>
                <span className="inline-block h-1.5 w-1.5 rounded-sm bg-defect" />
                {findingCount[c.id]}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {comp ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-sm font-semibold text-ink">
              {comp.name} <span className="font-normal text-ink-3">· {comp.kind.replace("_", " ")}</span>
            </div>
            {comp.geometry && comp.geometry.shape !== "arch" && (
              <button className="text-[11px] text-accent hover:underline" onClick={() => void api.createMission(comp.id)}>
                Plan drone re-scan
              </button>
            )}
          </div>
          {comp.sensor_ids.map((id) => (
            <SensorRow key={id} sensor={sensors[id]} />
          ))}
          <div className="mt-1 text-[11px] uppercase tracking-wider text-ink-3">Inspection findings ({compFindings.length})</div>
          {compFindings.length === 0 ? (
            <p className="text-xs text-ink-3">None pinned. Run SAM 3.1 in the Inspection tab and pin defects here.</p>
          ) : (
            compFindings.map((f) => <FindingCard key={f.id} f={f} />)
          )}
          {notes.some((n) => n.component_id === comp.id) && (
            <>
              <div className="mt-1 text-[11px] uppercase tracking-wider text-ink-3">Field notes</div>
              {notes
                .filter((n) => n.component_id === comp.id)
                .reverse()
                .map((n) => (
                  <div key={n.id} className="rounded-md border border-line bg-bg/60 px-2 py-1.5 text-xs" title={`Heard: “${n.transcript}”`}>
                    <div className="text-ink">{n.text}</div>
                    <div className="text-[11px] text-ink-3">
                      {n.id} · voice · {fmtTime(n.t)}
                    </div>
                  </div>
                ))}
            </>
          )}
        </div>
      ) : (
        <p className="text-xs text-ink-3">Select a component in the twin or the list above to see its live sensors.</p>
      )}
    </section>
  );
}
