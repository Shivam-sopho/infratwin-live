import { useState } from "react";
import type { Sensor } from "../types";

const W = 240;
const H = 40;
const PAD = 3;

/** Single-series sparkline with recessive watch/critical guides and a hover crosshair. */
export function Sparkline({ sensor, values }: { sensor: Sensor; values: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (values.length < 2) return <div className="h-10" />;

  const informational = sensor.watch >= 99; // no alarm thresholds: scale to the data itself
  const lo = informational ? Math.min(...values) : Math.min(sensor.baseline * 0.8, ...values);
  const hi = informational ? Math.max(...values) + 1e-6 : Math.max(sensor.critical * 1.1, ...values);
  const x = (i: number) => PAD + (i / (values.length - 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - ((v - lo) / (hi - lo)) * (H - 2 * PAD);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const last = values.length - 1;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-10 w-full"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left) / r.width) * last);
          setHover(Math.max(0, Math.min(last, i)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        {!informational && (
          <>
            <line x1={0} x2={W} y1={y(sensor.watch)} y2={y(sensor.watch)} className="stroke-watch/40" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            <line x1={0} x2={W} y1={y(sensor.critical)} y2={y(sensor.critical)} className="stroke-critical/50" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          </>
        )}
        <path d={d} fill="none" className="stroke-ink-2" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} className="stroke-ink-3" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute -top-6 rounded border border-line bg-bg px-1.5 py-0.5 text-[11px] tabular-nums text-ink"
          style={{ left: `${(hover / last) * 100}%`, transform: "translateX(-50%)" }}
        >
          {values[hover].toFixed(2)} {sensor.unit} · {Math.round(((last - hover) / 2))}s ago
        </div>
      )}
    </div>
  );
}
