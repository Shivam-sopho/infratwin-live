"""Seed data for the demo infrastructure corridor (simulated assets, real-world coordinates).

Component geometry here is a placeholder BIM: simple primitives that the Scan-to-BIM
(Union-Find) stage will later replace with segmented meshes.
"""

from .models import Asset, Component, Geometry, Occluder, Sensor

# kind -> (label, unit, baseline, watch threshold, critical threshold). Higher = worse.
SENSOR_TEMPLATES: dict[str, tuple[str, str, float, float, float]] = {
    "strain": ("Strain", "µε", 180, 320, 450),
    "accel": ("Vibration RMS", "mg", 12, 25, 40),
    "deflection": ("Mid-span deflection", "mm", 8, 18, 28),
    "load": ("Traffic load", "kN", 900, 1600, 2000),
    "convergence": ("Lining convergence", "mm", 2.5, 6, 10),
    "crack_width": ("Crack meter", "mm", 0.15, 0.3, 0.5),
    "uplift": ("Uplift pressure", "kPa", 140, 220, 280),
    "seepage": ("Seepage", "L/min", 18, 35, 50),
    "displacement": ("Crest displacement", "mm", 3, 7, 11),
    "wind": ("Wind speed", "m/s", 6, 18, 25),
    "temperature": ("Air temperature", "°C", 26, 40, 46),
    # KW51 (real data). Raw frequencies are informational; deviations are temperature-compensated residuals.
    "mode3_hz": ("Mode 3 frequency", "Hz", 1.89, 99, 99),
    "mode6_hz": ("Mode 6 frequency", "Hz", 2.93, 99, 99),
    "mode9_hz": ("Mode 9 frequency", "Hz", 4.11, 99, 99),
    "mode13_hz": ("Mode 13 frequency", "Hz", 6.37, 99, 99),
    "mode3_dev": ("Mode 3 deviation (temp-compensated)", "σ", 0.7, 3, 5),
    "mode6_dev": ("Mode 6 deviation (temp-compensated)", "σ", 0.7, 3, 5),
    "mode9_dev": ("Mode 9 deviation (temp-compensated)", "σ", 0.7, 3, 5),
    "mode13_dev": ("Mode 13 deviation (temp-compensated)", "σ", 0.7, 3, 5),
    "steel_temp": ("Steel temperature", "°C", 11, 99, 99),
    "air_temp": ("Air temperature", "°C", 11, 99, 99),
    "humidity": ("Relative humidity", "%", 80, 101, 102),
}

# Sensors that describe the environment / loading rather than structural response;
# injected structural anomalies leave these untouched.
ENVIRONMENTAL_KINDS = {"load", "wind", "temperature", "steel_temp", "air_temp", "humidity"}


class _Builder:
    def __init__(self, asset_id: str):
        self.asset_id = asset_id
        self.components: list[Component] = []
        self.sensors: list[Sensor] = []

    def add(self, cid: str, name: str, kind: str, geometry: Geometry | None, sensor_kinds: list[str]):
        full_id = f"{self.asset_id}.{cid}"
        sensor_ids = []
        for k in sensor_kinds:
            label, unit, baseline, watch, critical = SENSOR_TEMPLATES[k]
            sid = f"{full_id}.{k}"
            self.sensors.append(
                Sensor(
                    id=sid,
                    component_id=full_id,
                    kind=k,
                    label=label,
                    unit=unit,
                    baseline=baseline,
                    watch=watch,
                    critical=critical,
                )
            )
            sensor_ids.append(sid)
        self.components.append(
            Component(id=full_id, asset_id=self.asset_id, name=name, kind=kind, geometry=geometry, sensor_ids=sensor_ids)
        )


def _bridge() -> Asset:
    b = _Builder("B07")
    span, n_spans = 30.0, 7
    half = span * n_spans / 2
    pier_h, girder_h = 14.0, 2.2

    b.add("A1", "Abutment West", "abutment", Geometry(shape="box", position=(-half - 2, 8, 0), size=(4, 16, 14)), ["strain"])
    for i in range(1, n_spans):
        x = -half + span * i
        b.add(
            f"P{i}",
            f"Pier {i}",
            "pier",
            Geometry(shape="box", position=(x, pier_h / 2, 0), size=(2.4, pier_h, 7)),
            ["strain", "accel"],
        )
    for i in range(n_spans):
        x = -half + span * (i + 0.5)
        b.add(
            f"G{i + 1}",
            f"Box Girder {chr(ord('A') + i)}",
            "girder",
            Geometry(shape="box", position=(x, pier_h + girder_h / 2, 0), size=(span - 0.3, girder_h, 11)),
            ["strain", "deflection"],
        )
    b.add(
        "DK",
        "Deck Slab",
        "deck",
        Geometry(shape="box", position=(0, pier_h + girder_h + 0.2, 0), size=(span * n_spans, 0.4, 14)),
        ["load"],
    )
    b.add("A2", "Abutment East", "abutment", Geometry(shape="box", position=(half + 2, 8, 0), size=(4, 16, 14)), ["strain"])
    b.add("WX", "Weather Station", "environment", None, ["wind", "temperature"])

    # Pier 4 front face is at z = 3.5; a drainage downpipe and scaffolding sit just in front of it.
    p4x = -half + span * 4
    occluders = [
        Occluder(
            id="B07.OC1",
            name="Drainage downpipe",
            kind="pipe",
            geometry=Geometry(shape="cylinder", position=(p4x + 0.2, 7, 4.3), size=(0.3, 14, 0)),
        ),
        Occluder(
            id="B07.OC2",
            name="Maintenance scaffolding",
            kind="scaffold",
            geometry=Geometry(shape="box", position=(p4x + 2.6, 4.5, 5.6), size=(2.6, 9, 1.6)),
        ),
    ]

    return Asset(
        id="B07",
        name="Riverside Viaduct B-07",
        type="bridge",
        lng=73.8785,
        lat=18.5395,
        heading_deg=20,
        description="7-span prestressed concrete box-girder viaduct, 210 m, 4-lane highway.",
        components=b.components,
        sensors=b.sensors,
        occluders=occluders,
        uav_home=(p4x + 10, 2.0, 30.0),
    )


def _tunnel() -> Asset:
    t = _Builder("T02")
    ring_len, n_rings, radius = 12.0, 6, 6.0

    t.add("PT", "Portal Headwall", "portal", Geometry(shape="box", position=(0, 5, -0.75), size=(18, 10, 1.5)), ["crack_width"])
    for i in range(n_rings):
        z = ring_len * (i + 0.5)
        t.add(
            f"R{i + 1}",
            f"Arch Ring {i + 1}",
            "arch_ring",
            Geometry(shape="arch", position=(0, 0, z), size=(radius, ring_len - 0.2, 0)),
            ["convergence", "strain"],
        )
    t.add(
        "INV",
        "Invert Slab",
        "invert",
        Geometry(shape="box", position=(0, -0.3, ring_len * n_rings / 2), size=(radius * 2, 0.6, ring_len * n_rings)),
        ["crack_width"],
    )

    return Asset(
        id="T02",
        name="Ghat Section Tunnel T-02",
        type="tunnel",
        lng=73.3700,
        lat=18.7530,
        heading_deg=-35,
        description="Twin-lane NATM road tunnel portal with shotcrete + cast in-situ lining.",
        components=t.components,
        sensors=t.sensors,
    )


def _dam() -> Asset:
    d = _Builder("D01")
    block_w, n_blocks, height, base = 20.0, 8, 40.0, 30.0
    half = block_w * n_blocks / 2

    for i in range(n_blocks):
        x = -half + block_w * (i + 0.5)
        d.add(
            f"M{i + 1}",
            f"Monolith {i + 1}",
            "monolith",
            Geometry(shape="box", position=(x, height / 2, 0), size=(block_w - 0.4, height, base)),
            ["uplift", "displacement"],
        )
    d.add("GAL", "Drainage Gallery", "gallery", None, ["seepage"])

    return Asset(
        id="D01",
        name="Reservoir Gravity Dam D-01",
        type="dam",
        lng=73.7700,
        lat=18.4440,
        heading_deg=80,
        description="Concrete gravity dam, 8 monoliths, 160 m crest, 40 m max height.",
        components=d.components,
        sensors=d.sensors,
    )


def _kw51() -> Asset:
    """Illustrative geometry of the KW51 steel bowstring railway bridge; sensor values come from replay."""
    k = _Builder("KW51")
    span, deck_y = 110.0, 6.0
    k.add("DECK", "Deck", "deck", Geometry(shape="box", position=(0, deck_y, 0), size=(span, 1.4, 12)),
          ["mode3_hz", "mode3_dev", "mode6_hz", "mode6_dev", "steel_temp"])
    k.add("ARN", "Arch North", "arch_rib", Geometry(shape="arch_rib", position=(0, deck_y + 0.7, -5.5), size=(span, 20, 1.2)),
          ["mode9_hz", "mode9_dev"])
    k.add("ARS", "Arch South", "arch_rib", Geometry(shape="arch_rib", position=(0, deck_y + 0.7, 5.5), size=(span, 20, 1.2)),
          ["mode13_hz", "mode13_dev"])
    k.add("BW", "Bearings West", "abutment", Geometry(shape="box", position=(-span / 2 - 1.5, deck_y / 2, 0), size=(3, deck_y, 13)), [])
    k.add("BE", "Bearings East", "abutment", Geometry(shape="box", position=(span / 2 + 1.5, deck_y / 2, 0), size=(3, deck_y, 13)), [])
    k.add("WX", "Weather Station", "environment", None, ["air_temp", "humidity", "wind"])
    return Asset(
        id="KW51",
        name="Railway Bridge KW51 (real data)",
        type="bridge",
        lng=4.6905,
        lat=50.8875,
        heading_deg=-30,
        description="Steel bowstring railway bridge near Leuven, Belgium. Diagonal-to-arch/deck connections were "
        "strengthened May-Sep 2019. Modal frequencies are global; they are grouped onto members here for display.",
        components=k.components,
        sensors=k.sensors,
        uav_home=(20.0, 2.0, 35.0),
        region="Leuven (real data)",
        data_source="replay",
        data_note="Real monitoring data, replayed: KW51, Oct 2018 - Jan 2020 (Maes & Lombaert, Zenodo 3745914, CC BY-NC-SA 4.0). "
        "Location approximate.",
    )


def build_corridor(include_kw51: bool = False) -> list[Asset]:
    assets = [_bridge(), _tunnel(), _dam()]
    return assets + [_kw51()] if include_kw51 else assets
