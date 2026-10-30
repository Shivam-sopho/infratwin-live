import type { Status } from "./types";

export const STATUS_COLOR: Record<Status, string> = {
  nominal: "#22c55e",
  watch: "#eab308",
  critical: "#ef4444",
};

export const STATUS_LABEL: Record<Status, string> = {
  nominal: "Nominal",
  watch: "Watch",
  critical: "Critical",
};

export const STATUS_ICON: Record<Status, string> = {
  nominal: "●",
  watch: "▲",
  critical: "◆",
};

export const CONCRETE = "#a8a29e";
