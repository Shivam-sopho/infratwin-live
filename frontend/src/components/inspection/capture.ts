type Box = [number, number, number, number];

/**
 * Crop a padded thumbnail of `box` (given in a ref frame of refW×refH, e.g. the backend's
 * downscaled frame) out of an image or video element at its native resolution.
 */
export function cropThumbnail(src: HTMLImageElement | HTMLVideoElement, box: Box, refW: number, refH: number, maxPx = 160): string {
  const srcW = src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth;
  const srcH = src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight;
  const sx = srcW / refW;
  const sy = srcH / refH;
  const [bx1, by1, bx2, by2] = box;
  const pad = 0.25 * Math.max(bx2 - bx1, by2 - by1);
  const x1 = Math.max(0, (bx1 - pad) * sx);
  const y1 = Math.max(0, (by1 - pad) * sy);
  const x2 = Math.min(srcW, (bx2 + pad) * sx);
  const y2 = Math.min(srcH, (by2 + pad) * sy);
  const w = Math.max(1, x2 - x1);
  const h = Math.max(1, y2 - y1);
  const scale = Math.min(1, maxPx / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d")!.drawImage(src, x1, y1, w, h, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

export function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - t) < 1e-3 && video.readyState >= 2) return resolve();
    video.addEventListener("seeked", () => resolve(), { once: true });
    video.currentTime = t;
  });
}

export const toUV = ([x1, y1, x2, y2]: Box, W: number, H: number): Box => {
  const c = (v: number) => Math.min(1, Math.max(0, v));
  const [u1, v1] = [Math.min(c(x1 / W), 0.999), Math.min(c(y1 / H), 0.999)];
  return [u1, v1, Math.max(c(x2 / W), u1 + 0.001), Math.max(c(y2 / H), v1 + 0.001)];
};
