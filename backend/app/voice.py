"""Hands-free field commands: Muse Voice Transcribe → Muse Spark intent parsing → twin actions."""

import io
import itertools
import json
import time
import wave
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from .meta_client import MUSE_SPARK, MUSE_VOICE, meta

MAX_AUDIO_S = 120

ActionType = Literal[
    "select_component", "add_note", "measure", "run_triage", "plan_rescan", "open_inspection", "simulate_event", "none"
]

INSTRUCTIONS = """You turn a field inspector's spoken command into actions on a structural digital twin.
Map spoken names ("pier four", "girder C", "the east abutment") to component ids from the provided list; if
none is named, use the currently selected component. Available actions:
- select_component: focus the twin on a component.
- add_note: record an inspection observation on a component; put the observation (cleaned up, concise) in text.
- measure: report the metric measurements (area, length, width) of the component's pinned defects.
- run_triage: ask the Cognitive Twin to assess the component's current health.
- plan_rescan: plan a drone re-scan of the component (and its latest finding), routing around obstacles.
- open_inspection: open the camera inspection view for the component.
- simulate_event: only if explicitly asked to simulate/demo a sensor event.
Use one action per distinct request, in the order spoken. Use component_id "" and text "" when not applicable.
If nothing actionable was said, return a single "none" action. Reply in one short sentence."""


class VoiceAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: ActionType
    component_id: str
    text: str


class VoiceIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reply: str
    actions: list[VoiceAction]


class ActionResult(VoiceAction):
    status: Literal["done", "client", "skipped", "error"]
    detail: str = ""


class VoiceResult(BaseModel):
    transcript: str
    reply: str
    audio_ms: int | None
    actions: list[ActionResult]


class Note(BaseModel):
    id: str
    t: float
    asset_id: str
    component_id: str
    text: str
    transcript: str
    source: Literal["voice"] = "voice"


class NoteStore:
    def __init__(self, path: Path):
        self.path = path
        self._items: list[Note] = []
        if path.exists():
            self._items = [Note.model_validate(n) for n in json.loads(path.read_text())]
        start = max((int(n.id.split("-")[1]) for n in self._items), default=0) + 1
        self._ids = itertools.count(start)

    def all(self) -> list[Note]:
        return list(self._items)

    def add(self, asset_id: str, component_id: str, text: str, transcript: str) -> Note:
        note = Note(id=f"NT-{next(self._ids):04d}", t=time.time(), asset_id=asset_id, component_id=component_id, text=text, transcript=transcript)
        self._items.append(note)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps([n.model_dump() for n in self._items]))
        return note


def check_wav(data: bytes) -> int:
    """Validate the format Voice Transcribe accepts; returns duration in ms."""
    try:
        with wave.open(io.BytesIO(data)) as w:
            channels, width, rate, frames = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
    except (wave.Error, EOFError) as e:
        raise ValueError(f"not a WAV file: {e}")
    if channels != 1 or width != 2 or rate not in (16000, 24000):
        raise ValueError(f"need mono 16-bit PCM at 16/24 kHz, got {channels} ch, {width * 8}-bit, {rate} Hz")
    ms = int(frames / rate * 1000)
    if ms > MAX_AUDIO_S * 1000:
        raise ValueError(f"audio longer than {MAX_AUDIO_S} s")
    return ms


async def transcribe(wav: bytes, keywords: list[str]) -> dict:
    settings = {"model": MUSE_VOICE, "audioEncoding": "WAV", "mode": "PUSH_TO_TALK", "keywords": keywords[:100]}
    return await meta.transcribe(wav, settings)


async def interpret(transcript: str, context: dict) -> VoiceIntent:
    resp = await meta.respond(
        MUSE_SPARK,
        json.dumps({"transcript": transcript, **context}),
        instructions=INSTRUCTIONS,
        reasoning={"effort": "low"},
        text={"format": {"type": "json_schema", "name": "voice_intent", "schema": VoiceIntent.model_json_schema(), "strict": True}},
        store=False,
    )
    return VoiceIntent.model_validate_json(meta.output_text(resp))


def vocabulary(component_names: list[str]) -> list[str]:
    defects = ["crack", "shear crack", "alligator crack", "spalling", "exposed rebar", "efflorescence", "rust stain", "scour"]
    return list(dict.fromkeys(component_names + defects + ["drone", "re-scan", "triage", "pier", "girder", "abutment"]))
