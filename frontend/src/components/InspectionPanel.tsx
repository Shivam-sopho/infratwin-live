import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { CATEGORY_COLOR } from "../theme";
import type { Concept, ConceptCategory, Detection, SegmentationReport } from "../types";

const COST_PER_CONCEPT = 0.0025;

const detLabel = (d: Detection) => `${d.concept} #${d.id.split("-").at(-1)}`;

function Overlay({ d, W, active, onHover }: { d: Detection; W: number; active: boolean; onHover: (id: string | null) => void }) {
  const [x1, y1, x2, y2] = d.mask?.bounds ?? d.box;
  const color = CATEGORY_COLOR[d.category];
  const font = W / 48; // ~13px on screen at typical pane widths, whatever the frame resolution
  const stroke = Math.max(1, W / 800) * (active ? 2 : 1);
  const showLabel = active || d.category === "defect";
  const maskId = `m-${d.id}`;
  const label = `${detLabel(d)}${d.confidence != null ? ` · ${d.confidence.toFixed(2)}` : ""}`;
  return (
    <g onMouseEnter={() => onHover(d.id)} onMouseLeave={() => onHover(null)} className="cursor-pointer">
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

export function InspectionPanel() {
  const [vocab, setVocab] = useState<(Concept & { on: boolean })[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [report, setReport] = useState<SegmentationReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [show, setShow] = useState<Record<ConceptCategory, boolean>>({ structural: true, defect: true });
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.vocabulary().then((v) => setVocab(v.map((c) => ({ ...c, on: true }))), (e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const selected = vocab.filter((c) => c.on);
  const byId = useMemo(() => Object.fromEntries((report?.detections ?? []).map((d) => [d.id, d])), [report]);
  const defects = report?.detections.filter((d) => d.category === "defect") ?? [];
  const failed = report?.concepts.filter((c) => c.error) ?? [];

  const load = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setNatural(null);
    setReport(null);
    setError(null);
  };

  const run = async () => {
    if (!file || selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      setReport(await api.segment(file, selected.map(({ text, category }) => ({ text, category }))));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Controls */}
      <div className="flex flex-col gap-2 border-b border-line p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input ref={input} type="file" accept="image/*" hidden onChange={(e) => load(e.target.files?.[0])} />
          <button onClick={() => input.current?.click()} className="rounded-md border border-line px-2.5 py-1 text-xs text-ink hover:border-ink-3">
            {file ? "Change frame" : "Load inspection frame"}
          </button>
          <button
            onClick={run}
            disabled={!file || busy || selected.length === 0}
            className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-bg disabled:opacity-40"
          >
            {busy ? "Segmenting…" : `Run SAM 3.1 · ${selected.length} concepts · ~$${(selected.length * COST_PER_CONCEPT).toFixed(3)}`}
          </button>
          {file && <span className="truncate text-xs text-ink-3">{file.name}</span>}
        </div>
        {(["structural", "defect"] as const).map((cat) => (
          <div key={cat} className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 text-[11px] uppercase tracking-wider text-ink-3">{cat === "structural" ? "Elements" : "Defects"}</span>
            {vocab
              .filter((c) => c.category === cat)
              .map((c) => (
                <button
                  key={c.text}
                  onClick={() => setVocab((v) => v.map((x) => (x.text === c.text ? { ...x, on: !x.on } : x)))}
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${c.on ? "text-ink" : "border-line text-ink-3 line-through"}`}
                  style={c.on ? { borderColor: CATEGORY_COLOR[cat] } : undefined}
                >
                  {c.text}
                </button>
              ))}
          </div>
        ))}
      </div>

      {/* Frame + overlays */}
      <div
        className="relative min-h-0 flex-1 overflow-hidden bg-black/30"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          load(e.dataTransfer.files[0]);
        }}
      >
        {preview ? (
          (() => {
            // Report coords are in the backend's (possibly downscaled) frame; fall back to natural size before a run.
            const W = report?.width ?? natural?.w ?? 1;
            const H = report?.height ?? natural?.h ?? 1;
            return (
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-4 h-[calc(100%-2rem)] w-[calc(100%-2rem)]">
                <image href={preview} width={W} height={H} />
                {report &&
                  report.detections
                    .filter((d) => show[d.category])
                    .sort((a, b) => (a.category === b.category ? b.area_px - a.area_px : a.category === "structural" ? -1 : 1))
                    .map((d) => <Overlay key={d.id} d={d} W={W} active={hovered === d.id || hovered === d.host_id} onHover={setHovered} />)}
              </svg>
            );
          })()
        ) : (
          <div className="absolute inset-0 grid place-content-center text-center text-sm text-ink-3">
            Drop a bridge or tunnel inspection photo here
            <div className="mt-1 text-xs">SAM 3.1 segments structural elements and surface defects in a single pass</div>
          </div>
        )}
        {error && <div className="absolute inset-x-3 bottom-3 rounded-md border border-critical/50 bg-bg/90 px-3 py-2 text-xs text-ink">{error}</div>}
      </div>

      {/* Results */}
      {report && (
        <div className="max-h-[40%] shrink-0 overflow-y-auto border-t border-line p-3 text-xs">
          <div className="mb-2 flex flex-wrap items-center gap-3 text-ink-2">
            {(["structural", "defect"] as const).map((cat) => (
              <label key={cat} className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={show[cat]} onChange={() => setShow((s) => ({ ...s, [cat]: !s[cat] }))} />
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORY_COLOR[cat] }} />
                {cat === "structural" ? "Elements" : "Defects"} ({report.detections.filter((d) => d.category === cat).length})
              </label>
            ))}
            <span className="ml-auto tabular-nums text-ink-3">
              {report.width}×{report.height}px · est. ${report.est_cost_usd.toFixed(4)}
            </span>
          </div>
          {failed.length > 0 && (
            <div className="mb-2 rounded border border-critical/40 px-2 py-1 text-ink-2">
              {failed.length} concept{failed.length > 1 ? "s" : ""} failed: {failed.map((c) => `${c.text} (${c.error})`).join("; ")}
            </div>
          )}
          {defects.length === 0 ? (
            <p className="text-ink-3">No defects found for the selected concepts.</p>
          ) : (
            <table className="w-full">
              <thead className="text-left text-[11px] uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="pb-1 font-normal">Defect</th>
                  <th className="pb-1 font-normal">On element</th>
                  <th className="pb-1 text-right font-normal">Conf.</th>
                  <th className="pb-1 text-right font-normal">Area px</th>
                </tr>
              </thead>
              <tbody>
                {defects.map((d) => {
                  const host = d.host_id ? byId[d.host_id] : undefined;
                  return (
                    <tr key={d.id} className={`border-t border-line/60 ${hovered === d.id ? "bg-white/[0.04]" : ""}`} onMouseEnter={() => setHovered(d.id)} onMouseLeave={() => setHovered(null)}>
                      <td className="py-1 text-ink">{detLabel(d)}</td>
                      <td className="py-1 text-ink-2">
                        {host ? `${detLabel(host)} · ${Math.round((d.host_overlap ?? 0) * 100)}%` : <span className="text-ink-3">unattributed</span>}
                      </td>
                      <td className="py-1 text-right tabular-nums text-ink-2">{d.confidence?.toFixed(2) ?? "—"}</td>
                      <td className="py-1 text-right tabular-nums text-ink-2">{d.area_px.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
