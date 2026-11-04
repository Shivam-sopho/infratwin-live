import { useEffect, useState } from "react";
import { api } from "../api";
import { RECORD, useTwin } from "../store";
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
  const presenting = useTwin((s) => s.tourOpen);
  const view = useTwin((s) => s.view);
  const [health, setHealth] = useState({ meta: false, glimmer: false, sparkOpen: false, modal: false, spent: 0, cap: 0 });

  useEffect(() => {
    const load = () =>
      api.health().then(
        (h) => {
          useTwin.getState().setCaps({
            meta: h.meta_api_configured,
            glimmer: h.glimmer_configured,
            sparkOpen: h.spark_open_configured,
            modal: h.modal_configured,
            sam3dObjects: h.sam3d.objects,
            sam3dBody: h.sam3d.body,
          });
          setHealth({
            meta: h.meta_api_configured,
            glimmer: h.glimmer_configured,
            sparkOpen: h.spark_open_configured,
            modal: h.modal_configured,
            spent: h.budget.spent_usd,
            cap: h.budget.cap_usd,
          });
        },
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
        <span className="hidden text-xs text-ink-3 xl:inline">Geo-anchored structural health digital twin</span>
      </div>
      <div className="flex overflow-hidden rounded-md border border-line text-xs" role="tablist" aria-label="View">
        {(
          [
            ["corridor", "Corridor"],
            ["globe", "Global"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => useTwin.getState().setView(v)}
            className={`px-2.5 py-1 ${view === v ? "bg-accent text-bg" : "text-ink-2 hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={`ml-auto flex items-center gap-2 ${presenting ? "[&>*:not(.keep)]:hidden" : ""}`}>
        <Pill ok={connected} label={connected ? "Telemetry live" : "Telemetry offline"} />
        <span
          title={[
            `Meta Model API: ${metaReady ? "SAM 3.1, Muse Spark 1.3, Muse Wonder, Muse Image, Muse Voice Transcribe" : "not configured"}`,
            `Muse Glimmer: ${health.glimmer ? "live" : "not configured"}`,
            `Muse Spark Open + sandbox: ${health.sparkOpen && health.modal ? "live" : "not configured"}`,
          ].join("\n")}
        >
          <Pill
            ok={metaReady}
            label={metaReady ? `Meta AI · ${5 + (health.glimmer ? 1 : 0) + (health.sparkOpen && health.modal ? 1 : 0)} models live` : "Meta API key missing"}
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
        <button
          onClick={() => useTwin.getState().setTourOpen(true)}
          className={`${RECORD ? "" : "keep"} rounded-md bg-accent px-3 py-1 text-xs font-medium text-bg hover:opacity-90`}
          title="Runs the whole story by itself, with captions (Space pauses, → skips, Esc exits)"
        >
          ▶ Play demo
        </button>
      </div>
    </header>
  );
}
