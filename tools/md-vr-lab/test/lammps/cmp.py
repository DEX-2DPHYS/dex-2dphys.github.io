# Cross-check of src/materials.js against LAMMPS (pip install lammps; needs libmpich).
#   node test/lammps/export.mjs /tmp/ref.json
#   python3 test/lammps/cmp.py /tmp/ref.json /path/to/lammps/potentials
# Energies and forces agree to ~1e-12 eV (Tersoff graphene/diamond, SW/mod MoS2).
import json, sys, numpy as np
from lammps import lammps
d = json.load(open(sys.argv[1])); P = sys.argv[2].rstrip('/') + '/'
cases = {'graphene': ('tersoff', P+'BNC.tersoff', 'C', {0:'C'}), 'nanodiamond': ('tersoff', P+'SiC_1989.tersoff', 'C', {0:'C'}), 'mos2': ('sw', P+'tmd.sw.mod', 'Mo S', {2:'Mo',3:'S'})}
for name,(style, pf, elems, spmap) in cases.items():
    c = d[name]; types = {k:i+1 for i,k in enumerate(spmap.keys())}
    L = lammps(cmdargs=['-log','none','-screen','none'])
    lx,ly,lz = c['box']; per = c['per']
    L.command('units metal'); L.command('atom_style atomic')
    L.command('boundary ' + ' '.join('p' if p else 'f' for p in per))
    L.command(f'region b block {-5 if not per[0] else 0} {lx+5 if not per[0] else lx} {-5 if not per[1] else 0} {ly+5 if not per[1] else ly} {-5 if not per[2] else 0} {lz+5 if not per[2] else lz}')
    L.command(f'create_box {len(spmap)} b')
    for k,v in spmap.items(): L.command(f'mass {types[k]} {{"C":12.011,"Mo":95.95,"S":32.06}}'.replace('{{','{').replace('}}','}') if False else f'mass {types[k]} ' + str({'C':12.011,'Mo':95.95,'S':32.06}[v]))
    for i in range(c['N']):
        xyz=[c['x'][i],c['y'][i],c['z'][i]]
        for k in range(3):
            if per[k]: xyz[k]=xyz[k]%c['box'][k]
        L.command(f"create_atoms {types[c['sp'][i]]} single {xyz[0]!r} {xyz[1]!r} {xyz[2]!r} units box")
    if style=='tersoff': L.command(f'pair_style tersoff'); L.command(f'pair_coeff * * {pf} {elems}')
    else: L.command('pair_style sw/mod maxdelcs 0.25 0.35'); L.command(f'pair_coeff * * {pf} {elems}')
    L.command('run 0 post no')
    pe = L.get_thermo('pe')
    # atoms are in creation order -> sort by id
    ids = np.array(L.gather_atoms('id',0,1)); f = np.array(L.gather_atoms('f',1,3)).reshape(-1,3)
    f = f[np.argsort(ids)]
    mine = np.stack([c['fx'],c['fy'],c['fz']],1)
    print(f"{name}: N={c['N']}  PE mine {c['PE']:.6f}  LAMMPS {pe:.6f}  dE={c['PE']-pe:.2e} eV   max|dF|={np.abs(f-mine).max():.2e} eV/A  (|F|max {np.abs(mine).max():.2f})")
