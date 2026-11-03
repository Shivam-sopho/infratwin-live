from app import fleet

LIVE = [{"id": "B07", "name": "B07", "kind": "bridge", "lng": 0, "lat": 0, "status": "critical", "sensors": 40}]


def test_state_is_deterministic_and_consistent():
    a, b = fleet.state(LIVE, now=1_800_000_000), fleet.state(LIVE, now=1_800_000_000)
    assert a == b
    s = a["summary"]
    assert s["structures"] == len(fleet.SITES) + 1
    assert s["nominal"] + s["watch"] + s["critical"] == s["structures"]
    assert s["critical"] >= 1  # the live twin counts
    assert 0 < s["sensors_online"] <= s["sensors"]
    assert all(c["status"] != "nominal" or c["repair"] for c in a["conditions"])


def test_events_are_newest_first_and_name_real_sites():
    ev = fleet.events(1_800_000_000)
    assert [e["t"] for e in ev] == sorted((e["t"] for e in ev), reverse=True)
    names = {s["name"] for s in fleet.SITES}
    assert all(e["name"] in names for e in ev)


def test_repairs_progress_over_time():
    t0 = 1_800_000_000
    before = {c["id"]: c["repair"]["progress"] for c in fleet.state([], now=t0)["conditions"] if c["repair"]}
    after = {c["id"]: c["repair"]["progress"] for c in fleet.state([], now=t0 + 600)["conditions"] if c["repair"]}
    common = before.keys() & after.keys()
    assert common and all(after[k] >= before[k] for k in common)
