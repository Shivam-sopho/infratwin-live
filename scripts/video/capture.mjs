// Records the self-running demo: screencast frames (with timestamps) + a caption/narration timeline.
const [,, OUT, MAXS = "400", STOP_AFTER = ""] = process.argv;
const fs = await import("fs");
fs.mkdirSync(`${OUT}/frames`, { recursive: true });
const page = (await (await fetch("http://127.0.0.1:9333/json")).json()).find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pending = {}; const frames = []; let n = 0;
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
  if (m.method === "Page.screencastFrame") {
    const f = `${OUT}/frames/${String(n++).padStart(6, "0")}.jpg`;
    fs.writeFileSync(f, Buffer.from(m.params.data, "base64"));
    frames.push({ f, ts: m.params.metadata.timestamp });
    ws.send(JSON.stringify({ id: ++id, method: "Page.screencastFrameAck", params: { sessionId: m.params.sessionId } }));
  }
  if (m.method === "Runtime.exceptionThrown") console.log("EXC", JSON.stringify(m.params).slice(0, 300));
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const js = async expr => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: "http://localhost:5173/?record" }); await sleep(8000);
await send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 2 });
await sleep(1500);
console.log(await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('▶ Play demo')); if(!b) return 'no button'; b.click(); return 'started'})()`));
const startWall = Date.now() / 1000;
const timeline = []; let last = "";
for (let k = 0; k < Number(MAXS) * 4; k++) {
  await sleep(250);
  const st = await js(`(()=>{const tc=document.body.textContent; const p=document.querySelector('.fixed.inset-x-0.bottom-0');
    const mode = tc.includes('Skip intro') ? 'cold' : tc.includes('Connects the warnings') ? 'opening' : tc.includes('Open source · MIT') ? 'closing' : p ? 'scene' : 'ended';
    const t=p?.querySelector('.font-semibold')?.textContent ?? ''; const x=p?.querySelector('p.text-ink-2')?.textContent ?? ''; const w=p?.querySelector('p.text-accent')?.textContent ?? '';
    return JSON.stringify({mode, t, x, w})})()`);
  if (st !== last) { last = st; const o = JSON.parse(st); timeline.push({ wall: Date.now() / 1000, ...o }); console.log(`${(Date.now()/1000 - startWall).toFixed(1)}s ${o.mode} | ${o.t} | ${o.x.slice(0, 50)}${o.w ? ' | ' + o.w.slice(0, 40) : ''}`); if (o.mode === 'ended') break; }
  if (STOP_AFTER && Date.now() / 1000 - startWall > Number(STOP_AFTER)) { await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(1000); break; }
}
await send("Page.stopScreencast"); await sleep(500);
const narr = await js(`JSON.stringify({origin: performance.timeOrigin, items: window.__narration ?? []})`);
fs.writeFileSync(`${OUT}/capture.json`, JSON.stringify({ startWall, frames, timeline, narration: JSON.parse(narr) }));
const dur = frames.at(-1).ts - frames[0].ts;
console.log(`frames ${frames.length} over ${dur.toFixed(1)}s = ${(frames.length / dur).toFixed(1)} fps`);
ws.close();
