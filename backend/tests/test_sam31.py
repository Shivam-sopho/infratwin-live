import asyncio

import numpy as np

from app import sam31
from app.sam31 import Concept, Detection, _Raw, assign_hosts

# Documented SAM 3.1 sample (dev.meta.ai/docs/sam/reading-segmentation), image form.
SAMPLE_LINE = (
    "<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334;c=0.91|>"
    "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>"
    ",1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334;c=0.42|>"
    "<|mask;x=0;y=0;data=27,48,~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@|>\n"
)


def _sse_events(text: str):
    lane = {"item_id": "msg_1", "output_index": 0, "content_index": 0}
    yield {"type": "response.created", "response": {"id": "resp_1", "status": "in_progress"}}
    yield {"type": "response.output_text.delta", **lane, "delta": text}
    yield {"type": "response.content_part.done", **lane, "part": {"type": "output_text", "text": text}}
    yield {"type": "response.completed", "response": {"id": "resp_1", "status": "completed"}}


def test_segment_image_parses_stream(monkeypatch):
    sent = []

    async def fake_stream(path, body):
        sent.append(body)
        text = SAMPLE_LINE if body["input"][0]["content"][0]["text"] == "concrete crack" else ""
        for e in _sse_events(text):
            yield e

    monkeypatch.setattr(sam31.meta, "stream", fake_stream)
    concepts = [Concept(text="concrete pier", category="structural"), Concept(text="concrete crack", category="defect")]
    report = asyncio.run(sam31.segment_image("data:image/jpeg;base64,AA==", 320, 334, concepts))

    assert {b["input"][0]["content"][0]["text"] for b in sent} == {"concrete pier", "concrete crack"}
    assert all(b["metadata"]["mask_encoding"] == "one_bit" for b in sent)
    assert [c.count for c in report.concepts] == [0, 2]
    assert all(c.error is None for c in report.concepts)

    d0 = next(d for d in report.detections if d.id == "concrete-crack-0")
    assert d0.confidence == 0.91
    assert d0.mask is not None and d0.mask.bounds == (211, 228, 271, 255)
    assert d0.mask.png.startswith("data:image/png;base64,")
    assert 0 < d0.area_px <= 60 * 27
    assert report.est_cost_usd == 0.005


def test_concept_failure_is_isolated(monkeypatch):
    async def failing_stream(path, body):
        raise RuntimeError("boom")
        yield  # pragma: no cover

    monkeypatch.setattr(sam31.meta, "stream", failing_stream)
    report = asyncio.run(sam31.segment_image("data:,", 10, 10, [Concept(text="girder", category="structural")]))
    assert report.concepts[0].error and "boom" in report.concepts[0].error
    assert report.detections == []


def _raw(id_, category, bounds, fill=None):
    l, t, r, b = bounds
    raster = np.zeros((b - t, r - l), dtype=bool)
    if fill is None:
        raster[:] = True
    else:
        fl, ft, fr, fb = fill
        raster[ft - t : fb - t, fl - l : fr - l] = True
    det = Detection(id=id_, concept=id_, category=category, box=bounds, confidence=None, area_px=int(raster.sum()), mask=None)
    return _Raw(det=det, raster=raster, bounds=bounds)


def test_assign_hosts_uses_mask_overlap():
    pier = _raw("pier-0", "structural", (0, 0, 100, 200))
    # Girder's box covers the crack, but its mask only fills the top strip.
    girder = _raw("girder-0", "structural", (0, 0, 300, 200), fill=(0, 0, 300, 20))
    crack = _raw("crack-0", "defect", (40, 100, 60, 150))
    stray = _raw("crack-1", "defect", (250, 150, 280, 190))
    assign_hosts([pier, girder, crack, stray])
    assert crack.det.host_id == "pier-0" and crack.det.host_overlap == 1.0
    assert stray.det.host_id is None
