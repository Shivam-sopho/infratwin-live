import { useEffect, useState } from "react";
import { api } from "../api";
import { useTwin } from "../store";

interface Step {
  title: string;
  models: string[];
  say: string;
  todo?: string;
  action?: { label: string; run: () => Promise<void> | void };
}

const PIER = "B07.P4";

function latestFinding(componentId: string) {
  return [...useTwin.getState().findings].reverse().find((f) => f.component_id === componentId);
}

const STEPS: Step[] = [
  {
    title: "1 · The corridor, live",
    models: [],
    say:
      "This is a live digital twin of an infrastructure corridor: a viaduct, a tunnel and a dam on a 3D map. " +
      "Every pier and girder is a twin component with live strain, vibration and deflection sensors.",
    action: {
      label: "Reset & show corridor",
      run: async () => {
        await api.demoReset();
        const s = useTwin.getState();
        s.selectAsset(null);
        s.setCenterTab("twin");
        s.setSideTab("alerts");
      },
    },
  },
  {
    title: "2 · A sensor spike on Pier 4",
    models: ["Muse Glimmer", "Muse Spark 1.3"],
    say:
      "Strain and vibration on Pier 4 start climbing. Glimmer screens each alert in milliseconds; when it goes " +
      "critical, Muse Spark gets the whole twin context and streams its assessment: causes, evidence, actions, " +
      "and whether we need eyes on the structure.",
    todo: "Wait about 20 s for Watch → Critical; the Cognitive Twin tab opens by itself.",
    action: {
      label: "Trigger Pier 4 event",
      run: async () => {
        const s = useTwin.getState();
        s.selectComponent(PIER);
        s.setCenterTab("twin");
        s.setSideTab("alerts");
        await api.injectAnomaly(PIER);
      },
    },
  },
  {
    title: "3 · A real bridge, real data",
    models: ["Muse Glimmer", "Muse Spark 1.3"],
    say:
      "Now a real structure: railway bridge KW51 near Leuven, with 15 months of real monitoring data. Its natural " +
      "frequencies drift with temperature and freezing ballast, so raw thresholds would be useless; the twin " +
      "compensates for the environment and watches what's left. When the bridge was strengthened in 2019, the twin " +
      "flags the stiffness change from the data alone.",
    todo: "Replay runs at 3 days/s from just before the retrofit: watch the deviation sensors and alerts climb.",
    action: {
      label: "Open KW51 replay",
      run: async () => {
        const s = useTwin.getState();
        if (!s.assets.some((a) => a.id === "KW51")) throw new Error("KW51 data not loaded on the server");
        s.selectAsset("KW51");
        s.selectComponent("KW51.DECK");
        s.setCenterTab("twin");
        s.setSideTab("alerts");
        await api.replay("KW51", { seek: "2019-04-20", hours_per_s: 72, playing: true });
      },
    },
  },
  {
    title: "4 · AI visual inspection",
    models: ["SAM 3.1", "SAM 3D Objects", "SAM 3D Body", "Muse Spark Open"],
    say:
      "The drone footage goes to SAM 3.1, which segments structural elements and defects in one pass and pins each " +
      "crack to the pier it sits on. Using the pier's known width we get millimetre crack widths; SAM 3D lifts the " +
      "defect into 3D and checks that nobody is standing under it.",
    todo: "Load the Pier 4 photo or clip → Run SAM 3.1 → Pin → Lift to 3D / Work-zone check → Verify with Spark Open.",
    action: {
      label: "Open inspection on Pier 4",
      run: () => {
        const s = useTwin.getState();
        s.selectComponent(PIER);
        s.setCenterTab("inspect");
      },
    },
  },
  {
    title: "5 · Hands-free, and into the future",
    models: ["Muse Voice Transcribe", "Muse Spark 1.3", "Muse Image"],
    say:
      "The inspector just talks to the twin. Then we drag the timeline: Muse Spark reasons about how this crack evolves " +
      "and Muse Image shows it in two years untreated, and after repair.",
    todo: "Click Voice command and say: “Pin this shear crack to Pier 4, run metric area calculation, and plan a drone re-scan around the drainage pipe.”",
    action: {
      label: "Open time-travel",
      run: () => {
        const s = useTwin.getState();
        s.selectComponent(PIER);
        s.setCenterTab("twin");
        const f = latestFinding(PIER);
        if (f) s.setTimeTravel(f.id);
      },
    },
  },
  {
    title: "6 · Re-planning the drone around obstacles",
    models: ["Muse Wonder"],
    say:
      "A drainage pipe blocks the square-on view of the crack. Muse Wonder calls the twin's geometry engine as tools, " +
      "compares standoffs and angles, and returns a collision-checked flight that sees the crack.",
    todo: "Watch the Missions tab; click Show in twin when it finishes.",
    action: {
      label: "Plan drone re-scan",
      run: async () => {
        const s = useTwin.getState();
        s.setTimeTravel(null);
        s.selectComponent(PIER);
        s.setCenterTab("twin");
        await api.createMission(PIER, latestFinding(PIER)?.id);
      },
    },
  },
];

export function DemoGuide() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowRight") setI((x) => Math.min(STEPS.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const step = STEPS[i];
  const run = async () => {
    if (!step.action) return;
    setBusy(true);
    setError(null);
    try {
      await step.action.run();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-pressed={open}
        className={`rounded-md border px-2.5 py-1 text-xs ${open ? "border-accent text-ink" : "border-line text-ink-2 hover:text-ink"}`}
      >
        Demo
      </button>
      {open && (
        <div className="fixed bottom-4 left-4 z-30 w-[26rem] max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-panel/95 p-3 text-xs shadow-2xl backdrop-blur">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-ink-3">
              Demo walkthrough · {i + 1}/{STEPS.length}
            </span>
            <button aria-label="Close demo" className="text-ink-3 hover:text-ink" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
          <div className="text-sm font-semibold text-ink">{step.title}</div>
          {step.models.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {step.models.map((m) => (
                <span key={m} className="rounded-full border border-accent/50 px-1.5 py-px text-[10px] text-ink-2">
                  {m}
                </span>
              ))}
            </div>
          )}
          <p className="mt-2 text-ink">{step.say}</p>
          {step.todo && <p className="mt-1 text-ink-2">→ {step.todo}</p>}
          {error && <p className="mt-1 text-ink-3">{error}</p>}
          <div className="mt-3 flex items-center gap-2">
            <button disabled={i === 0} onClick={() => setI(i - 1)} className="rounded border border-line px-2 py-0.5 text-ink-2 hover:text-ink disabled:opacity-30">
              ←
            </button>
            {step.action && (
              <button onClick={run} disabled={busy} className="rounded-md bg-accent px-2.5 py-1 font-medium text-bg disabled:opacity-50">
                {busy ? "…" : step.action.label}
              </button>
            )}
            <button
              disabled={i === STEPS.length - 1}
              onClick={() => setI(i + 1)}
              className="ml-auto rounded border border-line px-2 py-0.5 text-ink-2 hover:text-ink disabled:opacity-30"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </>
  );
}
