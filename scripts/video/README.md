# Rendering the demo video

Records the self-running demo (`?record` mode) through Chrome's screencast and assembles a 1080p/30 fps MP4.

```bash
# 1. app running (./start.sh, or backend :8000 + `npm run dev` :5173), then a headless Chrome:
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9333 \
  --user-data-dir=/tmp/itl-chrome --autoplay-policy=no-user-gesture-required --window-size=1920,1080 about:blank &
# 2. record one full run (about 3 minutes, real model calls, about $0.45)
node scripts/video/capture.mjs /tmp/itl-take 330
# 3. assemble: no-voice cut, guide cut with the reference narration, and a timed voice-over script
uv run --python 3.12 --with numpy --with soundfile python scripts/video/build_video.py /tmp/itl-take . demo-media/video
```
