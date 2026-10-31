"""Daily spend guard for paid model calls.

Each paid operation reserves its estimated cost before calling out; once the UTC day's total
would exceed MAX_DAILY_USD the call is refused with 429. Totals persist across restarts.
"""

import json
import threading
from datetime import datetime, timezone
from pathlib import Path

from .config import settings

# Conservative per-operation estimates (USD). Token-priced models use a typical-call upper bound.
COST = {
    "sam31_image_per_concept": 0.0025,
    "sam31_video_per_frame": 0.0002,
    "muse_image": 0.01,
    "spark_call": 0.02,
    "wonder_mission": 0.15,
    "voice_command": 0.03,
    "sam3d_call": 0.05,  # Modal GPU seconds, not Meta credits, but still real spend
}


class BudgetExceeded(RuntimeError):
    pass


class Budget:
    def __init__(self, path: Path, cap_usd: float):
        self.path, self.cap = path, cap_usd
        self._lock = threading.Lock()
        self._day, self._spent, self._by_op = self._today(), 0.0, {}
        if path.exists():
            data = json.loads(path.read_text())
            if data.get("day") == self._day:
                self._spent, self._by_op = float(data["spent"]), dict(data.get("by_op", {}))

    @staticmethod
    def _today() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def _roll(self) -> None:
        if self._day != self._today():
            self._day, self._spent, self._by_op = self._today(), 0.0, {}

    def charge(self, op: str, usd: float) -> None:
        """Reserve `usd` for an operation or raise BudgetExceeded."""
        with self._lock:
            self._roll()
            if self.cap > 0 and self._spent + usd > self.cap + 1e-9:
                raise BudgetExceeded(
                    f"Daily model budget reached (${self._spent:.2f} of ${self.cap:.2f} spent today; this call needs ~${usd:.3f})"
                )
            self._spent += usd
            self._by_op[op] = round(self._by_op.get(op, 0.0) + usd, 4)
            self._save()

    def status(self) -> dict:
        with self._lock:
            self._roll()
            return {"day": self._day, "spent_usd": round(self._spent, 4), "cap_usd": self.cap, "by_op": dict(self._by_op)}

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps({"day": self._day, "spent": self._spent, "by_op": self._by_op}))


budget = Budget(settings.data_dir / "budget.json", settings.max_daily_usd)
