import asyncio

from fastapi.testclient import TestClient

from app import main, sam31_video
from app.findings import FindingStore
from app.sam31 import Concept
from app.sam31_video import VideoMeta, transcode
from test_sam31 import SAMPLE_LINE, _sse_events

# Same two objects seen in frames 0 and 3 (frames may be skipped in SAM output).
VIDEO_TEXT = SAMPLE_LINE + SAMPLE_LINE.replace("<0f>", "<3f>")

THUMB = "data:image/jpeg;base64,AAAA"


def test_segment_video_builds_tracks(monkeypatch):
    calls = {"upload": 0, "delete": 0}

    async def fake_upload(path, filename, content_type, purpose="user_data"):
        calls["upload"] += 1
        return "file-123"

    async def fake_delete(file_id):
        calls["delete"] += 1

    async def fake_stream(path, body):
        content = body["input"][0]["content"]
        assert content[1] == {"type": "input_video", "file_id": "file-123"}
        for e in _sse_events(VIDEO_TEXT if content[0]["text"] in ("concrete crack", "concrete pier") else ""):
            yield e

    monkeypatch.setattr(sam31_video.meta, "upload_file", fake_upload)
    monkeypatch.setattr(sam31_video.meta, "delete_file", fake_delete)
    monkeypatch.setattr(sam31_video.meta, "stream", fake_stream)

    concepts = [Concept(text="concrete pier", category="structural"), Concept(text="concrete crack", category="defect")]
    report = asyncio.run(sam31_video.segment_video("x.mp4", VideoMeta(width=320, height=334, fps=5, n_frames=20), concepts))

    assert calls == {"upload": 1, "delete": 1}
    crack = next(t for t in report.tracks if t.id == "concrete-crack-0")
    assert [f.f for f in crack.frames] == [0, 3]
    assert crack.host_id == "concrete-pier-0" and crack.host_overlap == 1.0
    assert crack.confidence == 0.91
    assert report.est_cost_usd == round(0.0002 * 50 * 2, 4)  # 50-frame billing minimum


def test_transcode_resamples(tmp_path):
    import av
    import numpy as np

    src = tmp_path / "in.mp4"
    with av.open(str(src), "w") as out:
        s = out.add_stream("libx264", rate=30)
        s.width, s.height, s.pix_fmt = 1920, 1080, "yuv420p"
        for i in range(90):  # 3 s at 30 fps
            frame = av.VideoFrame.from_ndarray(np.full((1080, 1920, 3), i, dtype=np.uint8), format="rgb24")
            for p in s.encode(frame):
                out.mux(p)
        for p in s.encode():
            out.mux(p)
    meta = transcode(str(src), str(tmp_path / "out.mp4"))
    assert (meta.width, meta.height, meta.fps) == (960, 540, 5)
    assert 14 <= meta.n_frames <= 16


def _finding(**kw):
    return {
        "component_id": "B07.P4",
        "concept": "concrete crack",
        "confidence": 0.9,
        "area_px": 1200,
        "source": "image",
        "source_name": "pier4.jpg",
        "bbox_uv": [0.4, 0.5, 0.6, 0.7],
        "host_label": "concrete pier #1",
        "thumbnail": THUMB,
        **kw,
    }


def test_findings_api_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "findings", FindingStore(tmp_path / "findings.json"))
    client = TestClient(main.app)

    r = client.post("/api/findings", json=[_finding(), _finding(concept="exposed rebar")])
    assert r.status_code == 200
    ids = [f["id"] for f in r.json()]
    assert ids == ["FD-0001", "FD-0002"] and r.json()[0]["asset_id"] == "B07"

    assert client.post("/api/findings", json=[_finding(component_id="NOPE")]).status_code == 404
    assert client.post("/api/findings", json=[_finding(bbox_uv=[0.6, 0.5, 0.4, 0.7])]).status_code == 422
    assert client.post("/api/findings", json=[_finding(thumbnail="javascript:x")]).status_code == 422

    assert client.delete("/api/findings/FD-0001").status_code == 200
    assert client.delete("/api/findings/FD-0001").status_code == 404

    # Persisted and reloaded; ids keep counting up.
    reloaded = FindingStore(tmp_path / "findings.json")
    assert [f.id for f in reloaded.all()] == ["FD-0002"]
    assert reloaded.add([main.FindingIn(**_finding())], main.ASSET_OF_COMPONENT)[0].id == "FD-0003"
