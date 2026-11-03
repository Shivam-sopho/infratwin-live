import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import N from "../narration.json";
import { useTwin } from "../store";
import { runVoiceCommand } from "../voiceCommand";

const PHOTO = "dacl10k_v2_train_3113.jpg"; // real inspection photo: spalling + corroded exposed rebar
const SCENES = 7;
type LineId = keyof typeof N;

interface Caption {
  scene: number;
  title: string;
  text: string;
  working?: string;
  models?: string;
}

class Stop extends Error {}

/**
 * Runs the whole product story by itself: narrated captions (Kokoro voice), real model calls, and it moves on
 * when each result is on screen.
 */
export function Autopilot() {
  const running = useTwin((s) => s.tourOpen);
  const setRunning = useTwin((s) => s.setTourOpen);
  const [cap, setCap] = useState<Caption | null>(null);
  const [closing, setClosing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [narrate, setNarrate] = useState(true);
  const narrateRef = useRef(true);
  const ctl = useRef({ paused: false, skip: false, stop: false });
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    narrateRef.current = narrate;
    if (!narrate) audio.current?.pause();
  }, [narrate]);

  useEffect(() => {
    if (!running) return;
    ctl.current = { paused: false, skip: false, stop: false };
    setPaused(false);
    setClosing(false);
    const c = ctl.current;
    const tick = () => new Promise((r) => setTimeout(r, 100));
    const check = () => {
      if (c.stop) throw new Stop();
    };
    const wait = async (ms: number) => {
      for (let t = 0; t < ms; ) {
        check();
        if (c.skip) return void (c.skip = false);
        await tick();
        if (!c.paused) t += 100;
      }
    };
    const waitFor = async (pred: () => boolean, timeoutMs: number) => {
      for (let t = 0; t < timeoutMs && !pred(); t += 100) {
        check();
        if (c.skip) return void (c.skip = false);
        await tick();
      }
    };
    const play = (src: string) => {
      audio.current?.pause();
      if (!narrateRef.current) return;
      const a = new Audio(src);
      audio.current = a;
      a.play().catch(() => undefined);
    };
    const speaking = () => !!audio.current && !audio.current.ended && !audio.current.paused;
    /** Show a narration line (and speak it); resolves after the line is spoken and `minMs` has passed. */
    const line = async (scene: number, id: LineId, minMs: number, extra: Partial<Caption> = {}) => {
      const l = N[id] as { title?: string; text: string };
      setCap((p) => ({ scene, title: l.title ?? p?.title ?? "", text: l.text, ...extra }));
      play(`/demo/narration/${id}.mp3`);
      await wait(minMs);
      await waitFor(() => !speaking(), 20000);
    };
    const working = (w?: string) => setCap((p) => (p ? { ...p, working: w } : p));
    const s = () => useTwin.getState();

    (async () => {
      try {
        // 1 · the network
        const t1 = Date.now() / 1000;
        await api.demoReset();
        s().setTimeTravel(null);
        s().setVoiceResult(null);
        s().selectAsset(null);
        s().setCenterTab("twin");
        s().setSideTab("alerts");
        await line(1, "s1", 6000);

        // 2 · real bridge, real data
        s().selectAsset("KW51");
        s().selectComponent("KW51.DECK");
        s().setCenterTab("twin");
        s().setSideTab("alerts");
        await api.replay("KW51", { seek: "2019-04-20", hours_per_s: 96, playing: true });
        await line(2, "s2a", 8000, { models: "Real data · KU Leuven" });
        await line(2, "s2b", 3000, { models: "Muse Glimmer · Muse Spark" });
        working("Muse Spark is assessing the alert, streaming its reasoning on the right…");
        s().setSideTab("twin");
        await waitFor(() => s().triages.some((t) => t.asset_id === "KW51" && t.t > t1 && t.status !== "running"), 90000);
        await api.replay("KW51", { playing: false }).catch(() => undefined);
        working(undefined);
        await wait(9000);

        // 3 · AI inspector
        const t3 = Date.now();
        s().selectAsset("B07");
        s().requestInspection(PHOTO);
        await line(3, "s3a", 3000, { models: "Muse Spark · SAM 3.1", working: "Muse Spark is reading the photo… SAM 3.1 is masking each defect…" });
        await waitFor(() => s().inspection.at > t3 && s().inspection.status !== "running", 100000);
        await line(3, "s3b", 9000, { models: "Muse Spark · SAM 3.1" });

        // 4 · Wonder: seeing around obstacles
        const f = await api.demoFinding();
        s().selectComponent("B07.P4");
        s().setCenterTab("twin");
        s().setSideTab("missions");
        const m = await api.createMission("B07.P4", f.id);
        await line(4, "s4a", 3000, { models: "Muse Wonder", working: "Muse Wonder is testing camera angles with the twin's geometry engine…" });
        await waitFor(() => s().missions.some((x) => x.id === m.id && x.status !== "running"), 120000);
        s().selectMission(m.id);
        await line(4, "s4b", 9000, { models: "Muse Wonder" });

        // 5 · time-travel
        const renders = Promise.all((["6mo", "2y", "repair"] as const).map((sc) => api.createForecast(f.id, sc)));
        await line(5, "s5a", 3000, { models: "Muse Spark · Muse Image", working: "Muse Image is rendering…" });
        await renders;
        working(undefined);
        s().setTtStop(0);
        s().setTimeTravel(f.id);
        await wait(2500);
        for (const [i, id] of (["s5b", "s5c", "s5d"] as const).entries()) {
          s().setTtStop(i + 1);
          await line(5, id, 4000, { models: "Muse Spark · Muse Image" });
        }
        await wait(1500);
        s().setTimeTravel(null);

        // 6 · voice
        s().selectComponent("B07.P4");
        await line(6, "s6a", 1000, { models: "Muse Voice Transcribe · Muse Spark" });
        const blob = await fetch("/demo/voice-command.wav").then((r) => r.blob());
        setCap((p) => (p ? { ...p, text: `“${(N.command as { text: string }).text}”`, working: "Muse Voice is transcribing… Muse Spark is turning it into actions…" } : p));
        play("/demo/narration/command.mp3");
        const [result] = await Promise.all([runVoiceCommand(blob), waitFor(() => !speaking(), 15000)]);
        void result;
        await line(6, "s6b", 8000, { models: "Muse Voice Transcribe · Muse Spark" });
        s().setVoiceResult(null);

        // 7 · close
        setCap(null);
        setClosing(true);
        play("/demo/narration/s7.mp3");
        await wait(6000);
        await waitFor(() => !speaking(), 20000);
        await wait(4000);
      } catch (e) {
        if (!(e instanceof Stop)) {
          setCap((p) => ({ scene: p?.scene ?? 0, title: "Demo stopped", text: e instanceof Error ? e.message : String(e) }));
          await new Promise((r) => setTimeout(r, 6000));
        }
      } finally {
        audio.current?.pause();
        api.replay("KW51", { playing: false }).catch(() => undefined);
        setCap(null);
        setClosing(false);
        setRunning(false);
      }
    })();
    return () => {
      c.stop = true;
    };
  }, [running, setRunning]);

  const togglePause = () => {
    ctl.current.paused = !ctl.current.paused;
    setPaused(ctl.current.paused);
    if (ctl.current.paused) audio.current?.pause();
    else if (audio.current && !audio.current.ended && narrateRef.current) audio.current.play().catch(() => undefined);
  };
  const skip = () => {
    audio.current?.pause();
    ctl.current.skip = true;
  };

  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") ctl.current.stop = true;
      if (e.key === "ArrowRight") skip();
      if (e.key === " ") {
        e.preventDefault();
        togglePause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!running) return null;

  if (closing) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-bg/90 p-6 backdrop-blur-sm">
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-[0.3em] text-accent">Structural health digital twin</div>
          <div className="mt-2 text-4xl font-semibold text-ink">InfraTwin-Live</div>
          <div className="mt-3 text-lg text-ink-2">Monitor · Inspect · Act</div>
          <p className="mx-auto mt-4 max-w-xl text-sm text-ink-2">{N.s7.text.replace(/^Monitor, inspect, act\. /, "")}</p>
          <div className="mt-5 text-xs text-ink-3">SAM 3.1 · Muse Spark · Muse Wonder · Muse Image · Muse Voice Transcribe · Muse Glimmer</div>
          <button className="mt-6 rounded-md border border-line px-4 py-1.5 text-xs text-ink-2 hover:text-ink" onClick={() => (ctl.current.stop = true)}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-50 w-[min(36rem,calc(100vw-2rem))] lg:w-[calc(37.5vw-2.5rem)]">
      <div className="pointer-events-auto w-full rounded-xl border border-accent/40 bg-bg/95 px-5 py-4 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex gap-1" aria-label={`Scene ${cap?.scene ?? 0} of ${SCENES}`}>
            {Array.from({ length: SCENES }, (_, i) => (
              <span key={i} className={`h-1.5 w-5 rounded-full ${i < (cap?.scene ?? 0) ? "bg-accent" : "bg-line"}`} />
            ))}
          </div>
          {cap?.models && <span className="truncate text-[11px] text-accent">{cap.models}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px]">
            <button
              className={`rounded border px-2 py-0.5 ${narrate ? "border-accent text-ink" : "border-line text-ink-3"}`}
              onClick={() => setNarrate((n) => !n)}
              title="Narration voice (Kokoro, open-source TTS)"
            >
              {narrate ? "🔊" : "🔇"}
            </button>
            <button className="rounded border border-line px-2 py-0.5 text-ink-2 hover:text-ink" onClick={togglePause}>
              {paused ? "Resume" : "Pause"}
            </button>
            <button className="rounded border border-line px-2 py-0.5 text-ink-2 hover:text-ink" onClick={skip}>
              Skip →
            </button>
            <button className="rounded border border-line px-2 py-0.5 text-ink-3 hover:text-ink" onClick={() => (ctl.current.stop = true)}>
              Exit
            </button>
          </span>
        </div>
        <div className="mt-2 text-lg font-semibold text-ink">{cap?.title ?? "Starting…"}</div>
        <p className="mt-1 text-sm leading-relaxed text-ink-2">{cap?.text}</p>
        {cap?.working && (
          <p className="mt-2 flex items-center gap-2 text-xs text-accent">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
            {cap.working}
          </p>
        )}
      </div>
    </div>
  );
}
