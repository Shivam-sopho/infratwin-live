import { CATEGORY_COLOR } from "../../theme";
import type { Detection } from "../../types";

export const detLabel = (d: { id: string; concept: string }) => `${d.concept} #${d.id.split("-").at(-1)}`;

/** One segmentation result drawn in frame pixel space (parent <svg> viewBox = frame size). */
export function Overlay({
  d,
  W,
  active,
  onHover,
}: {
  d: Detection;
  W: number;
  active: boolean;
  onHover?: (id: string | null) => void;
}) {
  const [x1, y1, x2, y2] = d.mask?.bounds ?? d.box;
  const color = CATEGORY_COLOR[d.category];
  const font = W / 48; // ~13px on screen at typical pane widths, whatever the frame resolution
  const stroke = Math.max(1, W / 800) * (active ? 2 : 1);
  const showLabel = active || d.category === "defect";
  const maskId = `m-${d.id}`;
  const label = `${detLabel(d)}${d.severity ? ` · ${d.severity}` : d.confidence != null ? ` · ${d.confidence.toFixed(2)}` : ""}`;
  if (d.polyline && d.polyline.length >= 2) {
    // Linear defect (crack, exposed rebar): the inspector-traced centre line, not a mask.
    const [px, py] = d.polyline[0];
    return (
      <g onMouseEnter={() => onHover?.(d.id)} onMouseLeave={() => onHover?.(null)} className={onHover ? "cursor-pointer" : undefined}>
        <polyline points={d.polyline.map((p) => p.join(",")).join(" ")} fill="none" stroke="#0b0f14" strokeOpacity={0.6} strokeWidth={stroke * 5} strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={d.polyline.map((p) => p.join(",")).join(" ")} fill="none" stroke={color} strokeWidth={stroke * (active ? 4 : 3)} strokeLinecap="round" strokeLinejoin="round" />
        {d.polyline.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={stroke * 3} fill={color} />
        ))}
        {showLabel && (
          <g transform={`translate(${px} ${Math.max(py - font * 1.6, 0)})`}>
            <rect width={label.length * font * 0.58 + font * 0.6} height={font * 1.4} fill={color} rx={font * 0.2} />
            <text x={font * 0.3} y={font * 1.02} fontSize={font} fill="#fff" fontWeight={500}>
              {label}
            </text>
          </g>
        )}
      </g>
    );
  }
  return (
    <g onMouseEnter={() => onHover?.(d.id)} onMouseLeave={() => onHover?.(null)} className={onHover ? "cursor-pointer" : undefined}>
      {d.mask && (
        <>
          <mask id={maskId} maskUnits="userSpaceOnUse">
            <image href={d.mask.png} x={x1} y={y1} width={x2 - x1} height={y2 - y1} preserveAspectRatio="none" />
          </mask>
          <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} fill={color} opacity={active ? 0.65 : 0.4} mask={`url(#${maskId})`} />
        </>
      )}
      <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} fill="transparent" stroke={color} strokeWidth={stroke} />
      {showLabel && (
        <g transform={`translate(${x1} ${Math.max(y1 - font * 1.4, 0)})`}>
          <rect width={label.length * font * 0.58 + font * 0.6} height={font * 1.4} fill={color} rx={font * 0.2} />
          <text x={font * 0.3} y={font * 1.02} fontSize={font} fill="#fff" fontWeight={500}>
            {label}
          </text>
        </g>
      )}
    </g>
  );
}
