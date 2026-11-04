"""Assemble the recorded demo: CFR video, synthesized SFX, guide narration, and a voice-over script."""
import json, subprocess, sys
from pathlib import Path
import numpy as np
import soundfile as sf

take, root, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
SPEED = 2.5        # silent model waits play this much faster, under an on-screen badge
W, H, FPS = 2560, 1440, 60
out.mkdir(parents=True, exist_ok=True)
cap = json.loads((take / "capture.json").read_text())
narr = [(n["src"], (cap["narration"]["origin"] + n["t"]) / 1000) for n in cap["narration"]["items"]]
c1 = next(t for s, t in narr if s.endswith("/c1.mp3"))
t0 = c1 - 2.2                               # cold open starts 2.2 s before its first line
t_end = next(x["wall"] for x in cap["timeline"] if x["mode"] == "ended") - 0.4
frames = [f for f in cap["frames"] if t0 - 0.05 <= f["ts"] <= t_end]

def clip_len(p): return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)], capture_output=True, text=True).stdout)
spoken = [(t, t + clip_len(root / "frontend/public" / src.lstrip("/")) + 0.6) for src, t in narr]

# Silent stretches of each model wait (caption shows "…is working"), minus any narration, minus 1.5 s at the end
# so results land in real time.
segs = []
tl = cap["timeline"]
for a, b in zip(tl, tl[1:] + [tl[-1]]):
    if not a["w"]:
        continue
    lo, hi = a["wall"], b["wall"] - 1.5
    for s0, s1 in spoken:
        if s0 <= lo < s1: lo = s1
    if hi - lo > 2: segs.append((lo, hi))
def out_t(t):
    """Wall time -> output video time."""
    o = t - t0
    for a, b in segs: o -= max(0.0, min(t, b) - a) * (1 - 1 / SPEED) if t > a else 0
    return o
dur = out_t(t_end)
print(f"video {dur:.1f}s ({t_end - t0:.1f}s recorded), {len(frames)} frames, sped up:", [(round(out_t(a), 1), round(out_t(b), 1)) for a, b in segs])

# 1) frames -> constant 30 fps
lines = ["ffconcat version 1.0"]
for a, b in zip(frames, frames[1:] + [{"f": frames[-1]["f"], "ts": t_end}]):
    lines += [f"file '{a['f']}'", f"duration {max(0.001, out_t(b['ts']) - out_t(a['ts'])):.4f}"]
lines.append(f"file '{frames[-1]['f']}'")
(out / "frames.ffconcat").write_text("\n".join(lines))
# badge shown over sped-up stretches
from PIL import Image, ImageDraw, ImageFont
font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 30)
label = f"Live model call · sped up {SPEED:g}×"
bw = int(font.getlength(label)) + 92
badge = Image.new("RGBA", (bw, 58), (0, 0, 0, 0))
d = ImageDraw.Draw(badge)
d.rounded_rectangle((0, 0, bw - 1, 57), radius=14, fill=(11, 15, 20, 220), outline=(56, 189, 248, 255), width=2)
for x in (22, 40):  # fast-forward arrows, drawn (the font has no glyph for them)
    d.polygon([(x, 17), (x, 41), (x + 17, 29)], fill=(56, 189, 248, 255))
d.text((70, 12), label, font=font, fill=(229, 231, 235, 255))
badge.save(out / "badge.png")
enable = "+".join(f"between(t,{out_t(a):.2f},{out_t(b):.2f})" for a, b in segs) or "0"
video = out / "video_only.mp4"
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(out / "frames.ffconcat"), "-i", str(out / "badge.png"),
                "-filter_complex", f"[0:v]fps={FPS},scale={W}:{H}:flags=lanczos[v];[v][1:v]overlay=x=(W-w)/2:y=110:enable='{enable}',format=yuv420p[o]",
                "-map", "[o]", "-c:v", "libx264", "-preset", "medium", "-crf", "15", "-profile:v", "high", "-t", f"{dur:.3f}", str(video)], check=True)

# 2) sound design for the cold open (the app synthesizes the same in WebAudio; screencasts carry no audio)
sr = 48000
n = int(dur * sr)
sfx = np.zeros(n)
rng = np.random.default_rng(7)
def lowpass(x, fc):
    a = np.exp(-2 * np.pi * fc / sr); y = np.zeros_like(x); acc = 0.0
    for i in range(len(x)): acc = (1 - a) * x[i] + a * acc; y[i] = acc
    return y
def place(sig, at):
    i = int(at * sr); j = min(n, i + len(sig)); sfx[i:j] += sig[: j - i]
# tension bed: low hum + air under the time-lapse (0-9 s)
t = np.arange(int(9.5 * sr)) / sr
bed = 0.05 * np.sin(2 * np.pi * 55 * t) + 0.03 * np.sin(2 * np.pi * 82.5 * t) + 0.02 * lowpass(rng.standard_normal(len(t)), 400) * 3
bed *= np.clip(t / 2, 0, 1) * np.clip((9.5 - t) / 0.6, 0, 1) * (0.6 + 0.4 * t / 9.5)
place(bed, 0.0)
# crack at 8.9 s
k = int(0.35 * sr); crack = rng.standard_normal(k); crack = crack - lowpass(crack, 1800); crack *= 0.55 * np.exp(-np.arange(k) / (0.06 * sr))
place(crack, 8.9)
# rumble 8.9 - 14.5 s
m = int(5.6 * sr); tt = np.arange(m) / sr
rum = lowpass(lowpass(rng.standard_normal(m), 140), 140) * 9
env = np.interp(tt, [0, 1.4, 3.0, 5.5, 5.6], [0.0, 0.9, 0.5, 0.0, 0.0])
place(rum * env, 8.9)
# rewind whoosh at 21 s
w = int(2.6 * sr); tw = np.arange(w) / sr
wh = rng.standard_normal(w); wh = lowpass(wh, 900) * 2.5 * np.sin(np.pi * tw / 2.6) ** 2 * 0.25
place(wh, 21.0)
sfx = np.clip(sfx, -0.95, 0.95)
sf.write(out / "sfx.wav", np.stack([sfx, sfx], 1), sr)

# 3) guide narration: each Kokoro clip at the moment the app played it
inputs, filters = ["-i", str(out / "sfx.wav")], []
for i, (src, t) in enumerate(narr, start=1):
    inputs += ["-i", str(root / "frontend/public" / src.lstrip("/"))]
    filters.append(f"[{i}:a]aresample=48000,adelay={int(out_t(t) * 1000)}|{int(out_t(t) * 1000)},volume=1.6[n{i}]")
mix = "".join(f"[n{i}]" for i in range(1, len(narr) + 1))
filters.append(f"[0:a]{mix}amix=inputs={len(narr) + 1}:normalize=0,alimiter=limit=0.95[a]")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(filters), "-map", "[a]",
                "-t", f"{dur:.3f}", str(out / "guide_audio.wav")], check=True)
# no-voice cut keeps the field inspector's spoken command: it is the product's input, not narration
cmd = [(src, t) for src, t in narr if src.endswith("/command.mp3")]
ci = ["-i", str(out / "sfx.wav")] + sum((["-i", str(root / "frontend/public" / s.lstrip("/"))] for s, _ in cmd), [])
cf = [f"[{i}:a]aresample=48000,adelay={int(out_t(t) * 1000)}|{int(out_t(t) * 1000)},volume=1.6[c{i}]" for i, (_, t) in enumerate(cmd, 1)]
cf.append("[0:a]" + "".join(f"[c{i}]" for i in range(1, len(cmd) + 1)) + f"amix=inputs={len(cmd) + 1}:normalize=0,alimiter=limit=0.95[a]")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *ci, "-filter_complex", ";".join(cf), "-map", "[a]", "-t", f"{dur:.3f}", str(out / "sfx_cmd.wav")], check=True)
for name, audio in [("InfraTwin-Live-demo-no-voice.mp4", out / "sfx_cmd.wav"), ("InfraTwin-Live-demo-guide-voice.mp4", out / "guide_audio.wav")]:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-i", str(audio), "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                    "-shortest", "-movflags", "+faststart", str(out / name)], check=True)

# 4) voice-over script with timecodes
N = json.loads((root / "frontend/src/narration.json").read_text())
def tc(s): return f"{int(s // 60)}:{s % 60:04.1f}"
rows = []
for src, t in narr:
    key = Path(src).stem
    if key not in N: continue
    p = root / "frontend/public" / src.lstrip("/")
    who = "Field inspector (the voice command; keep the app's recording or say it yourself)" if key == "command" else "You"
    rows.append(f"| {tc(out_t(t))} | {clip_len(p):.0f}s | {who} | {N[key]['text']} |")
(out / "voiceover-script.md").write_text(
    "# InfraTwin-Live demo: voice-over script\n\n"
    f"Video length {tc(dur)}. Each line starts at the time shown and should fit in about the given length "
    "(the reference voice's length). Say it your way; the captions already carry the exact words. "
    "Stretches marked on screen as sped up are live model calls played faster; talk over them freely.\n\n"
    "| Starts | Length | Who | Line |\n|---|---|---|---|\n" + "\n".join(rows) + "\n")
print("done", out)
