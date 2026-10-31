import type { Asset, SampleItem, Concept, Finding, FindingIn, Forecast, Lift, Scenario, SegmentationReport, Verification, VideoReport, VoiceResult, WorkZoneReport } from "./types";

/** Called on any 401 so the app can show the login gate. */
let onUnauthorized: () => void = () => undefined;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

async function json<T>(res: Response): Promise<T> {
  if (res.status === 401) onUnauthorized();
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      detail = JSON.parse(text).detail ?? text;
    } catch {
      /* not JSON */
    }
    throw new Error(`${res.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  assets: () => fetch("/api/assets").then(json<Asset[]>),
  health: () =>
    fetch("/api/health").then(
      json<{
        ok: boolean;
        meta_api_configured: boolean;
        glimmer_configured: boolean;
        spark_open_configured: boolean;
        modal_configured: boolean;
        auth_required: boolean;
        budget: { spent_usd: number; cap_usd: number };
      }>,
    ),
  login: (token: string) =>
    fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).then(json),
  logout: () => fetch("/api/auth/logout", { method: "POST" }).then(json),
  injectAnomaly: (component_id: string) =>
    fetch("/api/sim/anomaly", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ component_id }),
    }).then(json),
  resetSim: () => fetch("/api/sim/reset", { method: "POST" }).then(json),
  demoReset: () => fetch("/api/demo/reset", { method: "POST" }).then(json),
  vocabulary: () => fetch("/api/inspect/vocabulary").then(json<Concept[]>),
  segment: (file: File, concepts: Concept[], componentId?: string) => {
    const body = new FormData();
    body.append("file", file);
    body.append("concepts", JSON.stringify(concepts));
    if (componentId) body.append("component_id", componentId);
    return fetch("/api/inspect/segment", { method: "POST", body }).then(json<SegmentationReport>);
  },
  segmentVideo: (file: File, concepts: Concept[], componentId?: string) => {
    const body = new FormData();
    body.append("file", file);
    body.append("concepts", JSON.stringify(concepts));
    if (componentId) body.append("component_id", componentId);
    return fetch("/api/inspect/segment-video", { method: "POST", body }).then(json<VideoReport>);
  },
  addFindings: (items: FindingIn[]) =>
    fetch("/api/findings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(items),
    }).then(json<Finding[]>),
  triage: (alert_id: string) =>
    fetch("/api/triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alert_id }),
    }).then(json),
  createMission: (component_id: string, finding_id?: string) =>
    fetch("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ component_id, finding_id: finding_id ?? null }),
    }).then(json<{ id: string }>),
  voice: (wav: Blob, selectedComponentId: string | null) => {
    const body = new FormData();
    body.append("file", wav, "command.wav");
    if (selectedComponentId) body.append("selected_component_id", selectedComponentId);
    return fetch("/api/voice", { method: "POST", body }).then(json<VoiceResult>);
  },
  forecasts: (findingId: string) => fetch(`/api/findings/${findingId}/forecasts`).then(json<Forecast[]>),
  createForecast: (findingId: string, scenario: Scenario) =>
    fetch(`/api/findings/${findingId}/forecasts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario }),
    }).then(json<Forecast>),
  verify: (findingId: string) => fetch(`/api/findings/${findingId}/verify`, { method: "POST" }).then(json<Verification>),
  lift: (findingId: string) => fetch(`/api/findings/${findingId}/lift`, { method: "POST" }).then(json<Lift>),
  workzone: (file: File, bounds: number[], maskPng: string, radiusM: number) => {
    const body = new FormData();
    body.append("file", file);
    body.append("defect_bounds", JSON.stringify(bounds));
    body.append("defect_mask_png", maskPng);
    body.append("radius_m", String(radiusM));
    return fetch("/api/inspect/workzone", { method: "POST", body }).then(json<WorkZoneReport>);
  },
  samples: () => fetch("/api/samples").then(json<{ source: string | null; items: SampleItem[] }>),
  deleteFinding: (id: string) => fetch(`/api/findings/${id}`, { method: "DELETE" }).then(json),
};
