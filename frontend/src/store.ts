import { create } from "zustand";
import type { Alert, Asset, Component, Finding, Sensor, ServerMessage, StatusSnapshot, Triage } from "./types";

const HISTORY_LEN = 240;
const EMPTY_STATUS: StatusSnapshot = { sensors: {}, components: {}, assets: {} };

interface TwinState {
  assets: Asset[];
  components: Record<string, Component>;
  sensors: Record<string, Sensor>;
  status: StatusSnapshot;
  history: Record<string, number[]>;
  alerts: Alert[];
  findings: Finding[];
  triages: Triage[];
  connected: boolean;
  selectedAssetId: string | null;
  selectedComponentId: string | null;
  selectedFindingId: string | null;
  centerTab: "twin" | "inspect";
  sideTab: "alerts" | "twin";

  setAssets: (assets: Asset[]) => void;
  setConnected: (c: boolean) => void;
  ingest: (msg: ServerMessage) => void;
  selectAsset: (id: string | null) => void;
  selectComponent: (id: string | null) => void;
  selectFinding: (id: string | null) => void;
  setCenterTab: (tab: "twin" | "inspect") => void;
  setSideTab: (tab: "alerts" | "twin") => void;
}

export const useTwin = create<TwinState>((set, get) => ({
  assets: [],
  components: {},
  sensors: {},
  status: EMPTY_STATUS,
  history: {},
  alerts: [],
  findings: [],
  triages: [],
  connected: false,
  selectedAssetId: null,
  selectedComponentId: null,
  selectedFindingId: null,
  centerTab: "twin",
  sideTab: "alerts",

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
        set({ history, alerts: [...msg.alerts].reverse(), status: msg.status, findings: msg.findings, triages: msg.triages });
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
      case "triage": {
        const prev = get().triages;
        const isNew = !prev.some((t) => t.id === msg.triage.id);
        set({
          triages: isNew ? [...prev, msg.triage].slice(-30) : prev.map((t) => (t.id === msg.triage.id ? msg.triage : t)),
          ...(isNew ? { sideTab: "twin" as const } : {}),
        });
        break;
      }
      case "triage_delta":
        set({ triages: get().triages.map((t) => (t.id === msg.id ? { ...t, reasoning: t.reasoning + msg.delta } : t)) });
        break;
      case "findings": {
        const removed = new Set(msg.removed);
        const kept = get().findings.filter((f) => !removed.has(f.id));
        const known = new Set(kept.map((f) => f.id));
        set({ findings: [...kept, ...msg.added.filter((f) => !known.has(f.id))] });
        break;
      }
    }
  },

  selectAsset: (id) => set({ selectedAssetId: id, selectedComponentId: null, selectedFindingId: null }),

  selectComponent: (id) => {
    const comp = id ? get().components[id] : undefined;
    set(
      comp
        ? { selectedComponentId: id, selectedAssetId: comp.asset_id, selectedFindingId: null }
        : { selectedComponentId: null, selectedFindingId: null },
    );
  },

  selectFinding: (id) => {
    const f = get().findings.find((x) => x.id === id);
    set(f ? { selectedFindingId: id, selectedComponentId: f.component_id, selectedAssetId: f.asset_id } : { selectedFindingId: null });
  },

  setCenterTab: (centerTab) => set({ centerTab }),
  setSideTab: (sideTab) => set({ sideTab }),
}));
