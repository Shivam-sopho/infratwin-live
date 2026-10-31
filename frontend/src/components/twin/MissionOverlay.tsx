import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { useTwin } from "../../store";
import type { Asset, Mission, Vec3, Viewpoint } from "../../types";

export const PATH_COLOR = "#34d399";
const OCCLUDER_COLOR = "#64748b";

export function Occluders({ asset }: { asset: Asset }) {
  return (
    <>
      {asset.occluders.map((o) => {
        const g = o.geometry;
        return (
          <mesh key={o.id} position={g.position} castShadow>
            {g.shape === "cylinder" ? <cylinderGeometry args={[g.size[0], g.size[0], g.size[1], 16]} /> : <boxGeometry args={g.size} />}
            <meshStandardMaterial
              color={OCCLUDER_COLOR}
              wireframe={o.kind === "scaffold"}
              transparent
              opacity={o.kind === "scaffold" ? 0.9 : 0.85}
              roughness={0.6}
              metalness={0.4}
            />
          </mesh>
        );
      })}
    </>
  );
}

/** Small camera frustum at `vp`, pointing at its look-at target. */
function CameraGlyph({ vp, color, label }: { vp: Viewpoint; color: string; label?: string }) {
  const quaternion = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(...vp.position);
    o.lookAt(...vp.look_at);
    return o.quaternion.clone();
  }, [vp]);
  return (
    <group position={vp.position} quaternion={quaternion}>
      {/* cone points down -y by default; rotate so its apex is at the camera and it opens toward +z (look direction) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0.6]}>
        <coneGeometry args={[0.55, 1.2, 4, 1, true]} />
        <meshBasicMaterial color={color} wireframe />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.18, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {label && (
        <Html position={[0, 0.7, 0]} center style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded border border-line bg-bg/90 px-1.5 py-0.5 text-[11px] text-ink">{label}</div>
        </Html>
      )}
    </group>
  );
}

function Drone({ path }: { path: Vec3[] }) {
  const ref = useRef<THREE.Mesh>(null);
  const curve = useMemo(() => new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(...p)), false, "centripetal", 0), [path]);
  const length = useMemo(() => curve.getLength(), [curve]);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const speed = 6; // m/s
    const u = ((clock.elapsedTime * speed) % length) / length;
    ref.current.position.copy(curve.getPointAt(u));
  });
  return (
    <mesh ref={ref}>
      <octahedronGeometry args={[0.45]} />
      <meshBasicMaterial color={PATH_COLOR} />
    </mesh>
  );
}

export function MissionOverlay({ mission }: { mission: Mission }) {
  const chosenIds = new Set(mission.chosen.map((v) => v.id));
  const others = mission.candidates.filter((v) => !chosenIds.has(v.id));
  return (
    <group>
      {/* Candidate poses: brightness encodes view quality. */}
      {others.map((v) => (
        <mesh key={v.id} position={v.position}>
          <sphereGeometry args={[0.16, 8, 8]} />
          <meshBasicMaterial color={PATH_COLOR} transparent opacity={0.15 + 0.6 * v.quality} />
        </mesh>
      ))}
      {mission.baseline && (
        <>
          <CameraGlyph vp={mission.baseline} color="#94a3b8" label={`square-on: ${Math.round(mission.baseline.coverage * 100)}% visible`} />
          <Line points={[mission.baseline.position, mission.baseline.look_at]} color="#94a3b8" lineWidth={1} dashed dashSize={0.4} gapSize={0.3} />
        </>
      )}
      {mission.chosen.map((v) => (
        <group key={v.id}>
          <CameraGlyph vp={v} color={PATH_COLOR} label={`${Math.round(v.coverage * 100)}% · yaw ${v.yaw_deg}° · ${v.standoff_m} m`} />
          <Line points={[v.position, v.look_at]} color={PATH_COLOR} lineWidth={1.5} />
        </group>
      ))}
      {mission.path && (
        <>
          <Line points={mission.path.waypoints} color={PATH_COLOR} lineWidth={3} />
          {mission.path.waypoints.slice(1, -1).map((p, i) => (
            <mesh key={i} position={p}>
              <sphereGeometry args={[0.22, 10, 10]} />
              <meshBasicMaterial color={PATH_COLOR} />
            </mesh>
          ))}
          <Drone path={mission.path.waypoints} />
        </>
      )}
    </group>
  );
}

/** Mission shown on the twin: the selected one if it belongs to this asset, else the latest for this asset. */
export function useAssetMission(assetId: string): Mission | undefined {
  const missions = useTwin((s) => s.missions);
  const selectedId = useTwin((s) => s.selectedMissionId);
  const selected = missions.find((m) => m.id === selectedId && m.asset_id === assetId);
  return selected ?? [...missions].reverse().find((m) => m.asset_id === assetId && m.status === "done");
}
