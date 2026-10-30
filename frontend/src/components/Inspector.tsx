import { useTwin } from "../store";
import type { Sensor } from "../types";
import { Sparkline } from "./Sparkline";
import { StatusBadge } from "./StatusBadge";

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
        watch ≥ {sensor.watch} · critical ≥ {sensor.critical}
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

  const asset = assets.find((a) => a.id === selectedAssetId) ?? assets[0];
  if (!asset) return null;
  const comp = asset.components.find((c) => c.id === selectedComponentId);

  return (
    <section className="flex min-h-0 flex-col gap-3 p-3">
      <div>
        <div className="text-[11px] uppercase tracking-wider text-ink-3">Asset</div>
        <div className="font-semibold text-ink">{asset.name}</div>
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
          </button>
        ))}
      </div>

      {comp ? (
        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold text-ink">
            {comp.name} <span className="font-normal text-ink-3">· {comp.kind.replace("_", " ")}</span>
          </div>
          {comp.sensor_ids.map((id) => (
            <SensorRow key={id} sensor={sensors[id]} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-ink-3">Select a component in the twin or the list above to see its live sensors.</p>
      )}
    </section>
  );
}
