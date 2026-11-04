import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RECORD } from "../store";
import { STATUS_COLOR, STATUS_ICON, STATUS_LABEL } from "../theme";
import type { Status } from "../types";

/**
 * The demo's cold open: what happens when warnings go unconnected. A scripted, fully procedural scene (no footage):
 * a crack grows on Pier 4 while its strain gauge climbs and alerts go unanswered; the pier gives way; real cases
 * over black; then a rewind into the product. Everything on screen is a pure function of scene time, so the
 * rewind simply runs the clock backwards.
 */

const SPAN = 30;
const N_SPANS = 7;
const HALF = (SPAN * N_SPANS) / 2;
const PIER_H = 14;
const GIRDER_H = 2.2;
const P4X = -HALF + SPAN * 4; // 15
const CONCRETE = "#9ca3af";

// Clock (seconds of real time) -> scene time. Forward, hold under the facts, then rewind fast.
const T_COLLAPSE_END = 13;
const T_FACTS_END = 21;
const REWIND_SPEED = 5.5;
export const COLD_OPEN_S = T_FACTS_END + T_COLLAPSE_END / REWIND_SPEED + 0.6;

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
function sceneTime(t: number) {
  if (t < T_COLLAPSE_END) return t;
  if (t < T_FACTS_END) return T_COLLAPSE_END;
  return Math.max(0, T_COLLAPSE_END - (t - T_FACTS_END) * REWIND_SPEED);
}
const collapse = (st: number) => clamp((st - 9) / 2.4) ** 2;

/** Soft round sprite so particles read as dust and spray, not squares. */
function softDot() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.5, "rgba(255,255,255,0.45)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

// A jagged crack up the pier's front face (pier-local x, y).
const CRACK: [number, number][] = [
  [0.1, 1.2], [-0.25, 3.0], [0.2, 4.6], [-0.1, 6.3], [0.35, 8.0], [0.05, 9.6], [0.4, 11.2], [0.15, 12.6],
];

function Bridge({ clock }: { clock: React.RefObject<number> }) {
  const pier4 = useRef<THREE.Group>(null);
  const gD = useRef<THREE.Group>(null);
  const gE = useRef<THREE.Group>(null);
  const crack = useRef<THREE.Group>(null);

  useFrame(() => {
    const st = sceneTime(clock.current);
    const c = collapse(st);
    if (pier4.current) {
      pier4.current.rotation.z = -0.38 * c;
      pier4.current.position.y = -5 * c;
    }
    if (gD.current) {
      gD.current.rotation.z = -0.5 * c;
      gD.current.position.y = PIER_H + GIRDER_H / 2 - 4 * c;
    }
    if (gE.current) {
      gE.current.rotation.z = 0.5 * c;
      gE.current.position.y = PIER_H + GIRDER_H / 2 - 4 * c;
    }
    if (crack.current) {
      const grow = smooth(2.5, 8.6, st) * (CRACK.length - 1);
      crack.current.children.forEach((seg, i) => {
        const part = clamp(grow - i);
        seg.visible = part > 0.01;
        seg.scale.set(1, part, 1);
      });
    }
  });

  const segs = useMemo(
    () =>
      CRACK.slice(0, -1).map(([x0, y0], i) => {
        const [x1, y1] = CRACK[i + 1];
        const len = Math.hypot(x1 - x0, y1 - y0);
        return { x0, y0, len, angle: Math.atan2(x1 - x0, y1 - y0) };
      }),
    [],
  );

  const box = (pos: [number, number, number], size: [number, number, number], key?: string) => (
    <mesh key={key} position={pos}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={CONCRETE} roughness={0.85} />
    </mesh>
  );

  return (
    <group>
      {box([-HALF - 2, 8, 0], [4, 16, 14])}
      {box([HALF + 2, 8, 0], [4, 16, 14])}
      {Array.from({ length: N_SPANS - 1 }, (_, k) => k + 1)
        .filter((i) => i !== 4)
        .map((i) => box([-HALF + SPAN * i, PIER_H / 2, 0], [2.4, PIER_H, 7], `p${i}`))}
      {/* Pier 4 tips about its base */}
      <group ref={pier4} position={[P4X, 0, 0]}>
        {box([0, PIER_H / 2, 0], [2.4, PIER_H, 7])}
        <group ref={crack} position={[0, 0, 3.52]}>
          {segs.map((s, i) => (
            // each segment grows from its start point (pivot at the start, mesh offset half a length)
            <group key={i} position={[s.x0, s.y0, 0]} rotation={[0, 0, -s.angle]}>
              <mesh position={[0, s.len / 2, 0]}>
                <boxGeometry args={[0.16, s.len, 0.04]} />
                <meshStandardMaterial color="#1a0505" emissive="#ef4444" emissiveIntensity={1.4} />
              </mesh>
            </group>
          ))}
        </group>
      </group>
      {/* Girders: the two either side of Pier 4 hinge on their far piers */}
      {Array.from({ length: N_SPANS }, (_, i) => i)
        .filter((i) => i !== 3 && i !== 4)
        .map((i) => box([-HALF + SPAN * (i + 0.5), PIER_H + GIRDER_H / 2, 0], [SPAN - 0.3, GIRDER_H, 11], `g${i}`))}
      <group ref={gD} position={[P4X - SPAN, PIER_H + GIRDER_H / 2, 0]}>
        {box([SPAN / 2, 0, 0], [SPAN - 0.3, GIRDER_H, 11])}
      </group>
      <group ref={gE} position={[P4X + SPAN, PIER_H + GIRDER_H / 2, 0]}>
        {box([-SPAN / 2, 0, 0], [SPAN - 0.3, GIRDER_H, 11])}
      </group>
    </group>
  );
}

/** Dust from the failure and splash where the spans hit the water; both pure functions of scene time. */
function Debris({ clock }: { clock: React.RefObject<number> }) {
  const N_DUST = 500;
  const N_SPLASH = 260;
  const dust = useMemo(() => {
    const r = rng(7);
    return Array.from({ length: N_DUST }, () => ({
      x: P4X + (r() - 0.5) * 8,
      y: 2 + r() * 12,
      z: (r() - 0.5) * 8,
      vx: (r() - 0.5) * 9,
      vy: 0.5 + r() * 3.5,
      vz: (r() - 0.5) * 9,
      d: r() * 0.8,
    }));
  }, []);
  const splash = useMemo(() => {
    const r = rng(11);
    return Array.from({ length: N_SPLASH }, () => ({
      x: P4X + (r() < 0.5 ? -1 : 1) * (6 + r() * 10),
      z: (r() - 0.5) * 12,
      vx: (r() - 0.5) * 6,
      vy: 6 + r() * 12,
      vz: (r() - 0.5) * 6,
      d: r() * 0.5,
    }));
  }, []);
  const dustGeo = useMemo(() => new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(N_DUST * 3), 3)), []);
  const splashGeo = useMemo(() => new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(N_SPLASH * 3), 3)), []);
  const dot = useMemo(softDot, []);
  const dustMat = useRef<THREE.PointsMaterial>(null);
  const splashMat = useRef<THREE.PointsMaterial>(null);

  useFrame(() => {
    const st = sceneTime(clock.current);
    const td = st - 9.4;
    const dp = dustGeo.getAttribute("position") as THREE.BufferAttribute;
    dust.forEach((p, i) => {
      const t = Math.max(0, td - p.d);
      dp.setXYZ(i, p.x + p.vx * t, p.y + p.vy * t, p.z + p.vz * t);
    });
    dp.needsUpdate = true;
    if (dustMat.current) dustMat.current.opacity = td <= 0 ? 0 : 0.55 * clamp(1 - td / 7);
    const ts = st - 10.9;
    const sp = splashGeo.getAttribute("position") as THREE.BufferAttribute;
    splash.forEach((p, i) => {
      const t = Math.max(0, ts - p.d);
      const y = p.vy * t - 4.9 * t * t;
      sp.setXYZ(i, p.x + p.vx * t, y > 0 ? y : -50, p.z + p.vz * t);
    });
    sp.needsUpdate = true;
    if (splashMat.current) splashMat.current.opacity = ts <= 0 ? 0 : 0.85 * clamp(1 - ts / 3);
  });

  return (
    <>
      <points geometry={dustGeo}>
        <pointsMaterial ref={dustMat} map={dot} color="#a8a29e" size={2.6} transparent opacity={0} depthWrite={false} />
      </points>
      <points geometry={splashGeo}>
        <pointsMaterial ref={splashMat} map={dot} color="#e0f2fe" size={1.4} transparent opacity={0} depthWrite={false} />
      </points>
    </>
  );
}

/** Close on the cracking pier, pull back wide for the failure, shake on impact. */
function CameraRig({ clock }: { clock: React.RefObject<number> }) {
  const { camera } = useThree();
  const look = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const st = sceneTime(clock.current);
    const w = smooth(7.8, 9.6, st);
    const drift = st * 0.25;
    const close = new THREE.Vector3(P4X + 24 - drift, 11 + drift * 0.15, 38 - drift * 0.6);
    const wide = new THREE.Vector3(-55, 26, 105);
    camera.position.lerpVectors(close, wide, w);
    look.set(P4X, 8, 3.5).lerp(new THREE.Vector3(5, 8, 0), w);
    const shake = st > 9 && st < 12.8 ? 0.9 * Math.sin(((st - 9) / 3.8) * Math.PI) : 0;
    camera.position.x += shake * Math.sin(st * 57);
    camera.position.y += shake * Math.sin(st * 43 + 1);
    camera.lookAt(look);
  });
  return null;
}

/** A low rumble and a crack, synthesised (no audio files). */
function useRumble(clock: React.RefObject<number>, muted: boolean) {
  useEffect(() => {
    if (muted) return;
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const noise = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const timers: number[] = [];
    const at = (s: number, fn: () => void) => timers.push(window.setTimeout(fn, Math.max(0, s - clock.current) * 1000));
    at(8.9, () => {
      // crack: short bright burst
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      src.connect(hp).connect(g).connect(ctx.destination);
      src.start();
      src.stop(ctx.currentTime + 0.4);
      // rumble: low-passed noise swelling and dying away
      const r = ctx.createBufferSource();
      r.buffer = noise;
      r.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 140;
      const rg = ctx.createGain();
      const t0 = ctx.currentTime;
      rg.gain.setValueAtTime(0.0001, t0);
      rg.gain.exponentialRampToValueAtTime(0.9, t0 + 1.4);
      rg.gain.exponentialRampToValueAtTime(0.5, t0 + 3);
      rg.gain.exponentialRampToValueAtTime(0.0001, t0 + 5.5);
      r.connect(lp).connect(rg).connect(ctx.destination);
      r.start();
      r.stop(t0 + 5.6);
    });
    return () => {
      timers.forEach(clearTimeout);
      ctx.close().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scheduled once per run
  }, [muted]);
}

const ALERTS: { at: number; year: string; text: string; status: Status }[] = [
  { at: 3.4, year: "2020", text: "Inspection: hairline crack, Pier 4. Recommendation: monitor.", status: "nominal" },
  { at: 5.4, year: "2022", text: "Strain gauge SG-12 above watch level.", status: "watch" },
  { at: 7.2, year: "2024", text: "Strain gauge SG-12 critical.", status: "critical" },
];

// Bottom subtitles, in step with the narration cues (c1 at 2.2 s, c2 at 13.4 s, c3 at the rewind).
const SUBTITLES: { from: number; to: number; text: string }[] = [
  { from: 2.2, to: 9.2, text: "Pier four. A hairline crack, noted in 2020. The strain kept climbing. The alerts went unanswered." },
  { from: 13.4, to: 20.9, text: "This bridge is a simulation. Genoa, Morbi and Pittsburgh were not. The warnings were there. Nobody connected them." },
  { from: 21.1, to: 23.6, text: "Let's rewind." },
];

const FACTS: { at: number; text: string; sub?: string }[] = [
  { at: 13.6, text: "This bridge is a simulation." },
  { at: 14.9, text: "Genoa, 2018", sub: "Morandi bridge. 43 lives. Corrosion had been flagged months before." },
  { at: 16.1, text: "Morbi, 2022", sub: "Suspension footbridge. 135 lives. Corroded cables, repainted, not replaced." },
  { at: 17.3, text: "Pittsburgh, 2022", sub: "Fern Hollow Bridge. Rated poor since 2011; repairs never made." },
  { at: 18.8, text: "The warnings were there. Nobody connected them." },
];

export function ColdOpen({ onDone, play, muted }: { onDone: () => void; play: (src: string) => void; muted: boolean }) {
  const clock = useRef(0);
  const [t, setT] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const cues = [
      { at: 2.2, src: "/demo/narration/c1.mp3" },
      { at: 13.4, src: "/demo/narration/c2.mp3" },
      { at: T_FACTS_END + 0.1, src: "/demo/narration/c3.mp3" },
    ];
    const tick = () => {
      clock.current = (performance.now() - start) / 1000;
      setT(clock.current);
      while (cues.length && clock.current >= cues[0].at) play(cues.shift()!.src);
      if (clock.current >= COLD_OPEN_S && !done.current) {
        done.current = true;
        onDone();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one run per mount
  }, []);
  useRumble(clock, muted);

  const st = sceneTime(t);
  const rewinding = t >= T_FACTS_END;
  const strain = 182 + 212 * smooth(2.2, 8.6, st);
  const status: Status = strain >= 360 ? "critical" : strain >= 300 ? "watch" : "nominal";
  const year = 2019 + Math.floor(5.99 * smooth(1.5, 8.6, st));
  const flash = st > 9 && st < 12 ? 0.16 * Math.sin(((st - 9) / 3) * Math.PI) : 0;
  const factsOpacity = t < T_COLLAPSE_END ? 0 : rewinding ? clamp(1 - (t - T_FACTS_END) / 0.6) : clamp((t - T_COLLAPSE_END) / 0.8);

  return (
    <div className="fixed inset-0 z-[60] bg-[#06090e]">
      <Canvas dpr={[1, 1.5]} camera={{ position: [30, 9, 24], fov: 42, near: 0.5, far: 2000 }}>
        <color attach="background" args={["#0a1220"]} />
        <fog attach="fog" args={["#0a1220", 90, 420]} />
        <hemisphereLight args={["#b9c8dd", "#2a2118", 1.0]} />
        <directionalLight position={[90, 70, 140]} intensity={1.5} color="#ffd2a8" />
        <directionalLight position={[-120, 40, -60]} intensity={0.5} color="#7aa2d6" />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
          <planeGeometry args={[2000, 2000]} />
          <meshStandardMaterial color="#0c2233" roughness={0.75} metalness={0.05} />
        </mesh>
        <Bridge clock={clock} />
        <Debris clock={clock} />
        <CameraRig clock={clock} />
      </Canvas>

      {/* honest label + sensor HUD */}
      <div className="pointer-events-none absolute left-6 top-6 space-y-3" style={{ opacity: 1 - factsOpacity }}>
        <span className="rounded border border-ink-3/50 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-ink-3">Simulation</span>
        <div className="w-72 rounded-md border border-line bg-panel/80 p-3 backdrop-blur">
          <div className="text-[10px] uppercase tracking-widest text-ink-3">Pier 4 · strain gauge SG-12</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums text-ink">{Math.round(strain)}</span>
            <span className="text-sm text-ink-3">µε</span>
            <span className="ml-auto text-sm font-medium" style={{ color: STATUS_COLOR[status] }}>
              {STATUS_ICON[status]} {STATUS_LABEL[status]}
            </span>
          </div>
          <div className="mt-1 text-xs tabular-nums text-ink-2">{year}</div>
        </div>
      </div>

      <div className="pointer-events-none absolute right-6 top-6 w-96 space-y-2" style={{ opacity: 1 - factsOpacity }}>
        {ALERTS.filter((a) => st >= a.at).map((a) => (
          <div key={a.year} className="feed-in rounded-md border border-line bg-panel/85 p-2.5 text-sm backdrop-blur">
            <div className="flex items-center gap-2 text-[11px]">
              <span style={{ color: STATUS_COLOR[a.status] }}>{STATUS_ICON[a.status]}</span>
              <span className="text-ink-3">{a.year}</span>
              <span className="ml-auto rounded bg-line px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-3">no action taken</span>
            </div>
            <div className="mt-1 text-ink">{a.text}</div>
          </div>
        ))}
      </div>

      {/* impact flash */}
      <div className="pointer-events-none absolute inset-0 bg-critical" style={{ opacity: flash }} />

      {/* the real cases */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/90 px-8" style={{ opacity: factsOpacity }}>
        <div className="max-w-2xl space-y-5 text-center">
          {FACTS.filter((f) => t >= f.at).map((f, i, all) => (
            <div key={f.text} className="feed-in">
              <div className={i === all.length - 1 && i === FACTS.length - 1 ? "text-3xl font-semibold text-ink" : "text-2xl font-semibold text-ink"}>{f.text}</div>
              {f.sub && <div className="mt-1 text-base text-ink-2">{f.sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {SUBTITLES.filter((sub) => t >= sub.from && t < sub.to).map((sub) => (
        <div key={sub.from} className={`pointer-events-none absolute bottom-8 left-8 ${RECORD ? "right-[340px]" : "right-8 text-center"}`}>
          <span className="rounded bg-black/70 px-3 py-1.5 text-lg leading-relaxed text-ink [box-decoration-break:clone]">{sub.text}</span>
        </div>
      ))}

      {rewinding && (
        <div className="pointer-events-none absolute right-6 top-6 flex items-center gap-2 rounded bg-black/60 px-3 py-1.5 text-lg font-semibold tracking-widest text-ink">
          ◀◀ REWIND
        </div>
      )}

      <button
        hidden={RECORD}
        className="absolute bottom-6 right-6 rounded border border-line bg-panel/80 px-3 py-1 text-xs text-ink-2 hover:text-ink"
        onClick={() => {
          if (done.current) return;
          done.current = true;
          onDone();
        }}
      >
        Skip intro →
      </button>
    </div>
  );
}
