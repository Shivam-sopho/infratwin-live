import { useTwin } from "../store";
import { InspectionPanel } from "./InspectionPanel";
import { TwinViewer } from "./TwinViewer";

const TABS = [
  { id: "twin", label: "3D Twin" },
  { id: "inspect", label: "Inspection · SAM 3.1" },
] as const;

export function CenterPane() {
  const tab = useTwin((s) => s.centerTab);
  const setTab = useTwin((s) => s.setCenterTab);
  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-line bg-panel" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`border-b-2 px-3 py-2 text-xs ${tab === t.id ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink-2"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* Both stay mounted so the WebGL context and inspection results survive tab switches. */}
      <div className={`min-h-0 flex-1 ${tab === "twin" ? "" : "hidden"}`}>
        <TwinViewer />
      </div>
      <div className={`min-h-0 flex-1 ${tab === "inspect" ? "" : "hidden"}`}>
        <InspectionPanel />
      </div>
    </div>
  );
}
