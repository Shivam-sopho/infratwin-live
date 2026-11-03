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

const DEMO_PHOTO = "dacl10k_v2_train_3113.jpg"; // real inspection photo: spalling + corroded exposed rebar

const STEPS: Step[] = [
  {
    title: "1 · A live twin of the network",
    models: [],
    say:
      "This is InfraTwin-Live. Every structure on the map is a digital twin built from its members (piers, girders, arches), " +
      "coloured by live sensor health. Pins turn amber or red the moment a member drifts out of its safe envelope.",
    action: {
      label: "Reset & show the network",
      run: async () => {
        await api.demoReset();
        const s = useTwin.getState();
        s.setTimeTravel(null);
        s.selectAsset(null);
        s.setCenterTab("twin");
        s.setSideTab("alerts");
      },
    },
  },
  {
    title: "2 · Real bridge, real data",
    models: ["Muse Glimmer", "Muse Spark 1.3"],
    say:
      "This is railway bridge KW51 near Leuven, replaying 15 months of real monitoring data. Its frequencies drift with " +
      "temperature and frozen ballast, so the twin compensates for the environment and watches what is left. When the bridge " +
      "was strengthened in 2019, the twin flags the stiffness change, and Muse Spark explains it like an engineer would.",
    todo: "Watch the deviation sensors climb into the retrofit window; the Cognitive Twin tab opens with Muse Spark's assessment.",
    action: {
      label: "Play KW51 into the retrofit",
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
    title: "3 · An AI inspector",
    models: ["Muse Spark 1.3", "SAM 3.1"],
    say:
      "A real inspection photo. Muse Spark reads it like a senior inspector: what each defect is, where, how severe. SAM 3.1 " +
      "turns that into pixel-accurate masks, and every defect is pinned to the member it sits on, with a written assessment.",
    todo: "Takes ~20 s. Then point at the exposed rebar lines and the inspector's assessment card.",
    action: {
      label: "Inspect a real photo",
      run: async () => {
        const s = useTwin.getState();
        await api.replay("KW51", { playing: false }).catch(() => undefined);
        s.selectAsset("B07");
        s.requestInspection(DEMO_PHOTO);
      },
    },
  },
  {
    title: "4 · Seeing around obstacles",
    models: ["Muse Wonder"],
    say:
      "A crack on Pier 4 sits behind a drainage downpipe: a drone flying square-on sees only 30% of it. Muse Wonder uses the " +
      "twin's geometry engine as tools, compares angles and distances, and returns a collision-checked flight that sees all of it.",
    todo: "~40 s. Watch the tool calls in the Missions tab, then click Show in twin.",
    action: {
      label: "Plan the drone re-scan",
      run: async () => {
        const s = useTwin.getState();
        s.setTimeTravel(null);
        const f = await api.demoFinding();
        s.selectComponent("B07.P4");
        s.setCenterTab("twin");
        s.setSideTab("missions");
        await api.createMission("B07.P4", f.id);
      },
    },
  },
  {
    title: "5 · Two years from now",
    models: ["Muse Spark 1.3", "Muse Image"],
    say:
      "What happens if nobody acts? Muse Spark reasons about the mechanism, water from the downpipe and corroding steel, and " +
      "Muse Image renders that crack two years on, or after repair. It's illustrative, not a prediction, but it makes risk tangible.",
    todo: "Drag the timeline to +2 years and Repaired (first render ~30 s, then cached).",
    action: {
      label: "Open the time-travel view",
      run: async () => {
        const s = useTwin.getState();
        const f = await api.demoFinding();
        s.selectComponent("B07.P4");
        s.setCenterTab("twin");
        s.setTimeTravel(f.id);
      },
    },
  },
  {
    title: "6 · Hands-free in the field",
    models: ["Muse Voice Transcribe", "Muse Spark 1.3"],
    say:
      "On site, inspectors just talk. Voice is transcribed, understood, and turned into actions on the twin: a field note, the " +
      "measurements, a new drone mission.",
    todo: "Click Voice command and say: “Note a shear crack on Pier 4 and plan a drone re-scan around the drainage pipe.”",
    action: {
      label: "Focus Pier 4",
      run: () => {
        const s = useTwin.getState();
        s.setTimeTravel(null);
        s.selectComponent("B07.P4");
        s.setCenterTab("twin");
      },
    },
  },
];

export function DemoGuide() {
  const open = useTwin((s) => s.tourOpen);
  const setOpen = useTwin((s) => s.setTourOpen);
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
        onClick={() => setOpen(!open)}
        aria-pressed={open}
        className={`rounded-md border px-2.5 py-1 text-xs ${open ? "border-accent text-ink" : "border-line text-ink-2 hover:text-ink"}`}
      >
        Tour
      </button>
      {open && (
        <div className="fixed bottom-4 left-4 z-30 w-[26rem] max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-panel/95 p-3 text-xs shadow-2xl backdrop-blur">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-ink-3">
              Guided tour · {i + 1}/{STEPS.length}
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
