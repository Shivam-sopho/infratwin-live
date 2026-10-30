import { useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Bounds, Edges, Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useTwin } from "../store";
import { CONCRETE, STATUS_COLOR, STATUS_ICON, STATUS_LABEL } from "../theme";
import type { Asset, Component, Status } from "../types";

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

  const asset = assets.find((a) => a.id === selectedAssetId) ?? assets[0];
  if (!asset) return <div className="grid h-full place-items-center text-sm text-ink-3">Loading twin…</div>;
  const status = assetStatus[asset.id] ?? "nominal";
  const physical = asset.components.filter((c) => c.geometry);

  return (
    <div className="relative h-full w-full">
      <Canvas shadows camera={{ position: [120, 80, 160], fov: 40, near: 0.5, far: 5000 }} onPointerMissed={() => selectComponent(null)}>
        <color attach="background" args={["#0b0f14"]} />
        <hemisphereLight args={["#cbd5e1", "#1f2937", 0.7]} />
        <directionalLight position={[80, 140, 60]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} />
        <Bounds key={asset.id} fit clip margin={1.15}>
          <group>
            {physical.map((c) => (
              <ComponentMesh key={c.id} comp={c} status={componentStatus[c.id] ?? "nominal"} />
            ))}
          </group>
        </Bounds>
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
      </div>
    </div>
  );
}
