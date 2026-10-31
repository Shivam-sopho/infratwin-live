import io
import wave

import pytest
from fastapi.testclient import TestClient

from app import main
from app.findings import FindingStore
from app.metrology import Metrology
from app.voice import NoteStore, VoiceAction, VoiceIntent, check_wav


def _wav(rate=24000, channels=1, width=2, seconds=0.5) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        w.writeframes(b"\x00" * int(rate * seconds) * channels * width)
    return buf.getvalue()


def test_check_wav():
    assert check_wav(_wav()) == 500
    assert check_wav(_wav(rate=16000)) == 500
    for bad in (_wav(rate=44100), _wav(channels=2), _wav(width=1), b"not audio"):
        with pytest.raises(ValueError):
            check_wav(bad)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main.meta, "configured", True)
    monkeypatch.setattr(main, "findings", FindingStore(tmp_path / "findings.json"))
    monkeypatch.setattr(main, "notes", NoteStore(tmp_path / "notes.json"))
    started = []
    monkeypatch.setattr(main.planner, "start", lambda cid, fid: started.append((cid, fid)) or type("M", (), {"id": "MS-9999"})())
    sent = []

    async def capture(msg):
        sent.append(msg)

    monkeypatch.setattr(main.sim, "broadcast", capture)
    return TestClient(main.app), started, sent


def test_spec_example_command(client, monkeypatch):
    c, started, sent = client
    calls = {}

    async def fake_transcribe(wav, keywords):
        calls["keywords"] = keywords
        return {"transcript": "Pin this shear crack to Pier 4, run metric area calculation, and plan a drone re-scan around the drainage pipe", "audioDurationMs": 4200}

    async def fake_interpret(transcript, context):
        calls["context"] = context
        return VoiceIntent(
            reply="Noted the shear crack on Pier 4, measuring, and planning a re-scan.",
            actions=[
                VoiceAction(type="add_note", component_id="B07.P4", text="Shear crack observed"),
                VoiceAction(type="measure", component_id="B07.P4", text=""),
                VoiceAction(type="plan_rescan", component_id="B07.P4", text=""),
                VoiceAction(type="select_component", component_id="B07.P4", text=""),
            ],
        )

    monkeypatch.setattr(main, "transcribe", fake_transcribe)
    monkeypatch.setattr(main, "interpret", fake_interpret)
    f = main.findings.add(
        [main.FindingIn(component_id="B07.P4", concept="concrete crack", confidence=0.9, area_px=10, source="image",
                        source_name="p4.jpg", bbox_uv=(0.4, 0.5, 0.6, 0.7), thumbnail="data:image/jpeg;base64,AA",
                        metrology=Metrology(method="host-scale-2d", scale_mm_per_px=2.0, scale_note="x", area_m2=0.012,
                                            perimeter_m=0.9, length_m=0.42, max_width_mm=1.8, assumptions=[]))],
        main.ASSET_OF_COMPONENT,
    )[0]

    r = c.post("/api/voice", files={"file": ("a.wav", _wav(), "audio/wav")}, data={"selected_component_id": "B07.P2"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["audio_ms"] == 4200 and body["reply"].startswith("Noted")
    assert [a["status"] for a in body["actions"]] == ["done", "done", "done", "client"]
    assert "0.0120 m²" in body["actions"][1]["detail"] and "w≤1.8 mm" in body["actions"][1]["detail"]
    assert started == [("B07.P4", f.id)]
    assert main.notes.all()[0].text == "Shear crack observed"
    assert sent[0]["type"] == "notes"
    assert "Pier 4" in calls["keywords"] and "efflorescence" in calls["keywords"]
    assert calls["context"]["selected_component_id"] == "B07.P2"


def test_bad_component_and_bad_audio(client, monkeypatch):
    c, _, _ = client

    async def fake_transcribe(wav, keywords):
        return {"transcript": "add a note on pier nine", "audioDurationMs": 900}

    async def fake_interpret(transcript, context):
        return VoiceIntent(reply="ok", actions=[VoiceAction(type="add_note", component_id="B07.P9", text="x")])

    monkeypatch.setattr(main, "transcribe", fake_transcribe)
    monkeypatch.setattr(main, "interpret", fake_interpret)
    r = c.post("/api/voice", files={"file": ("a.wav", _wav(), "audio/wav")})
    assert r.json()["actions"][0]["status"] == "error"
    assert c.post("/api/voice", files={"file": ("a.wav", _wav(rate=44100), "audio/wav")}).status_code == 400
