import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { startRecording, type Recorder } from "../audio";
import { useTwin } from "../store";
import type { VoiceResult } from "../types";

const STATUS_MARK: Record<string, string> = { done: "✓", client: "→", skipped: "–", error: "✕" };
const ACTION_LABEL: Record<string, string> = {
  select_component: "Focus",
  add_note: "Note",
  measure: "Measure",
  run_triage: "Triage",
  plan_rescan: "Drone re-scan",
  open_inspection: "Inspection",
  simulate_event: "Simulate",
  none: "No action",
};
const MAX_RECORD_S = 60;

export function VoiceButton() {
  const [state, setState] = useState<"idle" | "recording" | "processing">("idle");
  const [secs, setSecs] = useState(0);
  const [result, setResult] = useState<VoiceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recorder | null>(null);
  const components = useTwin((s) => s.components);

  useEffect(() => {
    if (state !== "recording") return;
    const t0 = Date.now();
    const id = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      setSecs(s);
      if (s >= MAX_RECORD_S) void stop();
    }, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const start = async () => {
    setError(null);
    setResult(null);
    try {
      rec.current = await startRecording();
      setSecs(0);
      setState("recording");
    } catch (e) {
      setError(`Microphone unavailable: ${e instanceof Error ? e.message : e}`);
    }
  };

  const stop = async () => {
    if (!rec.current) return;
    setState("processing");
    try {
      const wav = await rec.current.stop();
      const { selectedComponentId, selectComponent, setCenterTab } = useTwin.getState();
      const r = await api.voice(wav, selectedComponentId);
      setResult(r);
      // Navigation actions run in the browser.
      for (const a of r.actions) {
        if (a.status !== "client") continue;
        selectComponent(a.component_id);
        if (a.type === "open_inspection") setCenterTab("inspect");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      rec.current = null;
      setState("idle");
    }
  };

  return (
    <div className="relative">
      <button
        onClick={state === "recording" ? stop : start}
        disabled={state === "processing"}
        aria-pressed={state === "recording"}
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${
          state === "recording" ? "border-critical bg-critical/15 text-ink" : "border-line text-ink-2 hover:text-ink"
        } disabled:opacity-60`}
        title="Push to talk: click, speak a field command, click again"
      >
        <span className={`h-2 w-2 rounded-full ${state === "recording" ? "animate-pulse bg-critical" : "bg-ink-3"}`} />
        {state === "recording" ? `Listening ${secs}s · stop` : state === "processing" ? "Transcribing…" : "Voice command"}
      </button>

      {(result || error) && (
        <div className="absolute right-0 top-9 z-20 w-96 rounded-md border border-line bg-panel p-3 text-xs shadow-xl">
          <div className="mb-1 flex items-start justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wider text-ink-3">Field command</span>
            <button aria-label="Dismiss" className="text-ink-3 hover:text-ink" onClick={() => (setResult(null), setError(null))}>
              ×
            </button>
          </div>
          {error && <p className="text-ink-2">{error}</p>}
          {result && (
            <>
              <p className="italic text-ink">“{result.transcript || "…"}”</p>
              <p className="mt-1 text-ink-2">{result.reply}</p>
              {result.actions.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {result.actions.map((a, i) => (
                    <li key={i} className="flex gap-2">
                      <span className={a.status === "error" ? "text-critical" : a.status === "skipped" ? "text-ink-3" : "text-nominal"} aria-label={a.status}>
                        {STATUS_MARK[a.status]}
                      </span>
                      <span className="text-ink">
                        {ACTION_LABEL[a.type]}
                        {components[a.component_id] && <span className="text-ink-2"> · {components[a.component_id].name}</span>}
                        {a.detail && <span className="block text-ink-3">{a.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[10px] text-ink-3">Muse Voice Transcribe → Muse Spark</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
