import { useEffect, useState } from "react";
import { api } from "../api";
import { useTwin } from "../store";

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
  const [metaReady, setMetaReady] = useState(false);

  useEffect(() => {
    api.health().then((h) => setMetaReady(h.meta_api_configured), () => setMetaReady(false));
  }, [connected]);

  return (
    <header className="flex h-12 items-center gap-4 border-b border-line bg-panel px-4">
      <div className="flex items-baseline gap-2">
        <span className="font-semibold tracking-tight text-ink">InfraTwin-Live</span>
        <span className="hidden text-xs text-ink-3 md:inline">Geo-anchored structural health digital twin</span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Pill ok={connected} label={connected ? "Telemetry live" : "Telemetry offline"} />
        <Pill ok={metaReady} label={metaReady ? "Meta API key set" : "Meta API key missing"} />
        <button
          onClick={() => api.injectAnomaly(DEMO_COMPONENT)}
          className="rounded-md border border-critical/60 px-2.5 py-1 text-xs text-ink hover:bg-critical/10"
        >
          Simulate Pier 4 event
        </button>
        <button onClick={() => api.resetSim()} className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 hover:text-ink">
          Reset
        </button>
      </div>
    </header>
  );
}
