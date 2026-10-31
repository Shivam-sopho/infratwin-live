import { useEffect, useState } from "react";
import { api } from "../api";
import { useTwin } from "../store";
import { DemoGuide } from "./DemoGuide";
import { VoiceButton } from "./VoiceButton";

const DEMO_COMPONENT = "B07.P4";

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-2">
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-nominal" : "bg-ink-3"}`} />
      {label}
    </span>
  );
}

export function TopBar() {
  const connected = useTwin((s) => s.connected);
  const [health, setHealth] = useState({ meta: false, glimmer: false, sparkOpen: false, modal: false, spent: 0, cap: 0 });

  useEffect(() => {
    const load = () =>
      api.health().then(
        (h) =>
          setHealth({
            meta: h.meta_api_configured,
            glimmer: h.glimmer_configured,
            sparkOpen: h.spark_open_configured,
            modal: h.modal_configured,
            spent: h.budget.spent_usd,
            cap: h.budget.cap_usd,
          }),
        () => undefined,
      );
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [connected]);
  const metaReady = health.meta;

  return (
    <header className="flex h-12 items-center gap-4 border-b border-line bg-panel px-4">
      <div className="flex items-baseline gap-2">
        <span className="font-semibold tracking-tight text-ink">InfraTwin-Live</span>
        <span className="hidden text-xs text-ink-3 md:inline">Geo-anchored structural health digital twin</span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Pill ok={connected} label={connected ? "Telemetry live" : "Telemetry offline"} />
        <Pill ok={metaReady} label={metaReady ? "Meta API key set" : "Meta API key missing"} />
        <span className="hidden xl:inline-flex">
          <Pill
            ok={health.glimmer && health.sparkOpen && health.modal}
            label={`Glimmer ${health.glimmer ? "✓" : "–"} · Spark Open ${health.sparkOpen ? "✓" : "–"} · Modal ${health.modal ? "✓" : "–"}`}
          />
        </span>
        {health.cap > 0 && (
          <span
            className="hidden tabular-nums text-xs text-ink-3 lg:inline"
            title="Estimated model spend today (UTC) against the daily cap; paid calls are refused above the cap"
          >
            ${health.spent.toFixed(2)} / ${health.cap.toFixed(0)} today
          </span>
        )}
        <VoiceButton />
        <button
          onClick={() => api.injectAnomaly(DEMO_COMPONENT)}
          className="rounded-md border border-critical/60 px-2.5 py-1 text-xs text-ink hover:bg-critical/10"
        >
          Simulate Pier 4 event
        </button>
        <button onClick={() => api.demoReset()} className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 hover:text-ink" title="Clear anomalies, alerts, assessments and missions (pinned findings are kept)">
          Reset
        </button>
        <DemoGuide />
      </div>
    </header>
  );
}
