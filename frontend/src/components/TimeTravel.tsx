import { useEffect, useState } from "react";
import { api } from "../api";
import { useTwin } from "../store";
import type { Forecast, Scenario } from "../types";
import { metrologySummary } from "./inspection/metrology";

const STOPS: { key: "now" | Scenario; label: string }[] = [
  { key: "now", label: "Today" },
  { key: "6mo", label: "+6 months" },
  { key: "2y", label: "+2 years" },
  { key: "repair", label: "Repaired" },
];

export function TimeTravel() {
  const findingId = useTwin((s) => s.timeTravelFindingId);
  const finding = useTwin((s) => s.findings.find((f) => f.id === s.timeTravelFindingId));
  const components = useTwin((s) => s.components);
  const close = useTwin((s) => s.setTimeTravel);
  const [stop, setStop] = useState(0);
  const [forecasts, setForecasts] = useState<Partial<Record<Scenario, Forecast>>>({});
  const [busy, setBusy] = useState<Scenario | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!findingId) return;
    setStop(0);
    setError(null);
    setForecasts({});
    api.forecasts(findingId).then((list) => setForecasts(Object.fromEntries(list.map((f) => [f.scenario, f]))), () => undefined);
  }, [findingId]);

  useEffect(() => {
    if (!findingId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [findingId, close]);

  if (!finding) return null;
  const key = STOPS[stop].key;
  const fc = key === "now" ? null : forecasts[key];

  const renderScenario = async (s: Scenario) => {
    setBusy(s);
    setError(null);
    try {
      const f = await api.createForecast(finding.id, s);
      setForecasts((prev) => ({ ...prev, [s]: f }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={() => close(null)}>
      <div
        role="dialog"
        aria-label="Defect time-travel preview"
        className="flex max-h-full w-full max-w-3xl flex-col gap-3 overflow-y-auto rounded-lg border border-line bg-panel p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-3">Time-travel · {finding.id}</div>
            <div className="font-semibold text-ink">
              {finding.concept} on {components[finding.component_id]?.name}
            </div>
            {finding.metrology && <div className="text-xs tabular-nums text-ink-2">Today: {metrologySummary(finding.metrology)}</div>}
          </div>
          <button aria-label="Close" className="text-lg text-ink-3 hover:text-ink" onClick={() => close(null)}>
            ×
          </button>
        </header>

        <div className="relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-md bg-black/40">
          {key === "now" ? (
            <img src={finding.thumbnail} alt={`${finding.concept} today`} className="h-full w-full object-contain" />
          ) : fc ? (
            <img src={fc.image_url} alt={`${finding.concept}, ${STOPS[stop].label}`} className="h-full w-full object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-center text-xs text-ink-2">
              <p>Not rendered yet.</p>
              <button
                disabled={busy !== null}
                onClick={() => renderScenario(key)}
                className="rounded-md bg-accent px-3 py-1.5 font-medium text-bg disabled:opacity-50"
              >
                {busy === key ? "Muse Spark reasoning → Muse Image rendering…" : "Render with Muse Image (~$0.01)"}
              </button>
            </div>
          )}
          <span className="absolute left-2 top-2 rounded bg-bg/80 px-1.5 py-0.5 text-[11px] text-ink">{STOPS[stop].label}</span>
        </div>

        <div>
          <input
            type="range"
            min={0}
            max={STOPS.length - 1}
            step={1}
            value={stop}
            onChange={(e) => setStop(Number(e.target.value))}
            className="w-full accent-[var(--color-accent)]"
            aria-label="Timeline"
          />
          <div className="flex justify-between text-[11px] text-ink-2">
            {STOPS.map((s, i) => (
              <button key={s.key} onClick={() => setStop(i)} className={i === stop ? "text-ink" : "hover:text-ink"}>
                {s.label}
                {s.key !== "now" && forecasts[s.key] ? " ●" : ""}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="rounded border border-critical/40 px-2 py-1 text-xs text-ink-2">{error}</p>}
        {fc && (
          <div className="flex flex-col gap-1 text-xs">
            <p className="text-ink">{fc.narrative}</p>
            <details className="text-ink-3">
              <summary className="cursor-pointer">Image edit prompt</summary>
              <p className="mt-1">{fc.image_prompt}</p>
            </details>
          </div>
        )}
        <p className="text-[11px] text-ink-3">
          Illustrative AI visualisation (Muse Spark reasoning → Muse Image edit of the inspection photo), not an engineering
          prediction. Use for communicating risk and repair options, not for design decisions.
        </p>
      </div>
    </div>
  );
}
