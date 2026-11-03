"""Global portfolio: every structure the platform would watch, on one globe.

The sites are real (688 notable bridges, tunnels and dams from Wikidata, CC0; see scripts/fetch_fleet_sites.py).
Their health, repairs and events are simulated, deterministically from the site id and the clock, so every
viewer sees the same world and it changes slowly over time. The corridor twins are merged in with their live status.
"""

import hashlib
import json
import math
import time
from pathlib import Path

SITES = json.loads((Path(__file__).parent / "data_static" / "fleet_sites.json").read_text())["sites"]

EPOCH_S = 900  # a site's condition can change every 15 minutes
EVENT_S = 4  # one portfolio event every few seconds

ISSUES = {
    "bridge": [
        ("critical", "Strain step change at a main member, not explained by temperature"),
        ("critical", "Scour risk at a pier after high water"),
        ("watch", "Bearing displacement trending up"),
        ("watch", "Joint movement outside its seasonal range"),
        ("watch", "Deflection under traffic above baseline"),
        ("watch", "Corrosion sensors above threshold"),
        ("watch", "Natural frequency drift after temperature correction"),
    ],
    "tunnel": [
        ("critical", "Lining convergence accelerating"),
        ("watch", "Water ingress through a construction joint"),
        ("watch", "Crack width growth in the arch crown"),
        ("watch", "Ventilation shaft vibration above baseline"),
    ],
    "dam": [
        ("critical", "Uplift pressure rising under a monolith"),
        ("watch", "Seepage flow increase in the drainage gallery"),
        ("watch", "Crest displacement trending downstream"),
        ("watch", "Spillway gate actuator fault"),
    ],
}
REPAIRS = {
    "bridge": ["Bearing replacement", "Crack injection and sealing", "Cable re-tensioning", "Scour protection (riprap)",
               "Expansion joint renewal", "Cathodic protection retrofit"],
    "tunnel": ["Lining repair (sprayed concrete)", "Joint re-grouting", "Drainage renewal"],
    "dam": ["Drain re-boring", "Grout curtain renewal", "Gate actuator overhaul"],
}
SENSORS = {"bridge": (24, 420), "tunnel": (60, 900), "dam": (80, 1200)}


def _h(*parts: object) -> float:
    """Stable uniform [0, 1) from the parts."""
    d = hashlib.blake2b("|".join(map(str, parts)).encode(), digest_size=8).digest()
    return int.from_bytes(d, "big") / 2**64


def sites() -> list[dict]:
    """Static site list (sent once)."""
    out = []
    for s in SITES:
        lo, hi = SENSORS[s["kind"]]
        n = int(lo + (hi - lo) * min(1.0, s["links"] / 60) * (0.6 + 0.4 * _h(s["id"], "n")))
        out.append({**s, "sensors": n})
    return out


def _condition(site: dict, now: float) -> dict | None:
    """Simulated condition of one site right now: None when nominal."""
    epoch = int(now // EPOCH_S)
    r = _h(site["id"], epoch)
    pick = _h(site["id"], epoch, "issue")
    level = "critical" if r < 0.012 else "watch" if r < 0.09 else None
    options = [text for lvl, text in ISSUES[site["kind"]] if lvl == level]
    issue = options[int(pick * len(options))] if level else None
    # Repairs run on their own, longer schedule: started some days ago, progressing in real time.
    repair = None
    rr = _h(site["id"], "repair", int(now // (EPOCH_S * 8)))
    if rr < 0.06 or level == "critical":
        dur = 3600 * (2 + 6 * _h(site["id"], "dur"))  # compressed: a "repair" completes in hours, not weeks
        start = (now // (EPOCH_S * 8)) * EPOCH_S * 8 - dur * 0.6 * _h(site["id"], "start")
        tasks = REPAIRS[site["kind"]]
        repair = {
            "task": tasks[int(_h(site["id"], "task") * 100) % len(tasks)],
            "progress": round(min(0.97, max(0.03, (now - start) / dur)), 3),
            "crew": 3 + int(9 * _h(site["id"], "crew")),
            "eta_days": max(1, int(30 * (1 - min(0.97, (now - start) / dur)) * (0.5 + _h(site["id"], "eta")))),
        }
    if level is None and repair is None:
        return None
    return {"id": site["id"], "status": level or "nominal", "issue": issue, "repair": repair}


def state(live: list[dict], now: float | None = None) -> dict:
    """Current portfolio condition: only non-nominal sites, plus totals, recent events and the live twins."""
    now = time.time() if now is None else now
    conds = [c for s in SITES if (c := _condition(s, now))]
    all_sites = sites()
    sensors = sum(s["sensors"] for s in all_sites) + sum(a["sensors"] for a in live)
    offline = int(sensors * (0.004 + 0.003 * math.sin(now / 300)))
    crit = sum(c["status"] == "critical" for c in conds) + sum(a["status"] == "critical" for a in live)
    watch = sum(c["status"] == "watch" for c in conds) + sum(a["status"] == "watch" for a in live)
    total = len(SITES) + len(live)
    return {
        "t": now,
        "conditions": conds,
        "live": live,
        "events": events(now),
        "summary": {
            "structures": total,
            "countries": len({s["country"] for s in SITES if s["country"]}),
            "sensors": sensors,
            "sensors_online": sensors - offline,
            "critical": crit,
            "watch": watch,
            "nominal": total - crit - watch,
            "repairs": sum(1 for c in conds if c["repair"]),
        },
    }


def events(now: float, n: int = 8) -> list[dict]:
    """The most recent portfolio events, newest first."""
    k = int(now // EVENT_S)
    out = []
    for i in range(k, k - n, -1):
        r = _h("ev-kind", i)
        # mostly news from sites with an issue or a repair; sometimes a routine check elsewhere
        busy = [s for s in SITES if _condition(s, i * EVENT_S)] if r < 0.7 else SITES
        s = busy[int(_h("ev", i) * len(busy))]
        c = _condition(s, i * EVENT_S)
        if c and c["status"] != "nominal" and r < 0.5:
            text, level = c["issue"], c["status"]
        elif c and c["repair"]:
            text, level = f'{c["repair"]["task"]}: {round(c["repair"]["progress"] * 100)}% complete', "repair"
        elif r < 0.75:
            text, level = "Drone inspection completed, no new defects", "info"
        else:
            text, level = "Sensor health check passed", "info"
        out.append({"t": i * EVENT_S, "site_id": s["id"], "name": s["name"], "country": s["country"], "level": level, "text": text})
    return out
