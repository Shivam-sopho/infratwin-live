import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useTwin } from "../store";
import { STATUS_COLOR, STATUS_ICON } from "../theme";
import { localToLngLat } from "../geo";
import type { Status } from "../types";
import { PATH_COLOR } from "./twin/MissionOverlay";

type PathCollection = { type: "FeatureCollection"; features: { type: "Feature"; properties: { id: string }; geometry: { type: "LineString"; coordinates: [number, number][] } }[] };

// MapLibre resolves its worker relative to its own module, which breaks once Vite bundles it.
maplibregl.setWorkerUrl(workerUrl);

// Key-free basemaps so the demo runs with zero setup.
// Map: OpenFreeMap (OpenStreetMap data) dark style with labels; we add 3D terrain and 3D buildings.
const MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";
const DEM = {
  type: "raster-dem" as const,
  tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
  tileSize: 256,
  maxzoom: 14,
  encoding: "terrarium" as const,
  attribution: "Terrain: Mapzen / AWS Open Data",
};
// Satellite: Esri World Imagery with the same terrain.
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    satellite: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    },
    dem: DEM,
  },
  layers: [
    { id: "satellite", type: "raster", source: "satellite" },
    { id: "hillshade", type: "hillshade", source: "dem", paint: { "hillshade-exaggeration": 0.25 } },
  ],
  terrain: { source: "dem", exaggeration: 1.4 },
  sky: {},
};

function paintMarker(el: HTMLElement, status: Status, selected: boolean, findings: number) {
  const dot = el.querySelector<HTMLElement>("[data-dot]")!;
  dot.style.background = STATUS_COLOR[status];
  dot.textContent = STATUS_ICON[status];
  dot.classList.toggle("pin-critical", status === "critical");
  el.classList.toggle("pin-selected", selected);
  const count = el.querySelector<HTMLElement>("[data-count]")!;
  count.hidden = findings === 0;
  count.textContent = `${findings} defect${findings === 1 ? "" : "s"}`;
}

export function CorridorMap() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<Record<string, HTMLElement>>({});
  const paths = useRef<PathCollection>({ type: "FeatureCollection", features: [] });
  const pathsReady = useRef(false);
  const lastRegion = useRef<string | null>(null);
  const [basemap, setBasemap] = useState<"map" | "satellite">("map");

  const assets = useTwin((s) => s.assets);
  const assetStatus = useTwin((s) => s.status.assets);
  const selectedAssetId = useTwin((s) => s.selectedAssetId);
  const selectAsset = useTwin((s) => s.selectAsset);
  const findings = useTwin((s) => s.findings);
  const missions = useTwin((s) => s.missions);
  const selectedMissionId = useTwin((s) => s.selectedMissionId);

  useEffect(() => {
    if (!container.current || assets.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    assets.filter((a) => a.region === assets[0].region).forEach((a) => bounds.extend([a.lng, a.lat]));

    const m = new maplibregl.Map({
      container: container.current,
      style: MAP_STYLE,
      bounds,
      fitBoundsOptions: { padding: 80 },
      pitch: 50,
      maxPitch: 80,
    });
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    // Re-applied on every style change (Map <-> Satellite): terrain, 3D buildings, drone flight paths.
    m.on("style.load", () => {
      if (!m.getSource("dem")) m.addSource("dem", DEM);
      m.setTerrain({ source: "dem", exaggeration: 1.3 });
      if (m.getSource("openmaptiles") && !m.getLayer("buildings-3d")) {
        m.addLayer({
          id: "buildings-3d",
          type: "fill-extrusion",
          source: "openmaptiles",
          "source-layer": "building",
          minzoom: 14,
          paint: {
            "fill-extrusion-color": "#2b3442",
            "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
            "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
            "fill-extrusion-opacity": 0.85,
          },
        });
      }
      m.addSource("mission-paths", { type: "geojson", data: paths.current });
      m.addLayer({
        id: "mission-paths-glow",
        type: "line",
        source: "mission-paths",
        paint: { "line-color": PATH_COLOR, "line-width": 10, "line-opacity": 0.25, "line-blur": 4 },
      });
      m.addLayer({
        id: "mission-paths",
        type: "line",
        source: "mission-paths",
        paint: { "line-color": PATH_COLOR, "line-width": 2.5 },
      });
      pathsReady.current = true;
    });
    map.current = m;

    for (const a of assets) {
      const el = document.createElement("button");
      el.className = "pin";
      const tag = a.data_source === "simulated" ? `<span class="pin-sim">simulated</span>` : `<span class="pin-real">real data</span>`;
      el.innerHTML = `<span data-dot class="pin-dot"></span><span class="pin-label">${a.name}${tag}<span data-count class="pin-count" hidden></span></span>`;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        selectAsset(a.id);
      });
      new maplibregl.Marker({ element: el, anchor: "left" }).setLngLat([a.lng, a.lat]).addTo(m);
      markers.current[a.id] = el;
    }

    return () => {
      pathsReady.current = false;
      m.remove();
      map.current = null;
      markers.current = {};
    };
  }, [assets, selectAsset]);

  useEffect(() => {
    const counts: Record<string, number> = {};
    for (const f of findings) counts[f.asset_id] = (counts[f.asset_id] ?? 0) + 1;
    for (const [id, el] of Object.entries(markers.current)) {
      paintMarker(el, assetStatus[id] ?? "nominal", id === selectedAssetId, counts[id] ?? 0);
    }
  }, [assetStatus, selectedAssetId, findings]);

  const appliedBasemap = useRef<"map" | "satellite">("map");
  useEffect(() => {
    const m = map.current;
    if (!m || appliedBasemap.current === basemap) return; // the map is created with the default style
    appliedBasemap.current = basemap;
    pathsReady.current = false; // custom layers are re-added on style.load
    m.setStyle(basemap === "map" ? MAP_STYLE : SATELLITE_STYLE);
  }, [basemap]);

  // Latest completed mission per asset, drawn as a ground-projected flight line.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const latest = new Map<string, (typeof missions)[number]>();
    for (const ms of missions) if (ms.status === "done" && ms.path) latest.set(ms.asset_id, ms);
    const data: PathCollection = {
      type: "FeatureCollection",
      features: [...latest.values()].flatMap((ms) => {
        const asset = assets.find((a) => a.id === ms.asset_id);
        if (!asset || !ms.path) return [];
        return [
          {
            type: "Feature" as const,
            properties: { id: ms.id },
            geometry: { type: "LineString" as const, coordinates: ms.path.waypoints.map(([x, , z]) => localToLngLat(asset, x, z)) },
          },
        ];
      }),
    };
    paths.current = data; // picked up by the load handler if the style isn't ready yet
    if (pathsReady.current) (m.getSource("mission-paths") as maplibregl.GeoJSONSource).setData(data);
  }, [missions, assets]);

  useEffect(() => {
    if (!map.current) return;
    if (selectedAssetId === null && assets.length) {
      // Back to the overview of the region last looked at (regions can be continents apart).
      const region = lastRegion.current ?? assets[0].region;
      const b = new maplibregl.LngLatBounds();
      assets.filter((a) => a.region === region).forEach((a) => b.extend([a.lng, a.lat]));
      map.current.fitBounds(b, { padding: 80, pitch: 50, bearing: 0, duration: 2000 });
      return;
    }
    const asset = assets.find((a) => a.id === selectedAssetId);
    if (!asset) return;
    lastRegion.current = asset.region;
    map.current.flyTo({
      center: [asset.lng, asset.lat],
      zoom: 15.5,
      pitch: 62,
      bearing: asset.heading_deg,
      duration: 2200,
      essential: true,
    });
  }, [selectedAssetId, assets]);

  // Selecting a mission zooms the map onto its flight (after the asset fly-to so it wins).
  useEffect(() => {
    const ms = missions.find((m) => m.id === selectedMissionId);
    const asset = ms && assets.find((a) => a.id === ms.asset_id);
    if (!map.current || !ms?.path || !asset) return;
    const b = new maplibregl.LngLatBounds();
    ms.path.waypoints.forEach(([x, , z]) => b.extend(localToLngLat(asset, x, z)));
    map.current.fitBounds(b, { padding: 80, maxZoom: 19, pitch: 55, bearing: asset.heading_deg, duration: 2000 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-fit when the selection changes
  }, [selectedMissionId]);

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full" />
      <div className="absolute left-3 top-3 flex overflow-hidden rounded-md border border-line bg-panel/90 text-xs backdrop-blur" role="radiogroup" aria-label="Basemap">
        {(["map", "satellite"] as const).map((b) => (
          <button
            key={b}
            role="radio"
            aria-checked={basemap === b}
            onClick={() => setBasemap(b)}
            className={`px-2.5 py-1 capitalize ${basemap === b ? "bg-accent text-bg" : "text-ink-2 hover:text-ink"}`}
          >
            {b}
          </button>
        ))}
      </div>
    </div>
  );
}
