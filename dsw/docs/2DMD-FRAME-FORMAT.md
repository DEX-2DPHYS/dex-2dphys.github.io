# 2DM1 — the 2dmd frame format

Phase 2 of `2DMD-DESIGN.md`. All integers and floats are **little-endian**;
`u32` is 4 bytes, `f32` is 4 bytes. Current version: **2**.

**There is exactly one implementation of this spec:**
`DSW/Plugins/2D Materials/2dmd/ui/dmframe.js`. It runs unchanged in the browser
and in node, so the panel and the analysis scripts read frames through the same
code rather than through two readers that agree until they don't. Do not write a
second parser — import that one.

## Why it replaces GMD1 and MBL1

Both older formats hard-code their atom counts (`n1`, `n2`, `nsub`), so adding a
layer means changing the header, and every reader with it. Registry was bolted on
as a flag bit with an implicit length, which works exactly until a second scalar
is wanted.

Here the layer count is data and every scalar block carries its own length, so a
reader that has never heard of a block can step over it. That is the property
that lets phase 3 add velocity or coordination without touching anything already
written.

## The host prefix

DSW wraps plugin frame payloads, so the magic sits at **offset 0 or offset 12**
depending on the path. Sniff both. The reference reader does.

## Header — 32 bytes

| offset | type | field |
|---|---|---|
| 0 | u32 | magic `0x314D4432` — `'2DM1'` |
| 4 | u32 | version (2) |
| 8 | u32 | flags — bit 0: static layers are included in this frame |
| 12 | u32 | `nLayers`, including the substrate |
| 16 | u32 | frame counter (low 32 bits of the step count) |
| 20 | f32 | potential energy, eV |
| 24 | f32 | kinetic energy, eV |
| 28 | u32 | `nBlocks` — scalar blocks following the positions |

## Layer table — `nLayers` × 8 bytes

| offset | type | field |
|---|---|---|
| +0 | u32 | `n`, atoms in this layer |
| +4 | u32 | `lflags` — bit 0: mobile; bit 1: positions present in THIS frame |

Layer 0 is the rigid substrate. Layers are ordered bottom to top, so layer *k*
sits above layer *k*−1 and gap *g* lies between layers *g* and *g*+1.

## Positions

For each layer with `lflags & 2`, in table order: `n` × (f32 x, f32 y, f32 z),
in ångström.

**A static layer is only sent when the geometry changes.** The substrate is
27 000-odd atoms and never moves, so re-sending it every frame would cost about
330 KB per frame for nothing. A reader must therefore **cache** the last
positions it saw for any layer whose `lflags & 2` is clear. The reference reader
does this for you; hand-rolling it is where this format will bite you.

## Scalar blocks — `nBlocks` of them

Each block is a 16-byte header followed by its data:

| offset | type | field |
|---|---|---|
| +0 | u32 | `kind` — 1 registry, 2 strain; others reserved |
| +4 | u32 | `layerMask` — bit *k* set if layer *k* contributes |
| +8 | u32 | `nValues` — total f32 that follow |
| +12 | u32 | reserved, 0 |
| +16 | f32 × `nValues` | values, concatenated in layer order |

Values run over the layers named in `layerMask`, in table order, `n` values per
layer. Blocks currently cover the mobile layers only.

**An unknown `kind` is skipped by advancing `nValues × 4` bytes.** That is the
whole forward-compatibility story, and it is why `nValues` is mandatory even
though it is derivable from `layerMask`.

### kind 1 — registry

The CSL order parameter of each mobile layer against the layer below it:
`s(r) = Σ cos(G_k · r)` over the three first-shell reciprocal vectors of the
unrotated lattice, mapped to `t = 1 − (s − s_min)/(s_max − s_min)` with
`s_min = −1.5`, `s_max = 3.0`, so **t = 0 on an AA coincidence site and 1 in the
hollow**. Optionally raised to `regGamma`, and optionally faded toward 1 where
the local interlayer gap has opened — inside a blister the layers are far apart
and registry there means nothing.

Requested with `{"t":"params","registry":1}`.

### kind 2 — strain

Mean bond dilatation per atom: `(|r| − |r0|)/|r0|` averaged over the nearest-
neighbour bonds an atom takes part in. `r0` is **measured at build time**, not
assumed to be `re`: the lattice is built at `A_LATT`, so a strain taken against
`re` would report a uniform offset everywhere.

Requested with `{"t":"params","strain":1}`.

## Reading one

```js
const { DMReader } = require(".../2dmd/ui/dmframe.js");
const r = new DMReader();          // one per stream: it caches static layers
const f = r.parse(bytes);
f.version                          // 2
f.frame, f.ePot, f.eKin
f.layers[k].n / .mobile / .pos     // pos is always populated, from cache if needed
f.blocks.registry[k]               // per layer, or undefined if not requested
f.blocks.strain[k]
f.unknownBlocks                    // kinds this reader stepped over
```

## Changing it

Bump `FMT_VERSION` only for a change a version-2 reader could not survive.
Adding a block kind is not such a change — that is the point. If the header ever
has to grow, add fields after `nBlocks` and bump the version, because the layer
table's offset is currently implied by a fixed 32-byte header.
