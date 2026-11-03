import asyncio
import json

from meta_sam_parser import SegmentationBoxRecord

from app import inspector
from app.inspector import ai_inspect
from app.metrology import ScaleRef
from test_sam31 import SAMPLE_LINE, _sse_events

READING = {
    "elements": [{"type": "pier", "box": [150, 220, 280, 260]}],
    "defects": [
        {"type": "spalling", "box": [205, 225, 275, 258], "points": [[230, 240]], "severity": "high", "note": "Spalled cover"},
        {"type": "crack", "box": [160, 230, 260, 250], "points": [[160, 235], [210, 240], [260, 248]], "severity": "medium", "note": "Diagonal crack"},
        {"type": "crack", "box": [1, 1, 1, 1], "points": [], "severity": "low", "note": "degenerate box is dropped"},
    ],
    "summary": "Pier shows spalling and a diagonal crack.",
    "recommended_action": "Schedule hands-on inspection.",
}


def test_ai_inspector_chains_spark_and_sam(monkeypatch):
    bodies = []

    async def fake_respond(model, input, **kw):
        assert input[0]["content"][1]["type"] == "input_image" and kw["text"]["format"]["strict"] is True
        return {"output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps(READING)}]}]}

    async def fake_stream(path, body):
        bodies.append(body)
        for e in _sse_events(SAMPLE_LINE.split(",1<|box")[0] + "\n"):  # one object (id 0) per request
            yield e

    monkeypatch.setattr(inspector.meta, "respond", fake_respond)
    monkeypatch.setattr(inspector.meta, "stream", fake_stream)
    ref = ScaleRef(component_id="B07.P4", component_name="Pier 4", axis="width", length_m=2.4)
    r = asyncio.run(ai_inspect("data:image/jpeg;base64,AA==", 320, 334, ref))

    # One SAM request per masked object (pier + spalling); the crack is a traced line, no SAM call.
    assert len(bodies) == 2
    prompts = [b["input"][0]["content"][0]["text"] for b in bodies]
    assert all(p.startswith("<0f>0<|box;") for p in prompts) and any("point" in p for p in prompts)
    by = {d.id: d for d in r.detections}
    assert set(by) == {"pier-0", "spalling-0", "crack-1"}
    crack = by["crack-1"]
    assert crack.polyline == [[160, 235], [210, 240], [260, 248]] and crack.mask is None
    assert crack.severity == "medium" and crack.note == "Diagonal crack" and crack.host_id == "pier-0"
    assert crack.metrology and crack.metrology.length_m > 0
    assert by["spalling-0"].severity == "high" and by["spalling-0"].host_id == "pier-0"
    assert r.summary.startswith("Pier shows") and r.mode == "ai_inspector"
