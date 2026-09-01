#!/bin/bash
# Two twisted-bubble runs that differ ONLY in where the gas sits.
set -u
T="C:/Users/pbog/Dropbox/ACTIVITIES/00 VSCODE/DSW/tools"; cd "$T"
BASE='"Nnm":30,"Nsubnm":36,"twistDeg":2,"z0":3.35,"zSub":3.35,"bubbleRnm":4,"bubbleP":600,"gasT":300,"gasGap":1.2,"fillRate":0.0006,"gamma":1.2,"stepsPerFrame":60,"substrateOn":1'
for W in between below; do
  OUT="C:/Users/pbog/Dropbox/ACTIVITIES/00 VSCODE/DSW/bilayer-$W"
  echo "=== gas $W ==="
  EVERY=120 MAXSTEP=36000 node moviecap-mb.js "$OUT" "{$BASE,\"gasWhere\":\"$W\"}" || echo "$W FAILED"
done
echo "=== done ==="
for d in "C:/Users/pbog/Dropbox/ACTIVITIES/00 VSCODE/DSW"/bilayer-*; do
  echo "  $(basename "$d"): $(ls "$d"/f*.mbl1 2>/dev/null | wc -l) frames"
done
