import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useTwin } from "../store";
import { CATEGORY_COLOR } from "../theme";
import { STATUS_COLOR, STATUS_ICON } from "../theme";
import type { Concept, ConceptCategory, Detection, FindingIn, Metrology, SampleItem, SegmentationReport, VideoReport, WorkZoneReport } from "../types";
import { gtBoxesPx, scoreAgainstGroundTruth } from "./inspection/groundTruth";
import { alignMaskToCrop, cropWithRect, seek, toUV } from "./inspection/capture";
import { metrologySummary, metrologyTooltip } from "./inspection/metrology";
import { Overlay, detLabel } from "./inspection/Overlay";

const COST_PER_IMAGE = 0.0025;
const COST_PER_FRAME = 0.0002;
const VIDEO_FPS = 5;
const VIDEO_MAX_S = 20;
const MIN_BILLED_FRAMES = 50;
const PIN_CROP_PX = 512; // large enough for Muse Image time-travel edits

type Run = { kind: "image"; report: SegmentationReport } | { kind: "video"; report: VideoReport };

/** A defect as listed in the results table and pinned to the twin (image detection or video track). */
interface DefectRow {
  id: string;
  concept: string;
  confidence: number | null;
  area_px: number;
  box: [number, number, number, number];
  hostId: string | null;
  hostOverlap: number | null;
  frames: number | null;
  bestFrame: number | null;
  metrology: Metrology | null;
  maskPng: string | null;
  maskBounds: [number, number, number, number] | null;
}

function defectRows(run: Run): DefectRow[] {
  if (run.kind === "image") {
    return run.report.detections
      .filter((d) => d.category === "defect")
      .map((d) => ({
        id: d.id,
        concept: d.concept,
        confidence: d.confidence,
        area_px: d.area_px,
        box: d.box,
        hostId: d.host_id,
        hostOverlap: d.host_overlap,
        frames: null,
        bestFrame: null,
        metrology: d.metrology ?? null,
        maskPng: d.mask?.png ?? null,
        maskBounds: d.mask?.bounds ?? null,
      }));
  }
  return run.report.tracks
    .filter((t) => t.category === "defect")
    .map((t) => {
      const best = t.frames.find((f) => f.f === t.best_frame) ?? t.frames[0];
      return {
        id: t.id,
        concept: t.concept,
        confidence: t.confidence,
        area_px: best.area_px,
        box: best.box,
        hostId: t.host_id,
        hostOverlap: t.host_overlap,
        frames: t.frames.length,
        bestFrame: t.best_frame,
        metrology: t.metrology,
        maskPng: best.mask?.png ?? null,
        maskBounds: best.mask?.bounds ?? null,
      };
    });
}

/** Detections visible at video frame `f` (tracks may skip frames where the object is absent). */
function detectionsAtFrame(report: VideoReport, f: number): Detection[] {
  const out: Detection[] = [];
  for (const t of report.tracks) {
    const tf = t.frames.find((x) => x.f === f);
    if (tf) {
      out.push({ id: t.id, concept: t.concept, category: t.category, box: tf.box, confidence: tf.confidence, area_px: tf.area_px, mask: tf.mask, host_id: t.host_id, host_overlap: t.host_overlap });
    }
  }
  return out;
}

export function InspectionPanel() {
  const assets = useTwin((s) => s.assets);
  const components = useTwin((s) => s.components);
  const selectedComponentId = useTwin((s) => s.selectedComponentId);
  const selectComponent = useTwin((s) => s.selectComponent);
  const setCenterTab = useTwin((s) => s.setCenterTab);

  const [vocab, setVocab] = useState<(Concept & { on: boolean })[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [frame, setFrame] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ count: number; componentId: string } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [show, setShow] = useState<Record<ConceptCategory, boolean>>({ structural: true, defect: true });
  const [target, setTarget] = useState<string>("");
  const [pinSel, setPinSel] = useState<Set<string>>(new Set());
  const [zone, setZone] = useState<WorkZoneReport | null>(null);
  const [samples, setSamples] = useState<SampleItem[]>([]);
  const [sample, setSample] = useState<SampleItem | null>(null);
  const [showGt, setShowGt] = useState(true);
  const [radius, setRadius] = useState(3);
  const input = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const isVideo = !!file?.type.startsWith("video/");

  useEffect(() => {
    api.vocabulary().then((v) => setVocab(v.map((c) => ({ ...c, on: true }))), (e) => setError(String(e)));
    api.samples().then((r) => setSamples(r.items), () => undefined);
  }, []);

  useEffect(() => {
    if (selectedComponentId) setTarget(selectedComponentId);
  }, [selectedComponentId]);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (!file.type.startsWith("video/")) {
      const img = new Image();
      img.onload = () => setNatural({ w: img.naturalWidth, h: img.naturalHeight });
      img.src = url;
      imgRef.current = img;
    }
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Keep the overlay in step with playback.
  useEffect(() => {
    if (run?.kind !== "video") return;
    const { fps, n_frames } = run.report;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) setFrame(Math.min(n_frames - 1, Math.max(0, Math.floor(v.currentTime * fps + 1e-3))));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run]);

  const selected = vocab.filter((c) => c.on);
  const rows = useMemo(() => (run ? defectRows(run) : []), [run]);
  const labelOf = useMemo(() => {
    const items = !run ? [] : run.kind === "image" ? run.report.detections : run.report.tracks;
    return Object.fromEntries(items.map((d) => [d.id, detLabel(d)]));
  }, [run]);
  const visible: Detection[] = !run ? [] : run.kind === "image" ? run.report.detections : detectionsAtFrame(run.report, frame);
  const failed = run?.report.concepts.filter((c) => c.error) ?? [];
  const W = run?.report.width ?? natural?.w ?? 1;
  const H = run?.report.height ?? natural?.h ?? 1;

  const estFrames = Math.max(MIN_BILLED_FRAMES, Math.ceil(Math.min(duration ?? VIDEO_MAX_S, VIDEO_MAX_S) * VIDEO_FPS));
  const estCost = isVideo ? selected.length * estFrames * COST_PER_FRAME : selected.length * COST_PER_IMAGE;

  const loadSample = async (name: string) => {
    const it = samples.find((x) => x.name === name);
    if (!it) return;
    const blob = await fetch(it.url).then((r) => r.blob());
    load(new File([blob], it.name, { type: "image/jpeg" }), it);
  };

  const load = (f: File | undefined, fromSample: SampleItem | null = null) => {
    if (!f) return;
    setSample(fromSample);
    setFile(f);
    setNatural(null);
    setDuration(null);
    setRun(null);
    setZone(null);
    setFrame(0);
    setError(null);
    setNotice(null);
  };

  const segment = async () => {
    if (!file || selected.length === 0) return;
    setBusy(isVideo ? "Transcoding + tracking…" : "Segmenting…");
    setError(null);
    setNotice(null);
    const concepts = selected.map(({ text, category }) => ({ text, category }));
    try {
      const next: Run = isVideo
        ? { kind: "video", report: await api.segmentVideo(file, concepts, target || undefined) }
        : { kind: "image", report: await api.segment(file, concepts, target || undefined) };
      setRun(next);
      setPinSel(new Set(defectRows(next).map((r) => r.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const pin = async () => {
    if (!run || !file || !target) return;
    const chosen = rows.filter((r) => pinSel.has(r.id));
    if (chosen.length === 0) return;
    setBusy("Pinning…");
    setError(null);
    try {
      const items: FindingIn[] = [];
      const video = videoRef.current;
      const resumeAt = video?.currentTime ?? 0;
      for (const r of chosen) {
        if (run.kind === "video" && video) await seek(video, (r.bestFrame ?? 0) / run.report.fps + 0.01);
        const crop = cropWithRect(run.kind === "video" && video ? video : imgRef.current!, r.box, W, H, PIN_CROP_PX);
        const thumbnail = crop.url;
        const thumbnailMask = r.maskPng && r.maskBounds ? await alignMaskToCrop(r.maskPng, r.maskBounds, crop.rect) : null;
        items.push({
          component_id: target,
          concept: r.concept,
          confidence: r.confidence,
          area_px: r.area_px,
          source: run.kind,
          source_name: file.name.slice(0, 200),
          bbox_uv: toUV(r.box, W, H),
          host_label: r.hostId ? (labelOf[r.hostId] ?? null) : null,
          frames_tracked: r.frames,
          metrology: r.metrology,
          mask_png: r.maskPng,
          thumbnail_mask_png: thumbnailMask,
          thumbnail,
        });
      }
      if (video) await seek(video, resumeAt);
      await api.addFindings(items);
      setNotice({ count: items.length, componentId: target });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const targetSelect = (
    <select
      id="pin-target"
      value={target}
      onChange={(e) => setTarget(e.target.value)}
      className="rounded-md border border-line bg-bg px-2 py-1 text-xs text-ink"
      title="Where this media was captured. Sets the metric scale and where findings are pinned."
    >
      <option value="">Captured at…</option>
      {assets.map((a) => (
        <optgroup key={a.id} label={a.name}>
          {a.components
            .filter((c) => c.geometry)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
  const measured = rows.some((r) => r.metrology);
  const scaleNote = rows.find((r) => r.metrology)?.metrology;

  const checkWorkZone = async () => {
    if (!file || run?.kind !== "image") return;
    const d = rows.find((r) => pinSel.has(r.id) && r.maskPng && r.maskBounds) ?? rows.find((r) => r.maskPng && r.maskBounds);
    if (!d) return;
    setBusy("Locating workers…");
    setError(null);
    try {
      setZone(await api.workzone(file, d.maskBounds!, d.maskPng!, radius));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const viewInTwin = (componentId: string) => {
    selectComponent(componentId);
    setCenterTab("twin");
  };

  return (
    <div className="flex h-full flex-col">
      {/* Controls */}
      <div className="flex flex-col gap-2 border-b border-line p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input ref={input} type="file" accept="image/*,video/*" hidden onChange={(e) => load(e.target.files?.[0])} />
          <button onClick={() => input.current?.click()} className="rounded-md border border-line px-2.5 py-1 text-xs text-ink hover:border-ink-3">
            {file ? "Change media" : "Load photo or video"}
          </button>
          {samples.length > 0 && (
            <select
              value={sample?.name ?? ""}
              onChange={(e) => void loadSample(e.target.value)}
              className="max-w-44 rounded-md border border-line bg-bg px-2 py-1 text-xs text-ink"
              title="Real bridge-inspection images from dacl10k, with expert labels for scoring"
            >
              <option value="">Real sample (dacl10k)…</option>
              {[...new Set(samples.map((x) => x.theme))].map((t) => (
                <optgroup key={t} label={t.replace("_", " + ")}>
                  {samples
                    .filter((x) => x.theme === t)
                    .map((x) => (
                      <option key={x.name} value={x.name}>
                        {x.labels.join(", ")}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          )}
          {targetSelect}
          <button
            onClick={segment}
            disabled={!file || !!busy || selected.length === 0}
            className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-bg disabled:opacity-40"
          >
            {busy && busy !== "Pinning…"
              ? busy
              : `${isVideo ? "Track" : "Run"} SAM 3.1 · ${selected.length} concepts · ~$${estCost.toFixed(3)}`}
          </button>
          {file && (
            <span className="truncate text-xs text-ink-3">
              {file.name}
              {isVideo && duration != null && ` · ${duration.toFixed(1)}s${duration > VIDEO_MAX_S ? ` (first ${VIDEO_MAX_S}s at ${VIDEO_FPS} fps)` : ` at ${VIDEO_FPS} fps`}`}
            </span>
          )}
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

      {/* Media + overlays */}
      <div
        className="relative min-h-0 flex-1 overflow-hidden bg-black/30"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          load(e.dataTransfer.files[0]);
        }}
      >
        {preview && isVideo && (
          <video
            ref={videoRef}
            src={preview}
            controls
            muted
            playsInline
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            className="absolute inset-4 h-[calc(100%-2rem)] w-[calc(100%-2rem)] object-contain"
          />
        )}
        {preview && (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="xMidYMid meet"
            className={`absolute inset-4 h-[calc(100%-2rem)] w-[calc(100%-2rem)] ${isVideo ? "pointer-events-none" : ""}`}
          >
            {!isVideo && <image href={preview} width={W} height={H} />}
            {visible
              .filter((d) => show[d.category])
              .sort((a, b) => (a.category === b.category ? b.area_px - a.area_px : a.category === "structural" ? -1 : 1))
              .map((d) => (
                <Overlay key={d.id} d={d} W={W} active={hovered === d.id || hovered === d.host_id} onHover={isVideo ? undefined : setHovered} />
              ))}
            {sample && showGt && !isVideo &&
              gtBoxesPx(sample, W, H).map((g, k) => (
                <g key={`gt${k}`} pointerEvents="none">
                  <rect x={g.box[0]} y={g.box[1]} width={g.box[2] - g.box[0]} height={g.box[3] - g.box[1]} fill="none" stroke="#e5e7eb" strokeWidth={Math.max(1, W / 600)} strokeDasharray={`${W / 120} ${W / 200}`} />
                  <text x={g.box[0] + 3} y={g.box[3] - 4} fontSize={W / 60} fill="#e5e7eb" stroke="#0b0f14" strokeWidth={W / 900} paintOrder="stroke">
                    GT {g.label}
                  </text>
                </g>
              ))}
            {zone?.workers
              .filter((w) => w.bbox && w.bbox.length >= 4)
              .map((w) => {
                const [x1, y1, x2, y2] = w.bbox!;
                const st = w.verdict === "inside_exclusion" ? "critical" : w.verdict === "clear" ? "nominal" : "watch";
                const font = W / 48;
                const label = `${STATUS_ICON[st]} Worker ${w.index + 1}${w.horizontal_distance_m != null ? ` · ${w.horizontal_distance_m} m` : ""}`;
                return (
                  <g key={w.index}>
                    <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} fill="none" stroke={STATUS_COLOR[st]} strokeWidth={Math.max(2, W / 400)} />
                    <rect x={x1} y={Math.max(0, y1 - font * 1.4)} width={label.length * font * 0.58 + font * 0.6} height={font * 1.4} fill={STATUS_COLOR[st]} rx={font * 0.2} />
                    <text x={x1 + font * 0.3} y={Math.max(0, y1 - font * 1.4) + font * 1.02} fontSize={font} fill="#0b0f14" fontWeight={600}>
                      {label}
                    </text>
                  </g>
                );
              })}
          </svg>
        )}
        {!preview && (
          <div className="absolute inset-0 grid place-content-center text-center text-sm text-ink-3">
            Drop a bridge or tunnel inspection photo or video here
            <div className="mt-1 text-xs">SAM 3.1 segments and tracks structural elements and surface defects in a single pass</div>
          </div>
        )}
        {run?.kind === "video" && (
          <span className="absolute right-6 top-6 rounded bg-bg/80 px-1.5 py-0.5 text-[11px] tabular-nums text-ink-2">
            frame {frame + 1}/{run.report.n_frames}
          </span>
        )}
        {error && <div className="absolute inset-x-3 bottom-3 rounded-md border border-critical/50 bg-bg/90 px-3 py-2 text-xs text-ink">{error}</div>}
      </div>

      {/* Results + pinning */}
      {run && (
        <div className="max-h-[42%] shrink-0 overflow-y-auto border-t border-line p-3 text-xs">
          <div className="mb-2 flex flex-wrap items-center gap-3 text-ink-2">
            {(["structural", "defect"] as const).map((cat) => {
              const n = run.kind === "image" ? run.report.detections.filter((d) => d.category === cat).length : run.report.tracks.filter((t) => t.category === cat).length;
              return (
                <label key={cat} className="flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" checked={show[cat]} onChange={() => setShow((s) => ({ ...s, [cat]: !s[cat] }))} />
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORY_COLOR[cat] }} />
                  {cat === "structural" ? "Elements" : "Defects"} ({n})
                </label>
              );
            })}
            <span className="ml-auto tabular-nums text-ink-3">
              {run.report.width}×{run.report.height}px{run.kind === "video" && ` · ${run.report.n_frames} frames`} · est. ${run.report.est_cost_usd.toFixed(4)}
            </span>
          </div>
          {failed.length > 0 && (
            <div className="mb-2 rounded border border-critical/40 px-2 py-1 text-ink-2">
              {failed.length} concept{failed.length > 1 ? "s" : ""} failed: {failed.map((c) => `${c.text} (${c.error})`).join("; ")}
            </div>
          )}
          {rows.length === 0 ? (
            <p className="text-ink-3">No defects found for the selected concepts.</p>
          ) : (
            <>
              <table className="w-full">
                <thead className="text-left text-[11px] uppercase tracking-wider text-ink-3">
                  <tr>
                    <th className="w-5 pb-1" />
                    <th className="pb-1 font-normal">Defect</th>
                    <th className="pb-1 font-normal">On element</th>
                    {run.kind === "video" && <th className="pb-1 text-right font-normal">Frames</th>}
                    <th className="pb-1 text-right font-normal">Conf.</th>
                    {measured ? <th className="pb-1 text-right font-normal">Measured</th> : <th className="pb-1 text-right font-normal">Area px</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className={`border-t border-line/60 ${hovered === r.id ? "bg-white/[0.04]" : ""} ${run.kind === "video" ? "cursor-pointer" : ""}`}
                      onMouseEnter={() => setHovered(r.id)}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => {
                        if (run.kind === "video" && videoRef.current && r.bestFrame != null) {
                          videoRef.current.pause();
                          void seek(videoRef.current, r.bestFrame / run.report.fps + 0.01);
                        }
                      }}
                    >
                      <td className="py-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Pin ${labelOf[r.id]}`}
                          checked={pinSel.has(r.id)}
                          onChange={() =>
                            setPinSel((s) => {
                              const n = new Set(s);
                              if (n.has(r.id)) n.delete(r.id);
                              else n.add(r.id);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td className="py-1 text-ink">{labelOf[r.id]}</td>
                      <td className="py-1 text-ink-2">
                        {r.hostId ? `${labelOf[r.hostId] ?? r.hostId} · ${Math.round((r.hostOverlap ?? 0) * 100)}%` : <span className="text-ink-3">unattributed</span>}
                      </td>
                      {run.kind === "video" && <td className="py-1 text-right tabular-nums text-ink-2">{r.frames}</td>}
                      <td className="py-1 text-right tabular-nums text-ink-2">{r.confidence?.toFixed(2) ?? "—"}</td>
                      {measured ? (
                        <td className="py-1 text-right tabular-nums text-ink" title={r.metrology ? metrologyTooltip(r.metrology) : "No scale: defect not on a measurable host element"}>
                          {r.metrology ? (
                            <>
                              {r.metrology.warnings.length > 0 && (
                                <span className="mr-1 text-watch" aria-label="measurement warning">
                                  ⚠
                                </span>
                              )}
                              {metrologySummary(r.metrology)}
                            </>
                          ) : (
                            <span className="text-ink-3">—</span>
                          )}
                        </td>
                      ) : (
                        <td className="py-1 text-right tabular-nums text-ink-2">{r.area_px.toLocaleString()}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>

              {sample && run.kind === "image" && (
                <div className="mt-2 rounded border border-line px-2 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-ink">Zero-shot check against dacl10k expert labels</span>
                    <label className="flex items-center gap-1 text-ink-3">
                      <input type="checkbox" checked={showGt} onChange={() => setShowGt((v) => !v)} /> show GT boxes
                    </label>
                  </div>
                  <table className="mt-1 w-full tabular-nums">
                    <tbody>
                      {scoreAgainstGroundTruth(sample, run.report.detections, W, H).map((c) => (
                        <tr key={c.label} className="border-t border-line/60">
                          <td className="py-0.5 text-ink-2">{c.label}</td>
                          <td className="py-0.5 text-ink-3">{c.concept ?? "not in vocabulary"}</td>
                          <td className="py-0.5 text-right text-ink">{c.concept ? `${c.found}/${c.gt} found` : `${c.gt} labelled`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-1 text-[11px] text-ink-3">
                    Image and labels: dacl10k (Flotzinger et al., WACV 2024). A labelled instance counts as found when a detection of the matching concept overlaps ≥30% of the smaller box.
                  </p>
                </div>
              )}
              {zone && (
                <div className={`mt-2 rounded border px-2 py-1.5 ${zone.any_violation ? "border-critical/60" : "border-line"}`}>
                  <div className="text-ink">
                    <span style={{ color: STATUS_COLOR[zone.any_violation ? "critical" : "nominal"] }}>{STATUS_ICON[zone.any_violation ? "critical" : "nominal"]}</span>{" "}
                    {zone.workers.length === 0
                      ? "No people detected in the frame."
                      : zone.any_violation
                        ? `Worker inside the ${zone.radius_m} m drop zone below the defect`
                        : `All ${zone.workers.length} detected people outside the ${zone.radius_m} m drop zone`}
                  </div>
                  <ul className="mt-1 text-ink-2">
                    {zone.workers.map((w) => (
                      <li key={w.index}>
                        Worker {w.index + 1}: {w.verdict.replace("_", " ")}
                        {w.horizontal_distance_m != null && ` · ${w.horizontal_distance_m} m horizontal`}
                        {w.below_defect != null && (w.below_defect ? " · below defect" : " · above defect")}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[11px] text-ink-3">{zone.note} SAM 3D Body + SAM 3D Objects.</p>
                </div>
              )}
              <p className="mt-2 text-[11px] text-ink-3">
                {scaleNote
                  ? `Scale from ${scaleNote.scale_note} (${scaleNote.scale_mm_per_px} mm/px). Assumes a square-on view; inclination and depth need SAM 3D.`
                  : target
                    ? "No metric scale: no defect sits on a segmented element with known dimensions."
                    : "Choose where this was captured (above) before running to get metric measurements."}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <button
                  onClick={pin}
                  disabled={!target || pinSel.size === 0 || !!busy}
                  title={target ? undefined : "Choose where this was captured first"}
                  className="rounded-md border border-defect px-2.5 py-1 text-xs text-ink hover:bg-defect/15 disabled:opacity-40"
                >
                  {busy === "Pinning…"
                    ? "Pinning…"
                    : `Pin ${pinSel.size} defect${pinSel.size === 1 ? "" : "s"} to ${target ? (components[target]?.name ?? "twin") : "twin"}`}
                </button>
                {run.kind === "image" && rows.some((r) => r.maskPng) && (
                  <span className="flex items-center gap-1">
                    <button
                      onClick={checkWorkZone}
                      disabled={!!busy}
                      className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-40"
                      title="SAM 3D Body + SAM 3D Objects: are people within the drop zone of the selected defect?"
                    >
                      {busy === "Locating workers…" ? "Locating workers…" : "Work-zone check"}
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      step={0.5}
                      value={radius}
                      onChange={(e) => setRadius(Number(e.target.value))}
                      className="w-14 rounded-md border border-line bg-bg px-1.5 py-1 text-xs text-ink"
                      aria-label="Exclusion radius in metres"
                    />
                    <span className="text-ink-3">m</span>
                  </span>
                )}
                {notice && (
                  <span className="text-ink-2">
                    Pinned {notice.count} to {components[notice.componentId]?.name}.{" "}
                    <button className="text-accent underline-offset-2 hover:underline" onClick={() => viewInTwin(notice.componentId)}>
                      View in twin
                    </button>
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
