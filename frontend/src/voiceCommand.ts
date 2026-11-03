import { api } from "./api";
import { useTwin } from "./store";

/** Send a WAV field command through Voice Transcribe + Muse Spark and apply the browser-side actions. */
export async function runVoiceCommand(wav: Blob) {
  const { selectedComponentId, selectComponent, setCenterTab, setVoiceResult } = useTwin.getState();
  const r = await api.voice(wav, selectedComponentId);
  setVoiceResult(r);
  for (const a of r.actions) {
    if (a.status !== "client") continue;
    selectComponent(a.component_id);
    if (a.type === "open_inspection") setCenterTab("inspect");
  }
  return r;
}
