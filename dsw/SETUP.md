# Setting up a build environment

You only need this if you want to **build DSW or write a plugin**. To just run
the experiments, download a prebuilt archive from the
[releases page](https://github.com/DEX-2DPHYS/dex-2dphys.github.io/releases) —
no compiler, no CMake, nothing on this page.

Two things are needed to build: a **C++17 compiler** and **CMake ≥ 3.15**.
OpenMP is optional and strongly recommended — without it the heavier cores
(Gray–Scott, graphene MD) run on one thread.

---

## Windows

Install the free **Visual Studio Build Tools** — the compiler without the IDE.
It bundles CMake, so this is the only step:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools ^
  --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Or download it from <https://visualstudio.microsoft.com/downloads/> (scroll to
*Tools for Visual Studio* → *Build Tools*) and tick the **Desktop development
with C++** workload. The full Visual Studio Community edition works too — it is
a superset.

Then build from a **Developer Command Prompt** (or any shell, if CMake and the
compiler are on `PATH`):

```powershell
cd dsw
cmake -B build
cmake --build build --config Release
```

MSVC provides OpenMP 2.0 out of the box; nothing extra to install. Work from a
folder you can write to — your home or projects directory, **not** an admin
shell sitting in `C:\Windows\System32`.

## macOS

The command-line tools give you Apple Clang:

```sh
xcode-select --install
brew install cmake libomp
```

Apple Clang ships **without** OpenMP, which is what `libomp` is for. Point CMake
at it when configuring:

```sh
cd dsw
cmake -B build -DCMAKE_BUILD_TYPE=Release -DOpenMP_ROOT=$(brew --prefix libomp)
cmake --build build -j
```

DSW builds fine without `libomp` — it just runs single-threaded.

## Linux

```sh
sudo apt install build-essential cmake libomp-dev     # Debian / Ubuntu
sudo dnf install gcc-c++ cmake libomp-devel           # Fedora / RHEL
sudo pacman -S base-devel cmake openmp                # Arch
```

```sh
cd dsw
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
```

## Check it worked

```sh
cmake --version          # 3.15 or newer
c++ --version            # any C++17 compiler (cl.exe on Windows)
```

After a build, each experiment's compiled core should sit inside its own bundle
folder — `plugins/graphene-md/graphene-md.so` (`.dll` on Windows, `.dylib` on
macOS) beside its `dex.json` and `ui/`. If a core is missing, that plugin will
be listed but will not open.

There is a smoke test that answers the question properly. Start the host, then:

```sh
node tools/smoke.mjs http://127.0.0.1:8090
```

It opens each plugin's socket, which is what forces the host to load the shared
library and render a frame — proof the build works, rather than proof the files
exist. Needs Node 22 or newer for its built-in WebSocket.

### A note on `-march=native`

Local builds are compiled for the machine that compiles them, which is worth a
noticeable amount on the MD and reaction–diffusion cores. That also means the
binaries are **not portable** — a build from a modern laptop can fault with an
illegal instruction on an older machine. If you intend to pass your build to
someone else, turn it off:

```sh
cmake -B build -DCMAKE_BUILD_TYPE=Release -DDSW_NATIVE_ARCH=OFF
```

The release archives are built this way, which is why building locally is
faster than downloading.

---

# LAMMPS (optional)

Not required by DSW, and nothing in it links against LAMMPS. It is documented
here as a courtesy because it is the natural companion to the graphene MD
experiment: it is the reference implementation of the reactive potentials
(REBO, AIREBO, Tersoff, ReaxFF), and the standard way to check that a
hand-written force field is right is to compare energies and forces against it
on the same configuration.

## Installing

```sh
sudo apt install lammps                    # Debian / Ubuntu
brew install lammps                        # macOS
conda install -c conda-forge lammps        # any OS with conda
```

On **Windows** the practical routes are the prebuilt installers at
<https://packages.lammps.org/windows.html>, or — usually less trouble — running
the Linux build inside WSL2 (`wsl --install`, then the apt line above).

Check it runs:

```sh
lmp -h | head -20        # some builds name it lmp_serial or lmp_mpi
```

## Building it yourself, with the reactive potentials

Distribution packages do not always include the many-body potentials. If
`pair_style airebo` is unknown, build with the **MANYBODY** package — that is
the one carrying REBO, AIREBO, AIREBO-M and Tersoff:

```sh
git clone -b stable https://github.com/lammps/lammps
cd lammps
cmake -B build -S cmake -DCMAKE_BUILD_TYPE=Release -DPKG_MANYBODY=yes
cmake --build build -j
```

Add `-DPKG_MOLECULE=yes -DPKG_KSPACE=yes` for a more generally useful build, or
`-DBUILD_MPI=yes` to run in parallel.

## Where the potential files live

Parameters are separate data files, not compiled in. In a source checkout they
are in `potentials/`; a package install usually puts them under
`/usr/share/lammps/potentials`. The ones relevant to carbon:

| File | Potential |
|------|-----------|
| `CH.airebo` | AIREBO — REBO + Lennard-Jones + torsion |
| `CH.airebo-m` | AIREBO-M — the LJ term replaced by Morse |
| `CH.rebo` | REBO 2nd generation, on its own |
| `BNC.tersoff` | Tersoff for B/N/C |

A minimal graphene input, for a sanity check or as a reference calculation:

```
units           metal
atom_style      atomic
boundary        p p p
read_data       graphene.data
pair_style      airebo 3.0
pair_coeff      * * CH.airebo C
thermo_style    custom step temp pe etotal
run             0
```

`run 0` computes energies and forces without stepping — which is exactly what
you want when checking one implementation against another.

## Why this matters here

The graphene MD experiment currently uses a Morse bond with an explicit
break/re-form rule: fast, stable, and good enough to drape and tear a sheet,
but the bond-breaking threshold is a modelling choice rather than something the
physics decides. Moving that to REBO — with a registry-dependent interlayer
term such as Kolmogorov–Crespi — is the planned upgrade, and LAMMPS is how the
result gets validated. Note that AIREBO's own non-bonded term is plain
isotropic Lennard-Jones, so it improves the in-plane chemistry without
improving interlayer registry; those are two separate fixes.
