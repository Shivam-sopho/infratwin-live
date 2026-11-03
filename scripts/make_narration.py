"""Render the demo narration (and the spoken field command) with Kokoro, an open-source neural TTS (Apache 2.0).

    uv run --with kokoro-onnx --with soundfile python scripts/make_narration.py
Needs kokoro-v1.0.onnx + voices-v1.0.bin in demo-media/tts/ (see scripts/fetch_data.sh). Writes MP3s to
frontend/public/demo/narration/<id>.mp3 from the same frontend/src/narration.json the UI captions use.
"""

import json
import subprocess
import sys
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parent.parent
LINES = json.loads((ROOT / "frontend/src/narration.json").read_text())
OUT = ROOT / "frontend/public/demo/narration"
NARRATOR = "af_heart"  # warm, natural female voice

kokoro = Kokoro(str(ROOT / "demo-media/tts/kokoro-v1.0.onnx"), str(ROOT / "demo-media/tts/voices-v1.0.bin"))
OUT.mkdir(parents=True, exist_ok=True)
only = set(sys.argv[1:])
for key, line in LINES.items():
    if only and key not in only:
        continue
    text = f"{line['title']}. {line['text']}" if line.get("title") and key not in ("s0", "s7") else line["text"]
    if key == "s7":
        text = f"Infra Twin Live. {line['text']}"
    text = text.replace("InfraTwin-Live", "Infra Twin Live")  # say the product name naturally
    samples, rate = kokoro.create(text, voice=line.get("voice", NARRATOR), speed=1.0 if key == "command" else 1.1, lang="en-us")
    wav = OUT / f"{key}.wav"
    sf.write(wav, samples, rate)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-b:a", "96k", str(OUT / f"{key}.mp3")], check=True)
    if key == "command":  # the voice pipeline needs mono 16-bit PCM WAV at 24 kHz
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le",
                        str(ROOT / "frontend/public/demo/voice-command.wav")], check=True)
    wav.unlink()
    print(f"{key}: {len(samples) / rate:.1f}s")
