"""Pick clear, high-resolution dacl10k images per theme and write demo-media/dacl10k/manifest.json with their expert boxes."""
import json, sys
src, out = sys.argv[1], sys.argv[2]
samples = json.load(open(src))["samples"]
THEMES = {
    "crack": {"Crack", "ACrack"},
    "spalling_rebar": {"Spalling", "ExposedRebars"},
    "efflorescence": {"Efflorescence"},
    "rust_wetspot": {"Rust", "Wetspot"},
    "cavity_hollow": {"Cavity", "Hollowareas", "Rockpocket"},
    "bearing_joint": {"Bearing", "EJoint"},
    "drainage": {"Drainage"},
    "weathering": {"Weathering"},
}
MIN_COVER = {"crack": 0.03, "bearing_joint": 0.03, "drainage": 0.03}
PER_THEME = 8
def info(s):
    dets = s["od_ground_truth"]["detections"]
    labels = [d["label"] for d in dets]
    area = {}
    for d in dets:
        x, y, w, h = d["bounding_box"]
        area[d["label"]] = area.get(d["label"], 0) + w * h
    return labels, area
picked, used = {}, set()
for theme, want in THEMES.items():
    cands = []
    for s in samples:
        m = s.get("metadata") or {}
        if m.get("width", 0) < 1600 or s["filepath"] in used:
            continue
        labels, area = info(s)
        if not labels or len(labels) > 12:
            continue
        cover = sum(area.get(l, 0) for l in want)
        if not want <= set(labels) and theme == "spalling_rebar":
            continue
        if cover < MIN_COVER.get(theme, 0.08):
            continue
        noise = sum(1 for l in labels if l in {"Graffiti", "PEquipment", "JTape", "Restformwork"})
        cands.append((cover - 0.05 * noise, s))
    cands.sort(key=lambda c: -c[0])
    picked[theme] = []
    for _, s in cands[:PER_THEME]:
        used.add(s["filepath"])
        labels, area = info(s)
        picked[theme].append({
            "file": s["filepath"], "width": (s.get("metadata") or {}).get("width"), "height": (s.get("metadata") or {}).get("height"),
            "labels": sorted(set(labels)),
            "boxes": [{"label": d["label"], "bbox_xywh_norm": d["bounding_box"]} for d in s["od_ground_truth"]["detections"]],
        })
json.dump({"source": "Voxel51/dacl10k (Hugging Face mirror of dacl10k, Flotzinger et al., WACV 2024)", "themes": picked}, open(out, "w"), indent=1)
for t, items in picked.items():
    print(t, [(i["file"].split("/")[-1], i["labels"]) for i in items])
