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

export type ServerMessage =
  | { type: "snapshot"; history: { t: number; readings: Record<string, number> }[]; alerts: Alert[]; status: StatusSnapshot }
  | { type: "tick"; t: number; readings: Record<string, number>; status: StatusSnapshot }
  | { type: "alert"; alert: Alert };
