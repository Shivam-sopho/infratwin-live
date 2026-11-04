import { useEffect, useMemo, useRef, useState } from "react";
import { RECORD } from "../store";
import { TwinAssembly } from "./OpeningCard";

/**
 * The demo's payoff, a callback to the cold open: the same bridge, but this time Pier 4's warning is connected
 * and acted on, so it goes amber and back to green. Beside it, the loop the demo just showed, and its numbers.
 */

const STEPS = [
  { t: "Alert", d: "sensor drift, real data", at: 1.4 },
  { t: "Inspect", d: "AI reads the photo", at: 2.2 },
  { t: "Plan", d: "drone sees around the pipe", at: 3.0 },
  { t: "Repair", d: "before it fails", at: 3.8 },
];

const STATS: { to: number; from?: number; prefix?: string; suffix: string; label: string }[] = [
  { to: 15, suffix: " months", label: "of real bridge monitoring data" },
  { from: 30, to: 100, suffix: "%", label: "crack visibility after re-planning" },
  { to: 638, suffix: "", label: "real structures on one live globe" },
  { to: 5, suffix: "", label: "Meta models, live" },
];

const clamp = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => 1 - (1 - clamp(x)) ** 3;

export function ClosingCard({ text, models, onClose }: { text: string; models: string; onClose?: () => void }) {
  const clock = useRef(0);
  const start = useMemo(() => performance.now(), []);
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      clock.current = (performance.now() - start) / 1000;
      setT(clock.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [start]);

  return (
    <div className="fixed inset-0 z-50 grid grid-cols-1 bg-bg lg:grid-cols-[1.15fr_1fr]">
      <div className="relative hidden lg:block">
        <TwinAssembly clock={clock} repaired />
        <div
          className="pointer-events-none absolute left-10 top-10 text-xs uppercase tracking-[0.25em] transition-colors duration-700"
          style={{ color: t > 5.4 ? "#22c55e" : t > 3.6 ? "#eab308" : "#6b7280" }}
        >
          Pier 4 · {t > 5.4 ? "repaired, back to nominal" : t > 3.6 ? "warning connected, crew dispatched" : "live twin"}
        </div>
      </div>

      <div className="flex flex-col justify-center px-10 pb-28 lg:pr-16">
        <div className="reveal text-[11px] uppercase tracking-[0.3em] text-accent" style={{ animationDelay: "0.1s" }}>
          This time, the warning was connected
        </div>
        <div className="reveal mt-2 text-7xl font-semibold tracking-tight text-ink" style={{ animationDelay: "0.3s" }}>
          InfraTwin-Live
        </div>

        {/* the loop, lighting up step by step */}
        <div className="mt-8 flex items-start">
          {STEPS.map((s, i) => {
            const on = ease((t - s.at) / 0.5);
            return (
              <div key={s.t} className="flex flex-1 items-start">
                <div className="flex flex-col items-center text-center" style={{ opacity: 0.25 + 0.75 * on }}>
                  <div
                    className="grid h-12 w-12 place-items-center rounded-full border-2 text-lg font-semibold"
                    style={{
                      borderColor: on > 0.5 ? "#38bdf8" : "#1f2a37",
                      background: on > 0.5 ? "rgb(56 189 248 / 0.15)" : "transparent",
                      color: on > 0.5 ? "#e5e7eb" : "#6b7280",
                      transform: `scale(${0.85 + 0.15 * on})`,
                    }}
                  >
                    {on > 0.5 ? "✓" : i + 1}
                  </div>
                  <div className="mt-2 text-lg font-semibold text-ink">{s.t}</div>
                  <div className="max-w-[9rem] text-xs text-ink-3">{s.d}</div>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="mx-1 mt-6 h-0.5 flex-1 bg-line">
                    <div className="h-0.5 bg-accent" style={{ width: `${100 * ease((t - s.at - 0.3) / 0.6)}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* the numbers, counting up */}
        <div className="mt-10 grid grid-cols-2 gap-x-8 gap-y-5">
          {STATS.map((s, i) => {
            const p = ease((t - 4.6 - i * 0.25) / 1.2);
            const v = Math.round((s.from ?? 0) + (s.to - (s.from ?? 0)) * p);
            return (
              <div key={s.label} style={{ opacity: clamp((t - 4.4 - i * 0.25) / 0.4) }}>
                <div className="text-4xl font-semibold tabular-nums text-ink">
                  {s.from !== undefined ? `${s.from}% → ` : ""}
                  {v.toLocaleString()}
                  {s.suffix}
                </div>
                <div className="text-sm text-ink-2">{s.label}</div>
              </div>
            );
          })}
        </div>

        <div className="mt-10" style={{ opacity: clamp((t - 6.4) / 0.6) }}>
          <div className="text-xl font-medium text-ink">github.com/Shivam-sopho/infratwin-live</div>
          <div className="mt-1 text-sm text-ink-3">Open source · MIT · {models}</div>
          {!RECORD && onClose && (
            <button className="mt-5 rounded-md border border-line px-4 py-1.5 text-xs text-ink-2 hover:text-ink" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>

      <div className={`pointer-events-none absolute bottom-8 left-8 ${RECORD ? "right-[340px]" : "right-8 text-center"}`}>
        <span className="rounded bg-black/70 px-3 py-1.5 text-lg leading-relaxed text-ink [box-decoration-break:clone]">{text}</span>
      </div>
    </div>
  );
}
