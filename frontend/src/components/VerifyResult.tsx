import { useState } from "react";
import { api } from "../api";
import type { Finding, Verification } from "../types";

const ROWS: { key: string; label: string; unit: string; digits: number }[] = [
  { key: "area_m2", label: "Area", unit: "m²", digits: 4 },
  { key: "perimeter_m", label: "Perimeter", unit: "m", digits: 2 },
  { key: "length_m", label: "Length", unit: "m", digits: 2 },
  { key: "max_width_mm", label: "Max width", unit: "mm", digits: 1 },
];

/** "Verify" action: Muse Spark Open re-measures the defect with its own code in a Modal Sandbox. */
export function VerifyAction({ f }: { f: Finding }) {
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState<Verification | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!f.metrology?.scale_mm_per_px || !f.mask_png) return null;

  const run = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    setError(null);
    try {
      setV(await api.verify(f.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1" onClick={(e) => e.stopPropagation()}>
      {!v && (
        <button className="text-[11px] text-accent hover:underline disabled:opacity-50" disabled={busy} onClick={run}>
          {busy ? "Spark Open measuring in sandbox…" : "Verify with Spark Open"}
        </button>
      )}
      {error && <p className="text-[11px] text-ink-3">{error}</p>}
      {v && (
        <div className="mt-1 rounded border border-line bg-bg/60 p-2 text-[11px]">
          <div className="mb-1 flex justify-between text-ink-3">
            <span>Independent check · {v.model}</span>
            <span>{v.agreement?.replace("_", " ") ?? v.status}</span>
          </div>
          {v.independent && (
            <table className="w-full tabular-nums">
              <thead className="text-ink-3">
                <tr>
                  <th className="text-left font-normal" />
                  <th className="text-right font-normal">Twin</th>
                  <th className="text-right font-normal">Spark Open</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.filter((r) => v.ours[r.key] != null || v.independent?.[r.key] != null).map((r) => (
                  <tr key={r.key}>
                    <td className="text-ink-2">{r.label}</td>
                    <td className="text-right text-ink">{v.ours[r.key]?.toFixed(r.digits) ?? "—"} {r.unit}</td>
                    <td className="text-right text-ink">{v.independent?.[r.key]?.toFixed(r.digits) ?? "—"} {r.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {v.summary && <p className="mt-1 text-ink">{v.summary}</p>}
          {v.error && <p className="mt-1 text-ink-2">Failed: {v.error}</p>}
          {v.commentary.length > 0 && (
            <details className="mt-1 text-ink-3">
              <summary className="cursor-pointer">Commentary ({v.commentary.length})</summary>
              {v.commentary.map((c, i) => (
                <p key={i} className="mt-1 italic">
                  {c}
                </p>
              ))}
            </details>
          )}
          {v.runs.map((r, i) => (
            <details key={i} className="mt-1 text-ink-3">
              <summary className="cursor-pointer">
                Sandbox run {i + 1} · exit {r.result.exit_code} · {r.result.ms} ms
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-1.5 font-mono text-[10px] text-ink-2">{r.code}</pre>
              {(r.result.stdout || r.result.stderr) && (
                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-ink-3">{r.result.stdout || r.result.stderr}</pre>
              )}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
