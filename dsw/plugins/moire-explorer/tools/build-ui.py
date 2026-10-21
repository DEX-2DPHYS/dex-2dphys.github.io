#!/usr/bin/env python3
"""Turn a standalone Moire Explorer HTML file into this plugin's ui/index.html.

    python3 tools/build-ui.py path/to/moire-explorer-atom-view.html

Applies three changes to the original and writes ../ui/index.html:
  1. injects tools/dsw-shim.html (routes the page's Worker calls to the native core),
  2. relabels the parallel-compute checkbox,
  3. speeds up the synchronous van-der-Waals pair path used by the A -> B relaxation
     (typed-array pair lists, cached element-pair keys, numeric spatial-hash keys).
Every patch must match exactly once, so a newer explorer that changed these
spots fails loudly instead of silently producing a half-patched page.
"""
import os, sys

here = os.path.dirname(os.path.abspath(__file__))
src_path = sys.argv[1]
src = open(src_path, encoding="utf-8").read()
shim = open(os.path.join(here, "dsw-shim.html"), encoding="utf-8").read()


def patch(text, old, new, what):
    n = text.count(old)
    if n != 1:
        sys.exit(f"patch '{what}': expected 1 match, found {n}")
    return text.replace(old, new, 1)


out = patch(src, "<body>", "<body>\n" + shim, "inject shim")
out = patch(out, "Web Workers for CSL, vdW, and A → B path",
            "Parallel compute for CSL, vdW, and A → B path (native under DSW, Web Workers otherwise)",
            "checkbox label")

out = patch(out, '''      function getElementPairKey(a, b) {
        return [a, b].sort().join("-");
      }

      function mixLJParameters(elementA''', '''      const elementPairKeyCache = new Map();
      function getElementPairKey(a, b) {
        let inner = elementPairKeyCache.get(a);
        if (!inner) {
          inner = new Map();
          elementPairKeyCache.set(a, inner);
        }
        let key = inner.get(b);
        if (key === undefined) {
          key = [a, b].sort().join("-");
          inner.set(b, key);
        }
        return key;
      }

      function mixLJParameters(elementA''', "pair-key cache")

a = out.index("      function buildVdwPairList(")
b = out.index("      function getBulkElementDensities(")
new_block = '''      // Pair lists are struct-of-arrays with the pair weight folded into a12/b6:
      // the relaxation evaluates them thousands of times, so this has to be a
      // tight typed-array loop rather than an array of objects.
      function buildVdwPairList(topAtoms, bottomAtoms, topWeight, bottomWeight, cutoff, epsilonScale) {
        const cutoffSafe = Math.max(cutoff, 1e-12);
        const cutoff2 = cutoffSafe * cutoffSafe;
        const cellKey = (ix, iy) => ix * 4294967296 + iy;
        const hash = new Map();
        for (const atom of bottomAtoms) {
          const key = cellKey(Math.floor(atom.x / cutoffSafe), Math.floor(atom.y / cutoffSafe));
          const bucket = hash.get(key);
          if (bucket) {
            bucket.push(atom);
          } else {
            hash.set(key, [atom]);
          }
        }

        const rho2s = [];
        const dzs = [];
        const a12s = [];
        const b6s = [];
        const mixSummary = new Map();
        const mixCache = new Map();
        const pairWeight = topWeight * bottomWeight;

        for (const topAtom of topAtoms) {
          const ix = Math.floor(topAtom.x / cutoffSafe);
          const iy = Math.floor(topAtom.y / cutoffSafe);
          let byBottom = mixCache.get(topAtom.element);
          if (!byBottom) {
            byBottom = new Map();
            mixCache.set(topAtom.element, byBottom);
          }

          for (let dx = -1; dx <= 1; dx += 1) {
            for (let dy = -1; dy <= 1; dy += 1) {
              const candidates = hash.get(cellKey(ix + dx, iy + dy));
              if (!candidates) {
                continue;
              }

              for (const bottomAtom of candidates) {
                const ddx = topAtom.x - bottomAtom.x;
                const ddy = topAtom.y - bottomAtom.y;
                const rho2 = ddx * ddx + ddy * ddy;
                if (rho2 > cutoff2) {
                  continue;
                }

                let mixed = byBottom.get(bottomAtom.element);
                if (!mixed) {
                  mixed = mixLJParameters(topAtom.element, bottomAtom.element, epsilonScale);
                  byBottom.set(bottomAtom.element, mixed);
                  mixSummary.set(getElementPairKey(topAtom.element, bottomAtom.element), mixed);
                }

                rho2s.push(rho2);
                dzs.push(topAtom.z - bottomAtom.z);
                a12s.push(pairWeight * mixed.a12);
                b6s.push(pairWeight * mixed.b6);
              }
            }
          }
        }

        return {
          pairs: {
            length: rho2s.length,
            rho2: Float64Array.from(rho2s),
            dz: Float64Array.from(dzs),
            a12: Float64Array.from(a12s),
            b6: Float64Array.from(b6s),
          },
          mixSummary,
        };
      }

      function evaluateLJPairEnergy(pairs, cutoff, zShift = 0) {
        const cutoff2 = cutoff * cutoff;
        const { length, rho2, dz, a12, b6 } = pairs;
        let total = 0;

        for (let i = 0; i < length; i += 1) {
          const d = dz[i] + zShift;
          const r2 = rho2[i] + d * d;
          if (r2 <= 0 || r2 > cutoff2) {
            continue;
          }

          const invR2 = 1 / r2;
          const invR6 = invR2 * invR2 * invR2;
          total += a12[i] * invR6 * invR6 - b6[i] * invR6;
        }

        return total;
      }

'''
out = out[:a] + new_block + out[b:]

dest = os.path.join(here, "..", "ui", "index.html")
os.makedirs(os.path.dirname(dest), exist_ok=True)
open(dest, "w", encoding="utf-8").write(out)
print("wrote", os.path.normpath(dest), len(out), "bytes")
