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

export interface Occluder {
  id: string;
  name: string;
  kind: string;
  geometry: Geometry;
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
  occluders: Occluder[];
  uav_home: [number, number, number] | null;
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

export interface Metrology {
  method: "host-scale-2d" | "normal-gradient-raycast";
  scale_mm_per_px: number | null;
  scale_note: string;
  area_m2: number;
  perimeter_m: number;
  length_m: number | null;
  max_width_mm: number | null;
  mean_width_mm: number | null;
  inclination_deg: number | null;
  resolution_mm: number | null;
  assumptions: string[];
  warnings: string[];
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
  metrology: Metrology | null;
  mask_png?: string | null;
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
      missions: Mission[];
      notes: Note[];
      screens: Screen[];
    }
  | { type: "tick"; t: number; readings: Record<string, number>; status: StatusSnapshot }
  | { type: "alert"; alert: Alert }
  | { type: "findings"; added: Finding[]; removed: string[] }
  | { type: "triage"; triage: Triage }
  | { type: "triage_delta"; id: string; delta: string }
  | { type: "mission"; mission: Mission }
  | { type: "mission_delta"; id: string; delta: string }
  | { type: "notes"; added: Note[] }
  | { type: "screen"; screen: Screen };

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
  metrology?: Metrology | null;
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
  metrology: Metrology | null;
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

export type Vec3 = [number, number, number];

export interface Viewpoint {
  id: string;
  yaw_deg: number;
  pitch_deg: number;
  standoff_m: number;
  position: Vec3;
  look_at: Vec3;
  coverage: number;
  mean_incidence_deg: number | null;
  quality: number;
  blocked_by: string[];
}

export interface MissionPlan {
  summary: string;
  chosen_viewpoint_ids: string[];
  standoff_m: number;
  expected_coverage: number;
  gimbal_notes: string;
  safety_notes: string[];
  rationale: string[];
}

export interface Mission {
  id: string;
  t: number;
  asset_id: string;
  component_id: string;
  finding_id: string | null;
  model: string;
  status: "running" | "done" | "error";
  reasoning: string;
  tool_calls: { name: string; args: Record<string, unknown>; summary: string }[];
  baseline: Viewpoint | null;
  candidates: Viewpoint[];
  chosen: Viewpoint[];
  path: { waypoints: Vec3[]; length_m: number; detours: number } | null;
  plan: MissionPlan | null;
  note: string | null;
  error: string | null;
  ms: number | null;
}

export interface Note {
  id: string;
  t: number;
  asset_id: string;
  component_id: string;
  text: string;
  transcript: string;
  source: "voice";
}

export interface VoiceActionResult {
  type: "select_component" | "add_note" | "measure" | "run_triage" | "plan_rescan" | "open_inspection" | "simulate_event" | "none";
  component_id: string;
  text: string;
  status: "done" | "client" | "skipped" | "error";
  detail: string;
}

export interface VoiceResult {
  transcript: string;
  reply: string;
  audio_ms: number | null;
  actions: VoiceActionResult[];
}

export type Scenario = "6mo" | "2y" | "repair";

export interface Forecast {
  finding_id: string;
  scenario: Scenario;
  t: number;
  narrative: string;
  image_prompt: string;
  image_url: string;
  models: string[];
}

export interface Screen {
  alert_id: string;
  t: number;
  model: string;
  verdict: "structural" | "sensor_fault" | "environmental" | "uncertain";
  escalate: boolean;
  reason: string;
  ms: number;
}

export interface Verification {
  finding_id: string;
  t: number;
  model: string;
  status: "done" | "error";
  commentary: string[];
  runs: { code: string; result: { stdout: string; stderr: string; exit_code: number | null; ms: number } }[];
  independent: Record<string, number | null> | null;
  ours: Record<string, number | null>;
  agreement: string | null;
  summary: string | null;
  error: string | null;
}
