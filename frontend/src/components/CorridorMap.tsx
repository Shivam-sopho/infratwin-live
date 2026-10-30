import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTwin } from "../store";
import { STATUS_COLOR, STATUS_ICON } from "../theme";
import type { Status } from "../types";

// Key-free satellite imagery + terrain so the demo runs with zero setup.
const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    satellite: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    },
    dem: {
      type: "raster-dem",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 14,
      encoding: "terrarium",
      attribution: "Terrain: Mapzen / AWS Open Data",
    },
  },
  layers: [
    { id: "satellite", type: "raster", source: "satellite" },
    { id: "hillshade", type: "hillshade", source: "dem", paint: { "hillshade-exaggeration": 0.25 } },
  ],
  terrain: { source: "dem", exaggeration: 1.4 },
  sky: {},
};

function paintMarker(el: HTMLElement, status: Status, selected: boolean) {
  const dot = el.querySelector<HTMLElement>("[data-dot]")!;
  dot.style.background = STATUS_COLOR[status];
  dot.textContent = STATUS_ICON[status];
  dot.classList.toggle("pin-critical", status === "critical");
  el.classList.toggle("pin-selected", selected);
}

export function CorridorMap() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<Record<string, HTMLElement>>({});

  const assets = useTwin((s) => s.assets);
  const assetStatus = useTwin((s) => s.status.assets);
  const selectedAssetId = useTwin((s) => s.selectedAssetId);
  const selectAsset = useTwin((s) => s.selectAsset);

  useEffect(() => {
    if (!container.current || assets.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    assets.forEach((a) => bounds.extend([a.lng, a.lat]));

    const m = new maplibregl.Map({
      container: container.current,
      style: STYLE,
      bounds,
      fitBoundsOptions: { padding: 80 },
      pitch: 50,
      maxPitch: 80,
    });
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.current = m;

    for (const a of assets) {
      const el = document.createElement("button");
      el.className = "pin";
      el.innerHTML = `<span data-dot class="pin-dot"></span><span class="pin-label">${a.name}</span>`;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        selectAsset(a.id);
      });
      new maplibregl.Marker({ element: el, anchor: "left" }).setLngLat([a.lng, a.lat]).addTo(m);
      markers.current[a.id] = el;
    }

    return () => {
      m.remove();
      map.current = null;
      markers.current = {};
    };
  }, [assets, selectAsset]);

  useEffect(() => {
    for (const [id, el] of Object.entries(markers.current)) {
      paintMarker(el, assetStatus[id] ?? "nominal", id === selectedAssetId);
    }
  }, [assetStatus, selectedAssetId]);

  useEffect(() => {
    const asset = assets.find((a) => a.id === selectedAssetId);
    if (!asset || !map.current) return;
    map.current.flyTo({
      center: [asset.lng, asset.lat],
      zoom: 15.5,
      pitch: 62,
      bearing: asset.heading_deg,
      duration: 2200,
      essential: true,
    });
  }, [selectedAssetId, assets]);

  return <div ref={container} className="h-full w-full" />;
}
