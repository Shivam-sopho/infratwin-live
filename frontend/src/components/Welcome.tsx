import { useState } from "react";
import { useTwin } from "../store";

const KEY = "infratwin.welcome.dismissed";
const seen = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

const PILLARS = [
  {
    title: "Monitor",
    body: "Live structural sensors on a 3D twin. On real data from railway bridge KW51, the twin separates temperature and frost effects from genuine stiffness change.",
    models: "Muse Glimmer · Muse Spark",
  },
  {
    title: "Inspect",
    body: "Drop in an inspection photo. Muse Spark reads it like a senior engineer and SAM 3.1 makes every defect pixel-accurate, pinned to the pier or girder it sits on.",
    models: "Muse Spark · SAM 3.1",
  },
  {
    title: "Act",
    body: "Muse Wonder plans a drone flight that sees around pipes and scaffolding, Muse Image shows the defect two years from now, and inspectors work hands-free by voice.",
    models: "Muse Wonder · Muse Image · Muse Voice",
  },
];

export function Welcome() {
  const [open, setOpen] = useState(() => !seen());
  const setTourOpen = useTwin((s) => s.setTourOpen);
  const noKey = useTwin((s) => s.capsKnown && !s.caps.meta);
  if (!open) return null;
  const close = (tour: boolean) => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* private mode: show again next time */
    }
    setOpen(false);
    if (tour) setTourOpen(true);
  };
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-bg/85 p-4 backdrop-blur-sm">
      <div role="dialog" aria-label="About InfraTwin-Live" className="w-full max-w-3xl rounded-xl border border-line bg-panel p-6 shadow-2xl">
        <div className="text-[11px] uppercase tracking-widest text-accent">Structural health digital twin</div>
        <h1 className="mt-1 text-2xl font-semibold text-ink">InfraTwin-Live</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-2">
          Bridges, tunnels and dams are inspected by hand, once every few years, from photos nobody measures. InfraTwin-Live is a
          live digital twin that watches the structure's sensors, inspects photos and video with AI, measures what it finds, and
          plans the next inspection, so engineers act on evidence instead of guesswork.
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {PILLARS.map((p) => (
            <div key={p.title} className="rounded-lg border border-line bg-bg/60 p-3">
              <div className="text-sm font-semibold text-ink">{p.title}</div>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">{p.body}</p>
              <div className="mt-2 text-[11px] text-accent">{p.models}</div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[11px] text-ink-3">
          Real data: KW51 monitoring (KU Leuven) and dacl10k inspection photos. The Pune corridor assets are simulated and labelled as such.
        </p>
        {noKey && (
          <p className="mt-4 rounded-md border border-watch/50 bg-watch/10 px-3 py-2 text-xs text-ink">
            No Meta API key is configured, so the AI features are off. Add <code>MODEL_API_KEY=…</code> to <code>.env</code> (or
            re-run <code>./start.sh</code>) and restart. The map, the twins, KW51's real data and the photo library work without it.
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            disabled={noKey}
            onClick={() => close(true)} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-40">
            ▶ Play the demo (≈2½ min, runs by itself)
          </button>
          <button onClick={() => close(false)} className="rounded-md border border-line px-4 py-2 text-sm text-ink-2 hover:text-ink">
            Explore on my own
          </button>
        </div>
      </div>
    </div>
  );
}
