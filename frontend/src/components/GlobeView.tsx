import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api } from "../api";
import { useTwin } from "../store";
import { STATUS_COLOR, STATUS_ICON, STATUS_LABEL } from "../theme";
import type { FleetCondition, FleetSite, FleetState, Status } from "../types";

const STYLE = "https://tiles.openfreemap.org/styles/dark";
const REPAIR_COLOR = "#38bdf8";
const KIND_LABEL = { bridge: "Bridge", tunnel: "Tunnel", dam: "Dam" } as const;
const POLL_MS = 3000;

type SiteFeature = {
  type: "Feature";
  properties: { id: string; status: Status; repair: boolean };
  geometry: { type: "Point"; coordinates: [number, number] };
};

function features(sites: FleetSite[], cond: Map<string, FleetCondition>): { type: "FeatureCollection"; features: SiteFeature[] } {
  return {
    type: "FeatureCollection",
    features: sites.map((s) => {
      const c = cond.get(s.id);
      return {
        type: "Feature",
        properties: { id: s.id, status: c?.status ?? "nominal", repair: !!c?.repair },
        geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      };
    }),
  };
}

/** Popup content built from DOM nodes (site names come from an external dataset). */
function popupNode(site: FleetSite, c: FleetCondition | undefined): HTMLElement {
  const el = document.createElement("div");
  el.className = "globe-pop";
  const add = (cls: string, text: string, color?: string) => {
    const d = document.createElement("div");
    d.className = cls;
    d.textContent = text;
    if (color) d.style.color = color;
    el.appendChild(d);
  };
  const status = c?.status ?? "nominal";
  add("globe-pop-kind", `${KIND_LABEL[site.kind]} · ${site.country || "—"}`);
  add("globe-pop-name", site.name);
  add("globe-pop-status", `${STATUS_ICON[status]} ${STATUS_LABEL[status]} · ${site.sensors.toLocaleString()} sensors`, STATUS_COLOR[status]);
  if (c?.issue) add("globe-pop-line", c.issue);
  if (c?.repair) add("globe-pop-line", `Repair: ${c.repair.task}, ${Math.round(c.repair.progress * 100)}% · crew ${c.repair.crew}`, REPAIR_COLOR);
  return el;
}

function ago(t: number, now: number) {
  const s = Math.max(0, Math.round(now - t));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

/**
 * Every structure on one globe: real locations, simulated portfolio condition, and the corridor twins live.
 */
export function GlobeView() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const pending = useRef<ReturnType<typeof features>>({ type: "FeatureCollection", features: [] });
  const [sites, setSites] = useState<FleetSite[]>([]);
  const [state, setState] = useState<FleetState | null>(null);
  const target = useTwin((s) => s.globeTarget);
  const flyGlobe = useTwin((s) => s.flyGlobe);

  const cond = useMemo(() => new Map((state?.conditions ?? []).map((c) => [c.id, c])), [state]);
  const byId = useMemo(() => new Map(sites.map((s) => [s.id, s])), [sites]);
  const condRef = useRef(cond);
  condRef.current = cond;
  const byIdRef = useRef(byId);
  byIdRef.current = byId;

  useEffect(() => {
    api.fleetSites().then((r) => setSites(r.sites), console.error);
    const load = () => api.fleetState().then(setState, () => undefined);
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, []);

  // The globe
  useEffect(() => {
    if (!container.current) return;
    const m = new maplibregl.Map({
      container: container.current,
      style: STYLE,
      center: [40, 22],
      zoom: 2.15,
      attributionControl: { compact: true },
    });
    m.once("load", () => container.current?.querySelector(".maplibregl-compact-show")?.classList.remove("maplibregl-compact-show"));
    m.on("style.load", () => {
      m.setProjection({ type: "globe" });
      m.setSky({ "sky-color": "#0b1220", "horizon-color": "#1e3a5f", "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0] });
      m.addSource("fleet", { type: "geojson", data: pending.current }); // condition polled before the style was ready
      const r = (base: number) => ["interpolate", ["linear"], ["zoom"], 1, base, 6, base * 2.2] as maplibregl.ExpressionSpecification;
      m.addLayer({
        id: "fleet-nominal",
        type: "circle",
        source: "fleet",
        filter: ["==", ["get", "status"], "nominal"],
        paint: { "circle-radius": r(2.2), "circle-color": STATUS_COLOR.nominal, "circle-opacity": 0.55 },
      });
      m.addLayer({
        id: "fleet-repair",
        type: "circle",
        source: "fleet",
        filter: ["get", "repair"],
        paint: { "circle-radius": r(5.5), "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": REPAIR_COLOR, "circle-stroke-width": 1.5 },
      });
      m.addLayer({
        id: "fleet-watch",
        type: "circle",
        source: "fleet",
        filter: ["==", ["get", "status"], "watch"],
        paint: { "circle-radius": r(3.6), "circle-color": STATUS_COLOR.watch, "circle-stroke-color": "#0b0f14", "circle-stroke-width": 1 },
      });
      m.addLayer({
        id: "fleet-critical-halo",
        type: "circle",
        source: "fleet",
        filter: ["==", ["get", "status"], "critical"],
        paint: { "circle-radius": 8, "circle-color": STATUS_COLOR.critical, "circle-opacity": 0.35 },
      });
      m.addLayer({
        id: "fleet-critical",
        type: "circle",
        source: "fleet",
        filter: ["==", ["get", "status"], "critical"],
        paint: { "circle-radius": r(4.6), "circle-color": STATUS_COLOR.critical, "circle-stroke-color": "#0b0f14", "circle-stroke-width": 1 },
      });
      ready.current = true;
    });

    // Site details on click
    for (const layer of ["fleet-nominal", "fleet-watch", "fleet-critical", "fleet-repair"]) {
      m.on("click", layer, (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        const site = id ? byIdRef.current.get(id) : undefined;
        if (!site) return;
        new maplibregl.Popup({ closeButton: false, maxWidth: "280px" }).setLngLat([site.lng, site.lat]).setDOMContent(popupNode(site, condRef.current.get(id!))).addTo(m);
      });
      m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
    }

    // Slow spin until someone touches it (or the demo flies somewhere); critical halos pulse.
    let raf = 0;
    let idleSince = 0;
    let spinning = true;
    const stop = () => {
      spinning = false;
      idleSince = performance.now();
    };
    m.on("mousedown", stop);
    m.on("wheel", stop);
    m.on("touchstart", stop);
    m.on("movestart", (e) => {
      if ((e as { originalEvent?: Event }).originalEvent) stop();
    });
    const frame = (now: number) => {
      if (!spinning && now - idleSince > 10000 && !m.isMoving() && m.getZoom() < 3) spinning = true;
      if (spinning && !m.isMoving() && m.getZoom() < 3) {
        const c = m.getCenter();
        m.setCenter([c.lng + 0.06, c.lat]);
      }
      if (ready.current && m.getLayer("fleet-critical-halo")) {
        const p = (now % 1600) / 1600;
        m.setPaintProperty("fleet-critical-halo", "circle-radius", 6 + 14 * p);
        m.setPaintProperty("fleet-critical-halo", "circle-opacity", 0.45 * (1 - p));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    (m as unknown as { stopSpin: () => void }).stopSpin = stop;

    map.current = m;
    if (import.meta.env.DEV) (window as unknown as { __globe: maplibregl.Map }).__globe = m;
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(container.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ready.current = false;
      m.remove();
      map.current = null;
    };
  }, []);

  // Live corridor twins: labelled markers
  const live = state?.live;
  const liveKey = live?.map((a) => `${a.id}:${a.status}`).join(",");
  useEffect(() => {
    const m = map.current;
    if (!m || !live) return;
    // One pin per corridor (its twins sit kilometres apart, which is a single point at globe scale).
    const regions = new Map<string, typeof live>();
    for (const a of live) regions.set(a.region, [...(regions.get(a.region) ?? []), a]);
    const markers = [...regions.values()].map((group) => {
      const a = group.find((g) => g.status === "critical") ?? group.find((g) => g.status === "watch") ?? group[0];
      const el = document.createElement("button");
      el.className = "pin";
      const dot = document.createElement("span");
      dot.className = `pin-dot${a.status === "critical" ? " pin-critical" : ""}`;
      dot.style.background = STATUS_COLOR[a.status];
      dot.textContent = STATUS_ICON[a.status];
      const label = document.createElement("span");
      label.className = "pin-label";
      label.textContent = group.length > 1 ? `${a.region} · ${group.length} twins` : a.name;
      const tag = document.createElement("span");
      tag.className = a.data_source === "simulated" ? "pin-sim" : "pin-real";
      tag.textContent = group.length > 1 ? "live" : "live twin";
      label.appendChild(tag);
      el.append(dot, label);
      el.addEventListener("click", () => {
        useTwin.getState().setView("corridor");
        useTwin.getState().selectAsset(group.length > 1 ? null : a.id);
      });
      return new maplibregl.Marker({ element: el, anchor: "left" }).setLngLat([a.lng, a.lat]).addTo(m);
    });
    return () => markers.forEach((mk) => mk.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild only when a twin's status changes
  }, [liveKey]);

  // Site condition -> map
  useEffect(() => {
    const m = map.current;
    if (!m || sites.length === 0) return;
    pending.current = features(sites, cond);
    if (ready.current) (m.getSource("fleet") as maplibregl.GeoJSONSource).setData(pending.current);
  }, [sites, cond]);

  // Fly on request (demo, or a click in the lists)
  useEffect(() => {
    const m = map.current;
    if (!m || !target) return;
    (m as unknown as { stopSpin: () => void }).stopSpin();
    m.flyTo({ center: [target.lng, target.lat], zoom: target.zoom, duration: 3000, essential: true });
  }, [target]);

  const s = state?.summary;
  const attention = (state?.conditions ?? [])
    .filter((c) => c.status !== "nominal")
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "critical" ? -1 : 1))
    .slice(0, 6);
  const repairs = (state?.conditions ?? []).filter((c) => c.repair).sort((a, b) => b.repair!.progress - a.repair!.progress).slice(0, 5);
  const go = (id: string) => {
    const site = byId.get(id);
    if (site) flyGlobe(site.lng, site.lat, 5);
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[1fr_420px]">
      <div data-spot="globe" className="relative h-[50vh] bg-[#05080d] lg:h-auto">
        <div ref={container} className="h-full w-full" />
        <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap gap-3 rounded-md border border-line bg-panel/80 px-3 py-2 text-[11px] text-ink-2 backdrop-blur">
          {(["nominal", "watch", "critical"] as Status[]).map((st) => (
            <span key={st} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[st] }} />
              {STATUS_LABEL[st]}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border" style={{ borderColor: REPAIR_COLOR }} />
            Repair underway
          </span>
        </div>
      </div>

      <aside data-spot="dashboard" className="min-h-0 overflow-y-auto border-l border-line bg-panel">
        <div className="border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-critical" />
            <span className="text-[11px] uppercase tracking-wider text-ink-3">Live · global portfolio</span>
          </div>
          <div className="mt-1 text-lg font-semibold text-ink">Every structure, one screen</div>
          <div className="text-[11px] text-ink-3">Real locations (Wikidata) · portfolio condition simulated · 4 twins live</div>
        </div>

        {s && (
          <div className="grid grid-cols-3 gap-px border-b border-line bg-line">
            {[
              ["Structures", s.structures.toLocaleString(), `${s.countries} countries`, "text-ink"],
              ["Sensors online", `${((s.sensors_online / s.sensors) * 100).toFixed(1)}%`, `${(s.sensors_online / 1000).toFixed(1)}k of ${(s.sensors / 1000).toFixed(1)}k`, "text-ink"],
              ["Repairs", String(s.repairs), "underway now", "text-accent"],
              ["Critical", String(s.critical), "act now", "text-critical"],
              ["Watch", String(s.watch), "trending", "text-watch"],
              ["Nominal", String(s.nominal), "healthy", "text-nominal"],
            ].map(([label, value, sub, cls]) => (
              <div key={label} className="bg-panel px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider text-ink-3">{label}</div>
                <div className={`text-xl font-semibold tabular-nums ${cls}`}>{value}</div>
                <div className="text-[10px] text-ink-3">{sub}</div>
              </div>
            ))}
          </div>
        )}

        {s && (
          <div className="flex h-1.5 w-full" aria-label="Portfolio health">
            <div className="bg-nominal" style={{ flex: s.nominal }} />
            <div className="bg-watch" style={{ flex: s.watch }} />
            <div className="bg-critical" style={{ flex: s.critical }} />
          </div>
        )}

        <section className="px-4 py-3">
          <h3 className="text-[11px] uppercase tracking-wider text-ink-3">Live twins</h3>
          <ul className="mt-1.5 space-y-1">
            {(state?.live ?? []).map((a) => (
              <li key={a.id}>
                <button
                  className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-line/50"
                  onClick={() => {
                    useTwin.getState().setView("corridor");
                    useTwin.getState().selectAsset(a.id);
                  }}
                >
                  <span style={{ color: STATUS_COLOR[a.status] }}>{STATUS_ICON[a.status]}</span>
                  <span className="truncate text-ink">{a.name}</span>
                  <span className="ml-auto shrink-0 text-ink-3">{a.site ?? ""}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="border-t border-line px-4 py-3">
          <h3 className="text-[11px] uppercase tracking-wider text-ink-3">Needs attention</h3>
          <ul className="mt-1.5 space-y-1.5">
            {attention.map((c) => {
              const site = byId.get(c.id);
              if (!site) return null;
              return (
                <li key={c.id}>
                  <button className="w-full rounded px-1 py-0.5 text-left hover:bg-line/50" onClick={() => go(c.id)}>
                    <div className="flex items-center gap-1.5 text-xs">
                      <span style={{ color: STATUS_COLOR[c.status] }}>{STATUS_ICON[c.status]}</span>
                      <span className="truncate font-medium text-ink">{site.name}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-ink-3">{site.country}</span>
                    </div>
                    <div className="pl-4 text-[11px] text-ink-2">{c.issue}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="border-t border-line px-4 py-3">
          <h3 className="text-[11px] uppercase tracking-wider text-ink-3">Repairs in progress</h3>
          <ul className="mt-1.5 space-y-2">
            {repairs.map((c) => {
              const site = byId.get(c.id);
              if (!site || !c.repair) return null;
              return (
                <li key={c.id}>
                  <button className="w-full rounded px-1 text-left hover:bg-line/50" onClick={() => go(c.id)}>
                    <div className="flex items-baseline gap-1.5 text-xs">
                      <span className="truncate text-ink">{site.name}</span>
                      <span className="ml-auto shrink-0 tabular-nums text-accent">{Math.round(c.repair.progress * 100)}%</span>
                    </div>
                    <div className="mt-0.5 h-1 rounded bg-line">
                      <div className="h-1 rounded bg-accent transition-[width] duration-1000" style={{ width: `${c.repair.progress * 100}%` }} />
                    </div>
                    <div className="mt-0.5 text-[10px] text-ink-3">
                      {c.repair.task} · crew {c.repair.crew} · ~{c.repair.eta_days} d left
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="border-t border-line px-4 py-3">
          <h3 className="text-[11px] uppercase tracking-wider text-ink-3">Live feed</h3>
          <ul className="mt-1.5 space-y-1.5">
            {(state?.events ?? []).map((e) => (
              <li key={e.t} className="feed-in text-[11px]">
                <button className="w-full text-left" onClick={() => go(e.site_id)}>
                  <span className="text-ink-3">{ago(e.t, state!.t)} · </span>
                  <span className="text-ink">{e.name}</span>
                  <span className="text-ink-3"> ({e.country}) </span>
                  <span
                    className={
                      e.level === "critical" ? "text-critical" : e.level === "watch" ? "text-watch" : e.level === "repair" ? "text-accent" : "text-ink-2"
                    }
                  >
                    {e.text}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}
