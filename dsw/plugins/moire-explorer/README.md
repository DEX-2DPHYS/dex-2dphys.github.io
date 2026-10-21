# Moiré Explorer — DSW plugin

The atom-view moiré explorer (twisted 2D stacks and perovskites, CSL, LJ
interface energy, A → B energy path) as a DSW experiment.

The page is the original explorer, unchanged in behaviour: drawing, controls
and bookkeeping stay in the browser. What moves into the native core
(`src/plugin.cpp`, OpenMP) are the two kernels the page used to hand to Web
Workers — the Lennard-Jones interface energy scan and the CSL matcher. A
small shim in the page (`tools/dsw-shim.html`) replaces `window.Worker`, so
every existing `new Worker(...)` call in the explorer is answered by the
native core while DSW is connected. Open `ui/index.html` as a plain file
and the real Web Workers are used instead; the badge in the bottom-right
corner says which backend is active.

## Install

```sh
cd dsw
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
./dsw        # http://127.0.0.1:8090/  ->  Moiré Explorer
```

Needs CMake ≥ 3.15 and a C++17 compiler; OpenMP is picked up automatically
(`OMP_NUM_THREADS` limits the thread count). To install it into an existing
DSW, copy this folder into its `plugins/`, add `dsw_add_plugin(moire-explorer)`
to `CMakeLists.txt`, rebuild, restart the host.

## Updating the explorer

`ui/index.html` is generated from the standalone page:

```sh
python3 plugins/moire-explorer/tools/build-ui.py path/to/moire-explorer-atom-view.html
```

The script injects the shim, and swaps in faster typed-array versions of the
synchronous LJ pair-list code. Each patch must match exactly once, so a
changed explorer fails loudly rather than half-patching.

## What is and isn't accelerated

* **Native + OpenMP:** the vdW scan / current-gap energy (`vdwTile`,
  `vdwWhole`) used by the interface plot, the pair-mode and random A → B
  paths, and the CSL tile matcher. Results are checked against the page's
  own worker code (same pair counts, energies to ~1e-13 relative, identical
  CSL candidates).
* **Faster JS, still on the UI thread:** the default A → B mode
  ("z-relax per step", per-layer full stack) relaxes the stack with
  synchronous calls and cannot use a native round trip without being
  rewritten as async. Its pair evaluation is now typed-array based.
* **GPU:** not used. The DSW ABI is native CPU code, the LJ kernel is
  ~10⁶ pair evaluations per call, and a CUDA/OpenCL backend would add a
  toolchain dependency that I could not test here.
