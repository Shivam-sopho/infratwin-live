import type { Metrology } from "../../types";

const fix = (v: number, d: number) => v.toFixed(d);

/** Compact human summary, e.g. "0.042 m² · L 0.61 m · w ≤ 1.8 mm". */
export function metrologySummary(m: Metrology): string {
  const parts = [m.area_m2 < 0.01 ? `${fix(m.area_m2 * 1e4, 1)} cm²` : `${fix(m.area_m2, 3)} m²`];
  if (m.length_m != null) parts.push(`L ${fix(m.length_m, 2)} m`);
  if (m.max_width_mm != null) parts.push(`w ≤ ${fix(m.max_width_mm, 1)} mm`);
  if (m.inclination_deg != null) parts.push(`${fix(m.inclination_deg, 1)}° incl.`);
  return parts.join(" · ");
}

export function metrologyTooltip(m: Metrology): string {
  return [
    ...m.warnings.map((w) => `⚠ ${w}`),
    `Method: ${m.method}`,
    `Scale: ${m.scale_note}${m.scale_mm_per_px != null ? ` (${m.scale_mm_per_px} mm/px)` : ""}`,
    `Perimeter: ${fix(m.perimeter_m, 2)} m`,
    m.mean_width_mm != null ? `Mean width: ${fix(m.mean_width_mm, 1)} mm` : null,
    m.resolution_mm != null ? `Resolution: ±${fix(m.resolution_mm, 1)} mm (1 px)` : null,
    ...m.assumptions.map((a) => `Assumes: ${a}`),
  ]
    .filter(Boolean)
    .join("\n");
}
