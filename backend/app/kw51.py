"""Real monitoring data: railway bridge KW51 near Leuven, replayed through the twin.

Source: K. Maes & G. Lombaert, "Monitoring data for railway bridge KW51 in Leuven, Belgium, before,
during, and after retrofitting", Zenodo 10.5281/zenodo.3745914 (CC BY-NC-SA 4.0). We use the hourly
tracked modal frequencies and environmental channels (Oct 2018 - Jan 2020). The bridge's diagonal-to-
arch/deck connections were strengthened 2019-05-15 .. 2019-09-27.

Natural frequencies drift with temperature (and jump when ballast freezes), which would swamp a raw
threshold. So each tracked mode gets a baseline model fitted on pre-retrofit data:
    f = a + b*T + c*min(T, 0)        (T = steel temperature; the min term captures frozen ballast)
and the twin monitors the robust z-score of the residual, smoothed over 6 hours. A sustained |z| > 3
is Watch, > 5 Critical: a stiffness change not explained by the environment.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

MODES = (3, 6, 9, 13)  # 1-based mode numbers with >= 86 % tracking coverage
RETROFIT_START = datetime(2019, 5, 15, tzinfo=timezone.utc)
RETROFIT_END = datetime(2019, 9, 27, tzinfo=timezone.utc)
SMOOTH_H = 6
ENV = {"tBD31A": "steel_temp", "tVL": "air_temp", "rhVL": "humidity", "wsVL": "wind"}


def _datenum_to_unix(dn: np.ndarray) -> np.ndarray:
    # MATLAB datenum: days since year 0; 719529 is 1970-01-01.
    return (dn - 719529.0) * 86400.0


def _rolling_nanmedian(x: np.ndarray, w: int) -> np.ndarray:
    out = np.full_like(x, np.nan)
    for i in range(len(x)):
        win = x[max(0, i - w + 1) : i + 1]
        if np.isfinite(win).any():
            out[i] = np.nanmedian(win)
    return out


@dataclass
class ModeModel:
    mode: int
    coef: tuple[float, float, float]
    sigma_hz: float
    baseline_median_hz: float


@dataclass
class KW51Data:
    t: np.ndarray  # unix seconds, hourly
    freq: dict[int, np.ndarray]  # mode -> Hz (nan = not tracked that hour)
    z: dict[int, np.ndarray]  # mode -> smoothed residual z-score
    env: dict[str, np.ndarray]  # steel_temp, air_temp, humidity, wind
    models: dict[int, ModeModel]

    @property
    def start(self) -> datetime:
        return datetime.fromtimestamp(float(self.t[0]), timezone.utc)

    def index_at(self, when: datetime) -> int:
        return int(np.clip(np.searchsorted(self.t, when.timestamp()), 0, len(self.t) - 1))


def build(sdn: np.ndarray, f: np.ndarray, env: np.ndarray, env_labels: list[str]) -> KW51Data:
    t = _datenum_to_unix(np.asarray(sdn, dtype=float))
    envs = {ENV[lbl]: np.asarray(env[:, i], dtype=float) for i, lbl in enumerate(env_labels) if lbl in ENV}
    T = envs["steel_temp"]
    base = t < RETROFIT_START.timestamp()
    freq, zs, models = {}, {}, {}
    for mode in MODES:
        y = np.asarray(f[:, mode - 1], dtype=float)
        X = np.stack([np.ones_like(T), T, np.minimum(T, 0.0)], axis=1)
        ok = base & np.isfinite(y) & np.isfinite(T)
        coef, *_ = np.linalg.lstsq(X[ok], y[ok], rcond=None)
        resid = y - X @ coef
        mad = np.nanmedian(np.abs(resid[ok] - np.nanmedian(resid[ok])))
        sigma = float(1.4826 * mad) or float(np.nanstd(resid[ok]))
        freq[mode] = y
        zs[mode] = _rolling_nanmedian(resid / sigma, SMOOTH_H)
        models[mode] = ModeModel(mode, tuple(float(c) for c in coef), sigma, float(np.nanmedian(y[ok])))
    return KW51Data(t=t, freq=freq, z=zs, env=envs, models=models)


def load(mat_path: Path, cache_path: Path | None = None) -> KW51Data | None:
    """Load trackedmodes.mat (cached as .npz after the first parse). None if the data is not present."""
    if cache_path and cache_path.exists():
        c = np.load(cache_path, allow_pickle=False)
        labels = [str(x) for x in c["env_labels"]]
        return build(c["sdn"], c["f"], c["env"], labels)
    if not mat_path.exists():
        return None
    from scipy.io import loadmat

    m = loadmat(mat_path, squeeze_me=True, struct_as_record=False)["modes"]
    labels = [str(x) for x in m.labels_env]
    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(cache_path, sdn=m.sdn, f=m.f, env=m.env, env_labels=np.array(labels))
    return build(m.sdn, m.f, m.env, labels)


class Replay:
    """Plays the hourly record at `hours_per_s`, looping at the end."""

    def __init__(self, data: KW51Data, hours_per_s: float = 24.0):
        self.data = data
        self.hours_per_s = hours_per_s
        self.playing = True
        self.pos = 0.0  # fractional row index

    def advance(self, dt_s: float) -> None:
        if self.playing:
            self.pos = (self.pos + self.hours_per_s * dt_s) % len(self.data.t)

    def seek(self, when: datetime) -> None:
        self.pos = float(self.data.index_at(when))

    @property
    def row(self) -> int:
        return int(self.pos)

    def now(self) -> datetime:
        return datetime.fromtimestamp(float(self.data.t[self.row]), timezone.utc)

    def phase(self) -> str:
        n = self.now()
        return "pre-retrofit" if n < RETROFIT_START else "retrofit works" if n <= RETROFIT_END else "post-retrofit"

    def state(self) -> dict:
        return {
            "time": self.now().isoformat(),
            "phase": self.phase(),
            "playing": self.playing,
            "hours_per_s": self.hours_per_s,
            "progress": round(self.row / max(1, len(self.data.t) - 1), 4),
        }

    def readings(self) -> dict[str, float]:
        """Current values keyed by sensor kind suffix (mode<k>_hz, mode<k>_dev, env names); NaN = data gap."""
        r = self.row
        out = {f"mode{m}_hz": float(self.data.freq[m][r]) for m in MODES}
        out.update({f"mode{m}_dev": float(abs(self.data.z[m][r])) for m in MODES})
        out.update({k: float(v[r]) for k, v in self.data.env.items()})
        return out


def describe_window(data: KW51Data, start: datetime, hours: int = 48) -> dict:
    """Summary used in docs/tests: median deviation per mode in a window."""
    i = data.index_at(start)
    j = min(len(data.t), i + hours)
    return {m: float(np.nanmedian(np.abs(data.z[m][i:j]))) for m in MODES}


def retrofit_effect(data: KW51Data) -> dict[int, float]:
    """Median smoothed deviation (sigma) in the 30 days after retrofit, per mode."""
    return describe_window(data, RETROFIT_END + timedelta(days=1), hours=24 * 30)
