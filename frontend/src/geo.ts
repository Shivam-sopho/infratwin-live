import type { Asset } from "./types";

const M_PER_DEG_LAT = 111_320;

/**
 * Asset-local metres -> [lng, lat]. The twin's +x axis runs along the asset's heading (bearing,
 * clockwise from north) and +z points 90° to its right; y (height) is ignored on the map.
 */
export function localToLngLat(asset: Asset, x: number, z: number): [number, number] {
  const h = (asset.heading_deg * Math.PI) / 180;
  const east = x * Math.sin(h) + z * Math.cos(h);
  const north = x * Math.cos(h) - z * Math.sin(h);
  return [
    asset.lng + east / (M_PER_DEG_LAT * Math.cos((asset.lat * Math.PI) / 180)),
    asset.lat + north / M_PER_DEG_LAT,
  ];
}
