import { useEffect } from "react";
import { useTwin } from "./store";
import type { ServerMessage } from "./types";

export function useTelemetry() {
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const { ingest, setConnected } = useTwin.getState();

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws/telemetry`);
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => ingest(JSON.parse(e.data) as ServerMessage);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 2000);
      };
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, []);
}
