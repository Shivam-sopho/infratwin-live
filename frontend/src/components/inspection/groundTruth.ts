import type { Detection, SampleItem } from "../../types";

/** dacl10k class → the SAM 3.1 concept that should find it (classes outside our vocabulary are skipped). */
export const DACL_TO_CONCEPT: Record<string, string> = {
  Crack: "concrete crack",
  ACrack: "alligator crack",
  Spalling: "concrete spalling",
  ExposedRebars: "exposed rebar",
  Efflorescence: "efflorescence",
  Rust: "rust stain",
  Wetspot: "wet spot",
};

export interface ClassScore {
  label: string;
  concept: string | null;
  gt: number;
  found: number;
}

type Box = [number, number, number, number];

const overlap = (a: Box, b: Box) => {
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = w * h;
  const area = (x: Box) => Math.max(1e-9, (x[2] - x[0]) * (x[3] - x[1]));
  // Cracks are long and thin: count a match when the boxes overlap substantially relative to the smaller one.
  return inter / Math.min(area(a), area(b));
};

export function gtBoxesPx(sample: SampleItem, W: number, H: number) {
  return sample.boxes.map((b) => {
    const [x, y, w, h] = b.bbox_xywh_norm;
    return { label: b.label, box: [x * W, y * H, (x + w) * W, (y + h) * H] as Box };
  });
}

/** Per-class: how many expert-labelled instances have a SAM 3.1 detection of the matching concept on them. */
export function scoreAgainstGroundTruth(sample: SampleItem, detections: Detection[], W: number, H: number): ClassScore[] {
  const byLabel = new Map<string, ClassScore>();
  for (const { label, box } of gtBoxesPx(sample, W, H)) {
    const concept = DACL_TO_CONCEPT[label] ?? null;
    const s = byLabel.get(label) ?? { label, concept, gt: 0, found: 0 };
    s.gt += 1;
    if (concept && detections.some((d) => d.concept === concept && overlap(d.box, box) >= 0.3)) s.found += 1;
    byLabel.set(label, s);
  }
  return [...byLabel.values()].sort((a, b) => Number(!!b.concept) - Number(!!a.concept) || b.gt - a.gt);
}
