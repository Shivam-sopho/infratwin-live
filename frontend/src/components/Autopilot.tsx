import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import N from "../narration.json";
import { type Focus, RECORD, useTwin } from "../store";
import { runVoiceCommand } from "../voiceCommand";
import { ColdOpen } from "./ColdOpen";
import { OpeningCard } from "./OpeningCard";
import { ClosingCard } from "./ClosingCard";

const PHOTO = "dacl10k_v2_train_3113.jpg"; // real inspection photo: spalling + corroded exposed rebar
const SCENES = 8;
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
  const [opening, setOpening] = useState(false);
  const [cold, setCold] = useState(false);
  const coldDone = useRef(false);
  const glimmer = useTwin((st) => st.caps.glimmer);
  const [paused, setPaused] = useState(false);
  const [narrate, setNarrate] = useState(true);
  const narrateRef = useRef(true);
  const ctl = useRef({ paused: false, skip: false, stop: false });
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    narrateRef.current = narrate;
    if (!narrate) audio.current?.pause();
  }, [narrate]);

  const play = (src: string) => {
    audio.current?.pause();
    if (!narrateRef.current) return;
    const a = new Audio(src);
    // Recording: the voice is added later, but the run keeps the narration's pacing (muted, still timed).
    a.muted = RECORD;
    audio.current = a;
    a.play().catch(() => undefined);
    if (RECORD) ((window as unknown as { __narration?: { src: string; t: number }[] }).__narration ??= []).push({ src, t: performance.now() });
  };

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
    const stage = (focus: Focus | null, spot: string[] = []) => s().setStage({ focus, spot });

    (async () => {
      try {
        if (!s().caps.meta) throw new Error("The demo needs a Meta API key: add MODEL_API_KEY to .env (or re-run ./start.sh) and restart.");
        // 0 · cold open: what happens when warnings go unconnected (resets the twin behind it)
        const t1 = Date.now() / 1000;
        coldDone.current = false;
        setCold(true);
        s().setView("corridor");
        s().setTimeTravel(null);
        s().setVoiceResult(null);
        s().selectAsset(null);
        s().setCenterTab("twin");
        s().setSideTab("alerts");
        stage("map");
        await api.demoReset();
        await waitFor(() => coldDone.current, 40000);
        setCold(false);
        setOpening(true);
        play("/demo/narration/s0.mp3");
        await wait(8500); // the twin assembles and the three pillars play out
        await waitFor(() => !speaking(), 20000);
        setOpening(false);

        // 1 · the network
        stage("map", ["map"]);
        await line(1, "s1", 4000);

        // 2 · real bridge, real data
        stage("twin+side", ["map", "center"]);
        s().selectAsset("KW51");
        s().selectComponent("KW51.DECK");
        s().setCenterTab("twin");
        s().setSideTab("alerts");
        await api.replay("KW51", { seek: "2019-04-20", hours_per_s: 96, playing: true });
        await line(2, "s2a", 4000, { models: "Real data · KU Leuven" });
        stage("twin+side", ["center", "side"]);
        s().setSideTab("twin");
        await line(2, "s2b", 3000, { models: s().caps.glimmer ? "Muse Glimmer · Muse Spark" : "Muse Spark" });
        working("Muse Spark is assessing the alert, streaming its reasoning on the right…");
        await waitFor(() => s().triages.some((t) => t.asset_id === "KW51" && t.t > t1 && t.status !== "running"), 90000);
        await api.replay("KW51", { playing: false }).catch(() => undefined);
        working(undefined);
        stage("twin+side", ["side"]);
        await wait(3500);

        // 3 · AI inspector
        const t3 = Date.now();
        stage("center", ["center"]);
        s().selectAsset("B07");
        s().requestInspection(PHOTO);
        await line(3, "s3a", 3000, { models: "Muse Spark · SAM 3.1", working: "Muse Spark is reading the photo… SAM 3.1 is masking each defect…" });
        await waitFor(() => s().inspection.at > t3 && s().inspection.status !== "running", 100000);
        await line(3, "s3b", 4500, { models: "Muse Spark · SAM 3.1" });

        // 4 · Wonder: seeing around obstacles
        stage("twin+side", ["center", "side"]);
        const f = await api.demoFinding();
        s().selectComponent("B07.P4");
        s().setCenterTab("twin");
        s().setSideTab("missions");
        const m = await api.createMission("B07.P4", f.id);
        await line(4, "s4a", 3000, { models: "Muse Wonder", working: "Muse Wonder is testing camera angles with the twin's geometry engine…" });
        await waitFor(() => s().missions.some((x) => x.id === m.id && x.status !== "running"), 120000);
        s().selectMission(m.id);
        await line(4, "s4b", 4500, { models: "Muse Wonder" });

        // 5 · time-travel
        const renders = Promise.all((["6mo", "2y", "repair"] as const).map((sc) => api.createForecast(f.id, sc)));
        await line(5, "s5a", 3000, { models: "Muse Spark · Muse Image", working: "Muse Image is rendering…" });
        await renders;
        working(undefined);
        s().setTtStop(0);
        s().setTimeTravel(f.id);
        stage("center", ["timetravel"]);
        await wait(2500);
        for (const [i, id] of (["s5b", "s5c", "s5d"] as const).entries()) {
          s().setTtStop(i + 1);
          await line(5, id, 3500, { models: "Muse Spark · Muse Image" });
        }
        await wait(1500);
        s().setTimeTravel(null);

        // 6 · voice
        stage("twin+side", ["center"]);
        s().selectComponent("B07.P4");
        await line(6, "s6a", 1000, { models: "Muse Voice Transcribe · Muse Spark" });
        const blob = await fetch("/demo/voice-command.wav").then((r) => r.blob());
        setCap((p) => (p ? { ...p, text: `“${(N.command as { text: string }).text}”`, working: "Muse Voice is transcribing… Muse Spark is turning it into actions…" } : p));
        play("/demo/narration/command.mp3");
        const [result] = await Promise.all([runVoiceCommand(blob), waitFor(() => !speaking(), 15000)]);
        void result;
        stage("twin+side", ["voice"]);
        await line(6, "s6b", 5000, { models: "Muse Voice Transcribe · Muse Spark" });
        s().setVoiceResult(null);

        // 7 · every structure: the global view
        stage(null);
        const [fleetSites, fleetState] = await Promise.all([api.fleetSites(), api.fleetState()]);
        s().setView("globe");
        stage(null, ["globe"]);
        setCap({ scene: 7, title: N.s8.title, text: N.s8.text, models: "Real locations (Wikidata) · simulated portfolio condition" });
        play("/demo/narration/s8.mp3");
        await wait(2500);
        const crit = fleetState.conditions.find((x) => x.status === "critical");
        const site = crit && fleetSites.sites.find((x) => x.id === crit.id);
        if (site) s().flyGlobe(site.lng, site.lat, 4.5);
        stage(null, ["globe", "dashboard"]);
        await wait(3500);
        s().flyGlobe(73.85, 18.6, 3.6); // home: the live Pune corridor
        await waitFor(() => !speaking(), 15000);
        await wait(800);

        // 8 · close
        stage(null);
        setCap(null);
        setClosing(true);
        play("/demo/narration/s7.mp3");
        await wait(4000);
        await waitFor(() => !speaking(), 20000);
        await wait(RECORD ? 5000 : 1500);
      } catch (e) {
        if (!(e instanceof Stop)) {
          setCap((p) => ({ scene: p?.scene ?? 0, title: "Demo stopped", text: e instanceof Error ? e.message : String(e) }));
          await new Promise((r) => setTimeout(r, 6000));
        }
      } finally {
        audio.current?.pause();
        api.replay("KW51", { playing: false }).catch(() => undefined);
        s().setStage({ focus: null, spot: [] });
        s().setView("corridor");
        setCap(null);
        setCold(false);
        setClosing(false);
        setOpening(false);
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

  if (cold) {
    return (
      <ColdOpen
        muted={!narrate && !RECORD}
        play={play}
        onDone={() => {
          coldDone.current = true;
        }}
      />
    );
  }

  if (opening) return <OpeningCard text={N.s0.text} />;

  if (closing)
    return (
      <ClosingCard
        text={N.s7.text}
        models={`SAM 3.1 · Muse Spark · Muse Wonder · Muse Image · Muse Voice Transcribe${glimmer ? " · Muse Glimmer" : ""}`}
        onClose={() => (ctl.current.stop = true)}
      />
    );

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 h-[124px] border-t border-accent/40 bg-bg">
      {/* recording: left-aligned, the bottom-right corner stays free for the presenter's face cam */}
      <div className={`pointer-events-auto flex h-full flex-col justify-center px-6 py-3 ${RECORD ? "ml-4 mr-[340px]" : "mx-auto max-w-6xl"}`}>
        <div className="flex items-center gap-3">
          <div className="flex gap-1" aria-label={`Scene ${cap?.scene ?? 0} of ${SCENES}`}>
            {Array.from({ length: SCENES }, (_, i) => (
              <span key={i} className={`h-1.5 w-5 rounded-full ${i < (cap?.scene ?? 0) ? "bg-accent" : "bg-line"}`} />
            ))}
          </div>
          {cap?.models && <span className="truncate text-[11px] text-accent">{cap.models}</span>}
          <span className={`ml-auto flex shrink-0 items-center gap-1.5 text-[11px] ${RECORD ? "hidden" : ""}`}>
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
        <div className="mt-1.5 flex items-baseline gap-3">
          <div className={`shrink-0 font-semibold text-ink ${RECORD ? "text-2xl" : "text-xl"}`}>{cap?.title ?? "Starting…"}</div>
          <p className={`leading-snug text-ink-2 ${RECORD ? "text-lg" : "text-[15px]"}`}>{cap?.text}</p>
        </div>
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
