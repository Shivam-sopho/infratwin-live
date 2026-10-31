#!/usr/bin/env bash
# Download the real datasets used by the app into demo-media/ (git-ignored; never redistributed).
#   - dacl10k bridge-inspection images + expert labels (Hugging Face mirror Voxel51/dacl10k)
#   - KW51 railway bridge tracked modes + Oct 2018 train passages (Zenodo 10.5281/zenodo.3745914, CC BY-NC-SA 4.0)
#   - KW51 finite-element model and blueprints (Zenodo 10.5281/zenodo.17366772, CC BY-NC-SA 4.0)
set -euo pipefail
cd "$(dirname "$0")/.."
HF=https://huggingface.co/datasets/Voxel51/dacl10k/resolve/main

mkdir -p demo-media/dacl10k/images demo-media/kw51
echo "dacl10k: annotations (64 MB)…"
[ -f demo-media/dacl10k/samples.json ] || curl -fsSL -o demo-media/dacl10k/samples.json "$HF/samples.json"
python3 -I scripts/select_dacl10k.py demo-media/dacl10k/samples.json demo-media/dacl10k/manifest.json >/dev/null
echo "dacl10k: selected images…"
python3 -I -c "import json; m=json.load(open('demo-media/dacl10k/manifest.json')); print('\n'.join(i['file'] for v in m['themes'].values() for i in v))" |
  while read -r f; do
    out="demo-media/dacl10k/images/$(basename "$f")"
    [ -f "$out" ] || curl -fsSL -o "$out" "$HF/$f"
  done

echo "KW51: tracked modes (13 MB)…"
if [ ! -f demo-media/kw51/trackedmodes/trackedmodes/trackedmodes.mat ]; then
  curl -fsSL -o demo-media/kw51/trackedmodes.zip "https://zenodo.org/records/3745914/files/trackedmodes.zip"
  unzip -oq demo-media/kw51/trackedmodes.zip -d demo-media/kw51/trackedmodes
fi
echo "KW51: finite-element model + blueprints (5 MB)…"
mkdir -p demo-media/kw51/fe_model
for f in readme.txt model_kw51.m modal_analysis.m select_sensors.m simulate_trainpassage.m xrail_2_P.m overview.pdf blueprints.zip; do
  [ -f "demo-media/kw51/fe_model/$f" ] || curl -fsSL -o "demo-media/kw51/fe_model/$f" "https://zenodo.org/records/17366772/files/$f"
done
unzip -oq demo-media/kw51/fe_model/blueprints.zip -d demo-media/kw51/fe_model/blueprints

echo "KW51: train passages, Oct 2018 (187 MB)…"
if [ ! -d demo-media/kw51/traindata/traindata_201810 ]; then
  curl -fsSL -o demo-media/kw51/traindata_201810.zip "https://zenodo.org/records/3745914/files/traindata_201810.zip"
  unzip -oq demo-media/kw51/traindata_201810.zip -d demo-media/kw51/traindata
fi
echo "Done. Restart the backend to load KW51 and the sample library."
