import type { Asset } from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  assets: () => fetch("/api/assets").then(json<Asset[]>),
  health: () => fetch("/api/health").then(json<{ ok: boolean; meta_api_configured: boolean }>),
  injectAnomaly: (component_id: string) =>
    fetch("/api/sim/anomaly", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ component_id }),
    }).then(json),
  resetSim: () => fetch("/api/sim/reset", { method: "POST" }).then(json),
};
