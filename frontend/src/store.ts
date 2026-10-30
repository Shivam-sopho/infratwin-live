import { create } from "zustand";
import type { Alert, Asset, Component, Sensor, ServerMessage, StatusSnapshot } from "./types";

const HISTORY_LEN = 240;
const EMPTY_STATUS: StatusSnapshot = { sensors: {}, components: {}, assets: {} };

interface TwinState {
  assets: Asset[];
  components: Record<string, Component>;
  sensors: Record<string, Sensor>;
  status: StatusSnapshot;
  history: Record<string, number[]>;
  alerts: Alert[];
  connected: boolean;
  selectedAssetId: string | null;
  selectedComponentId: string | null;

  setAssets: (assets: Asset[]) => void;
  setConnected: (c: boolean) => void;
  ingest: (msg: ServerMessage) => void;
  selectAsset: (id: string | null) => void;
  selectComponent: (id: string | null) => void;
}

export const useTwin = create<TwinState>((set, get) => ({
  assets: [],
  components: {},
  sensors: {},
  status: EMPTY_STATUS,
  history: {},
  alerts: [],
  connected: false,
  selectedAssetId: null,
  selectedComponentId: null,

  setAssets: (assets) =>
    set({
      assets,
      components: Object.fromEntries(assets.flatMap((a) => a.components.map((c) => [c.id, c]))),
      sensors: Object.fromEntries(assets.flatMap((a) => a.sensors.map((s) => [s.id, s]))),
    }),

  setConnected: (connected) => set({ connected }),

  ingest: (msg) => {
    switch (msg.type) {
      case "snapshot": {
        const history: Record<string, number[]> = {};
        for (const { readings } of msg.history) {
          for (const [id, v] of Object.entries(readings)) (history[id] ??= []).push(v);
        }
        set({ history, alerts: [...msg.alerts].reverse(), status: msg.status });
        break;
      }
      case "tick": {
        const prev = get().history;
        const history: Record<string, number[]> = {};
        for (const [id, v] of Object.entries(msg.readings)) {
          const arr = prev[id] ?? [];
          history[id] = arr.length >= HISTORY_LEN ? [...arr.slice(1), v] : [...arr, v];
        }
        set({ history, status: msg.status });
        break;
      }
      case "alert":
        set({ alerts: [msg.alert, ...get().alerts].slice(0, 100) });
        break;
    }
  },

  selectAsset: (id) => set({ selectedAssetId: id, selectedComponentId: null }),

  selectComponent: (id) => {
    const comp = id ? get().components[id] : undefined;
    set(comp ? { selectedComponentId: id, selectedAssetId: comp.asset_id } : { selectedComponentId: null });
  },
}));
