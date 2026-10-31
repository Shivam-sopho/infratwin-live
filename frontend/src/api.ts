import type { Asset, Concept, Finding, FindingIn, SegmentationReport, VideoReport } from "./types";

async function json<T>(res: Response): Promise<T> {
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
  health: () => fetch("/api/health").then(json<{ ok: boolean; meta_api_configured: boolean }>),
  injectAnomaly: (component_id: string) =>
    fetch("/api/sim/anomaly", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ component_id }),
    }).then(json),
  resetSim: () => fetch("/api/sim/reset", { method: "POST" }).then(json),
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
  deleteFinding: (id: string) => fetch(`/api/findings/${id}`, { method: "DELETE" }).then(json),
};
