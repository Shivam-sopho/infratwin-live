import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Bounds, Edges, Grid, Html, OrbitControls, useBounds } from "@react-three/drei";
import * as THREE from "three";
import { useTwin } from "../store";
import { CATEGORY_COLOR, CONCRETE, STATUS_COLOR, STATUS_ICON, STATUS_LABEL } from "../theme";
import type { Asset, Component, Finding, Geometry, Lift, Status } from "../types";
import { MissionOverlay, Occluders, useAssetMission } from "./twin/MissionOverlay";

function ComponentMesh({ comp, status }: { comp: Component; status: Status }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const [hovered, setHovered] = useState(false);
  const selected = useTwin((s) => s.selectedComponentId === comp.id);
  const selectComponent = useTwin((s) => s.selectComponent);
  const g = comp.geometry!;

  useFrame(({ clock }) => {
    if (!mat.current) return;
    const pulse = status === "critical" ? 0.35 + 0.35 * Math.sin(clock.elapsedTime * 6) : status === "watch" ? 0.2 : 0;
    mat.current.emissiveIntensity = pulse + (hovered ? 0.15 : 0);
  });

  const color = status === "nominal" ? CONCRETE : STATUS_COLOR[status];
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    selectComponent(comp.id);
  };

  let geometry: ReactNode;
  let rotation: [number, number, number] = [0, 0, 0];
  if (g.shape === "box") {
    geometry = <boxGeometry args={g.size} />;
  } else if (g.shape === "cylinder") {
    geometry = <cylinderGeometry args={[g.size[0], g.size[0], g.size[1], 32]} />;
  } else {
    // Half-cylinder shell, axis along z, crown at +y.
    geometry = <cylinderGeometry args={[g.size[0], g.size[0], g.size[1], 48, 1, true, Math.PI / 2, Math.PI]} />;
    rotation = [Math.PI / 2, 0, 0];
  }

  return (
    <mesh
      name={comp.id}
      position={g.position}
      rotation={rotation}
      castShadow
      receiveShadow
      onClick={onClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "";
      }}
    >
      {geometry}
      <meshStandardMaterial
        ref={mat}
        color={color}
        emissive={status === "nominal" ? "#38bdf8" : STATUS_COLOR[status]}
        emissiveIntensity={0}
        roughness={0.85}
        side={g.shape === "arch" ? THREE.DoubleSide : THREE.FrontSide}
      />
      {(selected || hovered) && <Edges color={selected ? "#38bdf8" : "#e5e7eb"} lineWidth={selected ? 2 : 1} />}
    </mesh>
  );
}

/** Fly the camera to the selected mission's flight, else the selected component, else the whole asset. */
function FocusOnSelection() {
  const bounds = useBounds();
  const scene = useThree((s) => s.scene);
  const selectedId = useTwin((s) => s.selectedComponentId);
  const missionPath = useTwin((s) => s.missions.find((m) => m.id === s.selectedMissionId)?.path?.waypoints);
  useEffect(() => {
    const obj = selectedId ? scene.getObjectByName(selectedId) : undefined;
    if (missionPath) {
      const box = new THREE.Box3().setFromPoints(missionPath.map((p) => new THREE.Vector3(...p)));
      if (obj) box.expandByObject(obj);
      bounds.refresh(box).clip().fit();
    } else {
      (obj ? bounds.refresh(obj) : bounds.refresh()).clip().fit();
    }
  }, [selectedId, missionPath, bounds, scene]);
  return null;
}

const MIN_PATCH_M = 0.4;

/**
 * Approximate a finding's place on its component from its normalised frame box, assuming the
 * photo faces the component's front (+z) face. SAM 3D lifting (Feature 3) replaces this with real pose.
 */
function placeFinding(g: Geometry, [u1, v1, u2, v2]: Finding["bbox_uv"]) {
  const [px, py, pz] = g.position;
  const cu = (u1 + u2) / 2;
  const cv = (v1 + v2) / 2;
  const obj = new THREE.Object3D();
  let size: [number, number];
  if (g.shape === "arch") {
    const [r, len] = g.size;
    const theta = Math.PI * (1 - cu);
    obj.position.set(px + (r - 0.1) * Math.cos(theta), py + (r - 0.1) * Math.sin(theta), pz + (cv - 0.5) * len * 0.8);
    obj.lookAt(px, py, obj.position.z); // face the tunnel axis
    size = [(u2 - u1) * Math.PI * r, (v2 - v1) * len];
  } else {
    const [w, h, d] = g.shape === "box" ? g.size : [g.size[0] * 2, g.size[1], g.size[0] * 2];
    obj.position.set(px + (cu - 0.5) * w, py + (0.5 - cv) * h, pz + d / 2 + 0.05);
    size = [(u2 - u1) * w, (v2 - v1) * h];
  }
  return { position: obj.position.clone(), quaternion: obj.quaternion.clone(), size: size.map((v) => Math.max(MIN_PATCH_M, v)) as [number, number] };
}

function FindingMarker({ f, g }: { f: Finding; g: Geometry }) {
  const selected = useTwin((s) => s.selectedFindingId === f.id);
  const selectFinding = useTwin((s) => s.selectFinding);
  const [hovered, setHovered] = useState(false);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const { position, quaternion, size } = useMemo(() => placeFinding(g, f.bbox_uv), [g, f.bbox_uv]);

  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = selected ? 0.75 + 0.2 * Math.sin(clock.elapsedTime * 5) : hovered ? 0.85 : 0.65;
  });

  return (
    <group position={position} quaternion={quaternion}>
      <mesh
        renderOrder={2}
        onClick={(e) => {
          e.stopPropagation();
          selectFinding(f.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "";
        }}
      >
        <planeGeometry args={size} />
        <meshBasicMaterial ref={mat} color={CATEGORY_COLOR.defect} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-4} side={THREE.DoubleSide} />
        {(selected || hovered) && <Edges color="#ffffff" />}
      </mesh>
      {(selected || hovered) && (
        <Html position={[0, size[1] / 2 + 0.6, 0]} center style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded border border-line bg-bg/90 px-1.5 py-0.5 text-[11px] text-ink">
            {f.id} · {f.concept}
            {f.confidence != null && ` · ${f.confidence.toFixed(2)}`}
          </div>
        </Html>
      )}
    </group>
  );
}

/**
 * SAM 3D reconstruction of a lifted finding. The cloud comes back in the object's own frame (camera-style
 * axes: x right, y down, z away from the camera), so it is re-centred, flipped to the face's frame (y up,
 * +z out of the face) and scaled to the finding's patch on the component.
 */
function LiftedCloud({ f, g, lift }: { f: Finding; g: Geometry; lift: Lift }) {
  const [geom, setGeom] = useState<THREE.BufferGeometry | null>(null);
  const { position, quaternion, size } = useMemo(() => placeFinding(g, f.bbox_uv), [g, f.bbox_uv]);

  useEffect(() => {
    let alive = true;
    fetch(lift.points_url)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        if (!alive) return;
        const data = new Float32Array(buf);
        const n = data.length / 6;
        const pos = new Float32Array(n * 3);
        const col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          pos[i * 3] = data[i * 6];
          pos[i * 3 + 1] = -data[i * 6 + 1];
          pos[i * 3 + 2] = -data[i * 6 + 2];
          col.set(data.subarray(i * 6 + 3, i * 6 + 6), i * 3);
        }
        const bg = new THREE.BufferGeometry();
        bg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        bg.setAttribute("color", new THREE.BufferAttribute(col, 3));
        bg.computeBoundingBox();
        const box = bg.boundingBox!;
        const c = box.getCenter(new THREE.Vector3());
        const ext = box.getSize(new THREE.Vector3());
        const k = Math.max(size[0], size[1]) / Math.max(ext.x, ext.y, 1e-6);
        bg.translate(-c.x, -c.y, -box.min.z); // sit the cloud on the face, protruding outward
        bg.scale(k, k, k);
        setGeom(bg);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [lift.points_url, lift.t, size]);

  if (!geom) return null;
  return (
    <points geometry={geom} position={position} quaternion={quaternion}>
      <pointsMaterial size={0.035} vertexColors sizeAttenuation />
    </points>
  );
}

function Surroundings({ type }: { type: Asset["type"] }) {
  if (type === "bridge")
    return (
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <planeGeometry args={[60, 400]} />
        <meshStandardMaterial color="#1e3a5f" roughness={0.3} metalness={0.2} transparent opacity={0.85} />
      </mesh>
    );
  if (type === "dam")
    return (
      <mesh position={[0, 18, -45]}>
        <boxGeometry args={[170, 36, 60]} />
        <meshStandardMaterial color="#1e3a5f" transparent opacity={0.55} />
      </mesh>
    );
  return null;
}

export function TwinViewer() {
  const assets = useTwin((s) => s.assets);
  const selectedAssetId = useTwin((s) => s.selectedAssetId);
  const componentStatus = useTwin((s) => s.status.components);
  const assetStatus = useTwin((s) => s.status.assets);
  const selectComponent = useTwin((s) => s.selectComponent);
  const findings = useTwin((s) => s.findings);
  const lifts = useTwin((s) => s.lifts);

  const asset = assets.find((a) => a.id === selectedAssetId) ?? assets[0];
  const mission = useAssetMission(asset?.id ?? "");
  if (!asset) return <div className="grid h-full place-items-center text-sm text-ink-3">Loading twin…</div>;
  const status = assetStatus[asset.id] ?? "nominal";
  const physical = asset.components.filter((c) => c.geometry);
  const geomOf = Object.fromEntries(physical.map((c) => [c.id, c.geometry!]));
  const assetFindings = findings.filter((f) => f.asset_id === asset.id && geomOf[f.component_id]);

  return (
    <div className="relative h-full w-full">
      <Canvas shadows camera={{ position: [120, 80, 160], fov: 40, near: 0.5, far: 5000 }} onPointerMissed={() => selectComponent(null)}>
        <color attach="background" args={["#0b0f14"]} />
        <hemisphereLight args={["#cbd5e1", "#1f2937", 0.7]} />
        <directionalLight position={[80, 140, 60]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} />
        <Bounds key={asset.id} fit clip margin={1.3} maxDuration={0.8}>
          <FocusOnSelection />
          <group>
            {physical.map((c) => (
              <ComponentMesh key={c.id} comp={c} status={componentStatus[c.id] ?? "nominal"} />
            ))}
          </group>
        </Bounds>
        {assetFindings.map((f) =>
          lifts[f.id] ? (
            <LiftedCloud key={f.id} f={f} g={geomOf[f.component_id]} lift={lifts[f.id]} />
          ) : (
            <FindingMarker key={f.id} f={f} g={geomOf[f.component_id]} />
          ),
        )}
        <Occluders asset={asset} />
        {mission && <MissionOverlay mission={mission} />}
        <Surroundings type={asset.type} />
        <Grid args={[600, 600]} cellSize={5} sectionSize={25} cellColor="#1f2a37" sectionColor="#273449" fadeDistance={500} infiniteGrid />
        <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.05} />
      </Canvas>

      <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-line bg-panel/85 px-3 py-2 backdrop-blur">
        <div className="text-[11px] uppercase tracking-wider text-ink-3">Structural twin</div>
        <div className="text-sm font-semibold text-ink">{asset.name}</div>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-2">
          <span style={{ color: STATUS_COLOR[status] }}>{STATUS_ICON[status]}</span>
          {STATUS_LABEL[status]} · {physical.length} BIM components
        </div>
        {assetFindings.length > 0 && (
          <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-2">
            <span className="inline-block h-2 w-2 rounded-sm bg-defect" />
            {assetFindings.length} pinned finding{assetFindings.length === 1 ? "" : "s"}
            <span className="text-ink-3">· placement approx.</span>
          </div>
        )}
        {mission?.path && (
          <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-2">
            <span className="inline-block h-0.5 w-3" style={{ background: "#34d399" }} />
            UAV re-scan {mission.id}: {Math.round((mission.baseline?.coverage ?? 0) * 100)}% → {Math.round((mission.chosen[0]?.coverage ?? 0) * 100)}% visible
          </div>
        )}
      </div>
    </div>
  );
}
