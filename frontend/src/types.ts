export type Status = "nominal" | "watch" | "critical";

export interface Geometry {
  shape: "box" | "cylinder" | "arch";
  position: [number, number, number];
  size: [number, number, number];
}

export interface Sensor {
  id: string;
  component_id: string;
  kind: string;
  label: string;
  unit: string;
  baseline: number;
  watch: number;
  critical: number;
}

export interface Component {
  id: string;
  asset_id: string;
  name: string;
  kind: string;
  geometry: Geometry | null;
  sensor_ids: string[];
}

export interface Asset {
  id: string;
  name: string;
  type: "bridge" | "tunnel" | "dam";
  lng: number;
  lat: number;
  heading_deg: number;
  description: string;
  components: Component[];
  sensors: Sensor[];
}

export interface Alert {
  id: string;
  t: number;
  level: Status;
  asset_id: string;
  component_id: string;
  sensor_id: string;
  value: number;
  message: string;
}

export interface StatusSnapshot {
  sensors: Record<string, Status>;
  components: Record<string, Status>;
  assets: Record<string, Status>;
}

export interface Finding {
  id: string;
  t: number;
  asset_id: string;
  component_id: string;
  concept: string;
  confidence: number | null;
  area_px: number;
  source: "image" | "video";
  source_name: string;
  bbox_uv: [number, number, number, number];
  host_label: string | null;
  frames_tracked: number | null;
  thumbnail: string;
}

export type FindingIn = Omit<Finding, "id" | "t" | "asset_id">;

export type ServerMessage =
  | {
      type: "snapshot";
      history: { t: number; readings: Record<string, number> }[];
      alerts: Alert[];
      status: StatusSnapshot;
      findings: Finding[];
      triages: Triage[];
    }
  | { type: "tick"; t: number; readings: Record<string, number>; status: StatusSnapshot }
  | { type: "alert"; alert: Alert }
  | { type: "findings"; added: Finding[]; removed: string[] }
  | { type: "triage"; triage: Triage }
  | { type: "triage_delta"; id: string; delta: string };

export type ConceptCategory = "structural" | "defect";

export interface Concept {
  text: string;
  category: ConceptCategory;
}

export interface Detection {
  id: string;
  concept: string;
  category: ConceptCategory;
  box: [number, number, number, number];
  confidence: number | null;
  area_px: number;
  mask: { bounds: [number, number, number, number]; png: string } | null;
  host_id: string | null;
  host_overlap: number | null;
}

export interface ConceptRun {
  text: string;
  category: ConceptCategory;
  count: number;
  ms: number;
  error: string | null;
}

export interface SegmentationReport {
  model: string;
  width: number;
  height: number;
  concepts: ConceptRun[];
  detections: Detection[];
  est_cost_usd: number;
}

export interface TrackFrame {
  f: number;
  box: [number, number, number, number];
  confidence: number | null;
  area_px: number;
  mask: Detection["mask"];
}

export interface Track {
  id: string;
  concept: string;
  category: ConceptCategory;
  frames: TrackFrame[];
  best_frame: number;
  confidence: number | null;
  host_id: string | null;
  host_overlap: number | null;
}

export interface VideoReport {
  model: string;
  width: number;
  height: number;
  fps: number;
  n_frames: number;
  concepts: ConceptRun[];
  tracks: Track[];
  est_cost_usd: number;
}

export interface TriageResult {
  severity: "low" | "moderate" | "high" | "critical";
  summary: string;
  likely_causes: string[];
  evidence: string[];
  recommended_actions: string[];
  visual_audit_needed: boolean;
  visual_audit_target: string;
  confidence: number;
}

export interface Triage {
  id: string;
  t: number;
  alert_id: string;
  asset_id: string;
  component_id: string;
  model: string;
  status: "running" | "done" | "error";
  reasoning: string;
  result: TriageResult | null;
  error: string | null;
  ms: number | null;
}
