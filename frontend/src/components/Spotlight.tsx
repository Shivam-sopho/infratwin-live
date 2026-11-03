import { useEffect, useState } from "react";
import { useTwin } from "../store";

/** Dims everything except the [data-spot] regions the demo is talking about, following layout animations. */
export function Spotlight() {
  const spot = useTwin((s) => s.stage.spot);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useEffect(() => {
    if (spot.length === 0) {
      setRect(null);
      return;
    }
    let raf = 0;
    const measure = () => {
      const rects = spot
        .flatMap((name) => [...document.querySelectorAll(`[data-spot="${name}"]`)])
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0);
      if (rects.length) {
        const left = Math.min(...rects.map((r) => r.left));
        const top = Math.min(...rects.map((r) => r.top));
        const right = Math.max(...rects.map((r) => r.right));
        // never run under the caption bar (the bottom 124px while presenting)
        const bottom = Math.min(Math.max(...rects.map((r) => r.bottom)), window.innerHeight - 124);
        const pad = 4;
        setRect((p) => {
          const n = { left: left + pad, top: top + pad, width: right - left - 2 * pad, height: bottom - top - 2 * pad };
          return p && Math.abs(p.left - n.left) + Math.abs(p.top - n.top) + Math.abs(p.width - n.width) + Math.abs(p.height - n.height) < 1 ? p : n;
        });
      }
      raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [spot]);

  if (!rect) return null;
  return <div className="spotlight" style={rect} aria-hidden />;
}
