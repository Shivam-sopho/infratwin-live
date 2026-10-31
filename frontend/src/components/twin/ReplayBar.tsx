import { api } from "../../api";
import { useTwin } from "../../store";

const SPEEDS = [
  { label: "6 h/s", v: 6 },
  { label: "1 day/s", v: 24 },
  { label: "3 days/s", v: 72 },
  { label: "1 week/s", v: 168 },
];
// Retrofit window within the Oct 2018 - Jan 2020 record, as a fraction of the timeline.
const T0 = Date.UTC(2018, 9, 1);
const T1 = Date.UTC(2020, 0, 15, 23);
const frac = (d: number) => (d - T0) / (T1 - T0);
const RETROFIT = [frac(Date.UTC(2019, 4, 15)), frac(Date.UTC(2019, 8, 27))];

export function ReplayBar({ assetId }: { assetId: string }) {
  const rp = useTwin((s) => s.replay[assetId]);
  if (!rp) return null;
  const when = new Date(rp.time);
  const ctl = (body: Parameters<typeof api.replay>[1]) => void api.replay(assetId, body);
  return (
    <div className="pointer-events-auto absolute inset-x-3 bottom-3 rounded-md border border-line bg-panel/90 px-3 py-2 text-xs backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium tabular-nums text-ink">
          {when.toISOString().slice(0, 10)} {when.toISOString().slice(11, 16)} UTC
        </span>
        <span className={`rounded-full border px-1.5 text-[11px] ${rp.phase === "retrofit works" ? "border-watch text-ink" : "border-line text-ink-2"}`}>{rp.phase}</span>
        <button className="rounded border border-line px-2 py-0.5 text-ink-2 hover:text-ink" onClick={() => ctl({ playing: !rp.playing })}>
          {rp.playing ? "Pause" : "Play"}
        </button>
        <select
          value={rp.hours_per_s}
          onChange={(e) => ctl({ hours_per_s: Number(e.target.value) })}
          className="rounded border border-line bg-bg px-1.5 py-0.5 text-ink"
          aria-label="Replay speed"
        >
          {SPEEDS.map((s) => (
            <option key={s.v} value={s.v}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="ml-auto flex gap-1">
          <button className="rounded border border-line px-2 py-0.5 text-ink-2 hover:text-ink" onClick={() => ctl({ seek: "start" })}>
            Start
          </button>
          <button className="rounded border border-line px-2 py-0.5 text-ink-2 hover:text-ink" onClick={() => ctl({ seek: "2019-04-20" })}>
            Before retrofit
          </button>
          <button className="rounded border border-line px-2 py-0.5 text-ink-2 hover:text-ink" onClick={() => ctl({ seek: "post-retrofit" })}>
            After retrofit
          </button>
        </span>
      </div>
      <div className="relative mt-2 h-1.5 rounded-full bg-line" aria-label="Replay position">
        <div className="absolute h-full rounded-full bg-watch/40" style={{ left: `${RETROFIT[0] * 100}%`, width: `${(RETROFIT[1] - RETROFIT[0]) * 100}%` }} title="Retrofit works" />
        <div className="absolute -top-0.5 h-2.5 w-1 rounded bg-accent" style={{ left: `${rp.progress * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-3">
        <span>Oct 2018</span>
        <span>retrofit May–Sep 2019</span>
        <span>Jan 2020</span>
      </div>
    </div>
  );
}
