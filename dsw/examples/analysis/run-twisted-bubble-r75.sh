#!/bin/bash
# "Twisted bubble at interface" preset (graphene-md/ui/index.html PRESET_BUBBLE)
# scaled to a 50 nm sheet on a 60 nm substrate, captured in all four engines.
#
# Preset physics kept exactly as authored: Hencky blister R = 5 nm at 100 kPa,
# gas pocket BETWEEN the layers (the substrate stays flat, only the sheet
# lifts), 2 degrees of twist, registry colouring. Only Nnm/Nsubnm change.
set -u
TOOLS="C:/Users/pbog/Dropbox/ACTIVITIES/00 VSCODE/DSW/tools"
OUT="C:/Users/pbog/Dropbox/ACTIVITIES/00 VSCODE/DSW/movies-bubble-r75"
mkdir -p "$OUT"
cd "$TOOLS"

P='{"Nnm":50,"Nsubnm":60,"twistDeg":2,"profile":"bubble","protLoc":"between",
    "bubbleRnm":7.5,"bubbleP":100,"Mxnm":6,"Mynm":6,"Cxnm":0,"Cynm":0,
    "elevMode":"rhrd","targetDz":10,"liftRate":0.01,"holdSteps":500,
    "z0":3.35,"betweenBoost":25,"registry":1,"regGamma":1,"regHeightDamp":0}'
P=$(echo "$P" | tr -d '\n' | tr -s ' ')

echo "=== 1/3 classic (Morse, CPU) ==="
node moviecap.js graphene-md classic "$OUT/cap-classic" "" "$P" || echo "classic FAILED"

echo "=== 2/3 gpu (Morse, OpenCL) ==="
node moviecap.js graphene-md-gpu classic "$OUT/cap-gpu" gpu "$P" || echo "gpu FAILED"

echo "=== 3/3 airebo (embedded LAMMPS) ==="
node moviecap.js graphene-md lammps "$OUT/cap-airebo" "" "$P" || echo "airebo FAILED"

echo "=== captured ==="
for d in "$OUT"/cap-*; do
  echo "  $(basename "$d"): $(ls "$d"/f*.gmd1 2>/dev/null | wc -l) frames"
done
