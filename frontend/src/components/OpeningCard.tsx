import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Edges } from "@react-three/drei";
import * as THREE from "three";
import { RECORD } from "../store";
import { STATUS_COLOR } from "../theme";

/**
 * The demo's title moment, after the cold open rewinds: the twin assembles itself and comes alive (members rise
 * into place, then its sensors light up), while the product's three pillars each show what they do.
 */

const SPAN = 30;
const N_SPANS = 7;
const HALF = (SPAN * N_SPANS) / 2;
const PIER_H = 14;
const GIRDER_H = 2.2;
const PHOTO = "/api/samples/dacl10k_v2_train_3113.jpg"; // the real inspection photo the demo analyses

const clamp = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => 1 - (1 - clamp(x)) ** 3;

/** One member: rises (piers) or drops (girders) into place, from blueprint outline to solid, then turns healthy. */
function Member({ pos, size, kind, at, clock }: { pos: [number, number, number]; size: [number, number, number]; kind: "rise" | "drop"; at: number; clock: React.RefObject<number> }) {
  const g = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const concrete = useMemo(() => new THREE.Color("#9ca3af"), []);
  const healthy = useMemo(() => new THREE.Color("#7fbf96"), []);
  useFrame(() => {
    const t = clock.current;
    const p = ease((t - at) / 0.7);
    if (g.current) {
      if (kind === "rise") {
        g.current.scale.y = Math.max(0.001, p);
        g.current.position.y = (size[1] / 2) * p;
      } else g.current.position.y = pos[1] + (1 - p) * 26;
    }
    if (mat.current) {
      mat.current.opacity = 0.12 + 0.88 * ease((t - at - 0.4) / 0.6);
      mat.current.color.copy(concrete).lerp(healthy, 0.55 * ease((t - 3.0) / 0.8));
    }
  });
  return (
    <group ref={g} position={kind === "rise" ? [pos[0], 0, pos[2]] : pos}>
      <mesh>
        <boxGeometry args={size} />
        <meshStandardMaterial ref={mat} color="#9ca3af" roughness={0.8} transparent opacity={0.12} />
        <Edges color="#38bdf8" />
      </mesh>
    </group>
  );
}

/**
 * Sensor dots on the piers light up once the twin is built. Pier 4's turns amber (the story's next chapter);
 * in the repaired variant (the closing) it then turns back to green with a pulse: the warning was connected.
 */
function Sensors({ clock, repaired }: { clock: React.RefObject<number>; repaired?: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  const dots = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(() => {
    const t = clock.current;
    dots.current.forEach((d, i) => {
      if (!d) return;
      const on = ease((t - 2.8 - i * 0.12) / 0.4);
      const pulse = 1 + 0.35 * Math.sin(t * 5 + i);
      d.scale.setScalar(on * pulse);
      const mat = d.material as THREE.MeshBasicMaterial;
      const amber = repaired ? t > 3.6 && t < 5.4 : t > 4.6;
      mat.color.set(i === 3 && amber ? STATUS_COLOR.watch : STATUS_COLOR.nominal);
    });
    if (ring.current) {
      // repaired: a green ring expands from Pier 4 when it turns healthy again
      const p = clamp((t - 5.4) / 1.4);
      ring.current.visible = !!repaired && p > 0 && p < 1;
      ring.current.scale.setScalar(1 + p * 9);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - p);
    }
  });
  return (
    <>
      {Array.from({ length: N_SPANS - 1 }, (_, k) => (
        <mesh key={k} ref={(m) => (dots.current[k] = m)} position={[-HALF + SPAN * (k + 1), PIER_H * 0.6, 3.8]} scale={0}>
          <sphereGeometry args={[0.9, 16, 16]} />
          <meshBasicMaterial color={STATUS_COLOR.nominal} toneMapped={false} />
        </mesh>
      ))}
      <mesh ref={ring} position={[-HALF + SPAN * 4, PIER_H * 0.6, 3.9]} visible={false}>
        <ringGeometry args={[1.1, 1.4, 48]} />
        <meshBasicMaterial color={STATUS_COLOR.nominal} transparent toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

function Rig({ clock }: { clock: React.RefObject<number> }) {
  useFrame(({ camera }) => {
    const a = -0.85 + clock.current * 0.035; // a slow diagonal orbit keeps the whole bridge in frame
    camera.position.set(Math.sin(a) * 330, 78 - clock.current * 2, Math.cos(a) * 330);
    camera.lookAt(-18, 4, 0); // perspective enlarges the near (left) end, so aim slightly towards it
  });
  return null;
}

export function TwinAssembly({ clock, repaired }: { clock: React.RefObject<number>; repaired?: boolean }) {
  return (
    <Canvas dpr={[1, 1.5]} camera={{ position: [120, 60, 140], fov: 38, near: 1, far: 2000 }}>
      <hemisphereLight args={["#cbd5e1", "#1f2937", 0.9]} />
      <directionalLight position={[80, 140, 60]} intensity={1.4} />
      <gridHelper args={[400, 40, "#1f2a37", "#141c26"]} />
      <Member pos={[-HALF - 2, 8, 0]} size={[4, 16, 14]} kind="rise" at={0.1} clock={clock} />
      {Array.from({ length: N_SPANS - 1 }, (_, k) => (
        <Member key={`p${k}`} pos={[-HALF + SPAN * (k + 1), PIER_H / 2, 0]} size={[2.4, PIER_H, 7]} kind="rise" at={0.25 + k * 0.12} clock={clock} />
      ))}
      <Member pos={[HALF + 2, 8, 0]} size={[4, 16, 14]} kind="rise" at={1.0} clock={clock} />
      {Array.from({ length: N_SPANS }, (_, i) => (
        <Member
          key={`g${i}`}
          pos={[-HALF + SPAN * (i + 0.5), PIER_H + GIRDER_H / 2, 0]}
          size={[SPAN - 0.3, GIRDER_H, 11]}
          kind="drop"
          at={1.1 + i * 0.13}
          clock={clock}
        />
      ))}
      <Sensors clock={clock} repaired={repaired} />
      <Rig clock={clock} />
    </Canvas>
  );
}

/** Monitor: a sensor trace drawing itself. */
function TraceMini() {
  const pts = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i <= 60; i++) {
      const x = (i / 60) * 160;
      const y = 30 - 9 * Math.sin(i / 5) - 4 * Math.sin(i / 1.7) - (i > 44 ? (i - 44) * 1.1 : 0);
      out.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return out.join(" ");
  }, []);
  return (
    <svg viewBox="0 0 160 56" className="h-full w-full">
      <line x1="0" y1="14" x2="160" y2="14" stroke={STATUS_COLOR.watch} strokeDasharray="3 3" strokeOpacity="0.5" />
      <polyline points={pts} fill="none" stroke="#38bdf8" strokeWidth="2" className="draw-line" />
    </svg>
  );
}

/** Act: a drone path bending around the pipe that hides the crack, coverage counting up. */
function DroneMini({ start }: { start: number }) {
  const [cov, setCov] = useState(30);
  useEffect(() => {
    const id = setInterval(() => {
      const t = (performance.now() - start) / 1000;
      setCov(Math.round(30 + 70 * ease((t - 3.4) / 1.6)));
    }, 50);
    return () => clearInterval(id);
  }, [start]);
  return (
    <svg viewBox="0 0 160 90" className="h-full w-full">
      <rect x="96" y="8" width="26" height="76" fill="#4b5563" />
      <line x1="104" y1="40" x2="110" y2="62" stroke="#ef4444" strokeWidth="2" />
      <rect x="84" y="8" width="5" height="76" fill="#94a3b8" />
      <path d="M8 74 C 40 74, 50 20, 78 26 S 72 52, 92 50" fill="none" stroke="#34d399" strokeWidth="2" strokeDasharray="4 3" className="draw-path" />
      <text x="8" y="16" fill="#e5e7eb" fontSize="12" fontWeight="600">
        {cov}% visible
      </text>
    </svg>
  );
}

export function OpeningCard({ text }: { text: string }) {
  const clock = useRef(0);
  const start = useMemo(() => performance.now(), []);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      clock.current = (performance.now() - start) / 1000;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [start]);

  const pillars = [
    { t: "Monitor", d: "Live sensors on every member, real bridge data", art: <TraceMini /> },
    {
      t: "Inspect",
      d: "AI reads every inspection photo",
      art: (
        <div className="relative h-full w-full overflow-hidden rounded">
          <img src={PHOTO} alt="" className="h-full w-full object-cover" />
          <div className="scan-line" />
        </div>
      ),
    },
    { t: "Act", d: "Drone plans, forecasts, voice", art: <DroneMini start={start} /> },
  ];

  return (
    <div className="fixed inset-0 z-50 grid grid-cols-1 bg-bg lg:grid-cols-[1.15fr_1fr]">
      <div className="relative hidden lg:block">
        <TwinAssembly clock={clock} />
        <div className="reveal absolute left-10 top-10 text-xs uppercase tracking-[0.25em] text-ink-3" style={{ animationDelay: "3s" }}>
          Live twin · 16 members · sensors online
        </div>
      </div>
      <div className="flex flex-col justify-center px-10 pb-28 lg:pr-16">
        <div className="reveal text-[11px] uppercase tracking-[0.3em] text-accent" style={{ animationDelay: "0.2s" }}>
          Structural health digital twin
        </div>
        <div className="reveal mt-2 text-7xl font-semibold tracking-tight text-ink" style={{ animationDelay: "0.4s" }}>
          InfraTwin-Live
        </div>
        <div className="reveal mt-4 text-3xl text-ink-2" style={{ animationDelay: "0.9s" }}>
          <span className="text-ink">Connects the warnings</span> before a structure fails.
        </div>
        <div className="mt-10 space-y-4">
          {pillars.map((p, i) => (
            <div key={p.t} className="reveal flex items-center gap-5 rounded-lg border border-line bg-panel p-4" style={{ animationDelay: `${1.6 + i * 0.7}s` }}>
              <div className="h-[90px] w-[160px] shrink-0">{p.art}</div>
              <div>
                <div className="text-2xl font-semibold text-accent">{p.t}</div>
                <div className="text-base text-ink-2">{p.d}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="reveal mt-8 text-sm text-ink-3" style={{ animationDelay: "4s" }}>
          Built on Meta: SAM 3.1 · Muse Spark · Muse Wonder · Muse Image · Muse Voice Transcribe
        </div>
      </div>
      <div className={`pointer-events-none absolute bottom-8 left-8 ${RECORD ? "right-[340px]" : "right-8 text-center"}`}>
        <span className="rounded bg-black/70 px-3 py-1.5 text-lg leading-relaxed text-ink [box-decoration-break:clone]">{text}</span>
      </div>
    </div>
  );
}
