# Licensing notice for graphene-md

**This bundle is GPL-2.0-or-later, not MIT like the rest of the repository.**

`src/plugin.cpp` calls the LAMMPS C library (`lammps_open`, `lammps_command`,
`lammps_gather_atoms` and friends) and `CMakeLists.txt` links `liblammps`.
LAMMPS is GPL-2.0-or-later, and linking against it makes this combined work a
derivative of it. The full licence text is in `LICENSE` in this folder, copied
verbatim from the LAMMPS distribution it was built against.

In practice:

* You may use, modify and redistribute this plugin under GPL-2.0-or-later.
* If you distribute a built `graphene-md.dll`, you must make the corresponding
  source available on the same terms. That is why the source is here.
* The **toy Morse engine** in this plugin is not itself derived from LAMMPS,
  but it ships in the same binary, so the binary as a whole is GPL. If you want
  the toy model under MIT, take `graphene-md-gpu` - it has no LAMMPS linkage.

`graphene-md-gpu` only *writes* LAMMPS input decks (`src/lmpexport.h`).
Generating text that LAMMPS can read is not linking, so that bundle stays MIT.

## Potentials

`potentials/` holds parameter files taken from the LAMMPS distribution and from
OpenKIM:

| file | potential | source |
|---|---|---|
| `CH.airebo` | AIREBO (C, H) | LAMMPS |
| `BNC.tersoff`, `BN.extep` | Tersoff-BNC, ExTeP for hBN | LAMMPS |
| `MoS.rebomos` | REBO-MoS2 (Liang / Phillpot / Sinnott) | LAMMPS |
| `ws2.jiang3t.sw`, `mote2.jiang3t.sw`, `wte2.jiang3t.sw` | Stillinger-Weber | generated from Jiang & Zhou, arXiv:1704.03147 |
| `WenShirodkarPlechac_2017_MoS2.params` | MoS2 | OpenKIM, see `kimcite-*.bib` |

`LICENSE.CDDL` applies to the files that name it. Cite the original papers if
you publish results that use them.
