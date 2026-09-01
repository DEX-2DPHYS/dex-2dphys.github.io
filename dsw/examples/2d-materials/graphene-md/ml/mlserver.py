"""ML-potential sidecar for graphene-md.

The plugin's "ML potential" engine sends sheet positions over a local socket
and gets forces + energy back; this process owns the model. Keeping the model
in Python means fairchem/UMA (or any ASE calculator) plugs in without linking
2 GB of libtorch into the plugin DLL — and swapping models is a command-line
flag, not a rebuild.

Usage:
    python mlserver.py --model surrogate                # pipeline test, no ML
    python mlserver.py --model uma-s-1p1 --task omat    # real UMA (needs HF login)
    python mlserver.py --model uma-s-1p1 --device cuda  # on the GPU

UMA/fairchem checkpoints are gated on HuggingFace: log in once with
`hf auth login` (token from https://huggingface.co/settings/tokens) after
accepting the model terms at https://huggingface.co/facebook/UMA.

Protocol: newline-delimited JSON on 127.0.0.1:8977.
    {"cmd":"hello"}                    -> {"ok":1,"model":...,"device":...}
    {"cmd":"forces","pos":[x,y,z,...]} -> {"ok":1,"e":eV,"f":[fx,fy,fz,...]}
Positions in Angstrom, energies eV, forces eV/A — ASE conventions, which are
also the plugin's own units. All atoms are carbon (graphene sheet only).
"""
import argparse
import json
import socket
import sys
import time

import numpy as np


class Surrogate:
    """Pure-numpy stand-in so the plugin<->sidecar loop can be validated
    without any gated download. A smooth Morse pair potential — deliberately
    NOT physics to trust, and it says so in its name."""
    name = "surrogate-morse (NOT a real ML potential)"

    def __init__(self):
        self.De, self.a, self.re, self.cut = 1.0, 2.6, 1.42, 1.9

    def compute(self, pos):
        n = len(pos)
        e = 0.0
        f = np.zeros_like(pos)
        # brute-force neighbour search is fine at surrogate scales
        for i in range(n):
            d = pos[i + 1:] - pos[i]
            r = np.linalg.norm(d, axis=1)
            m = (r < self.cut) & (r > 1e-6)
            if not m.any():
                continue
            rm, dm = r[m], d[m]
            ex = np.exp(-self.a * (rm - self.re))
            e += float(np.sum(self.De * (1 - ex) ** 2 - self.De))
            mag = (2 * self.De * self.a * ex * (1 - ex)) / rm
            fv = dm * mag[:, None]
            f[i] += fv.sum(axis=0)
            f[i + 1:][m] -= fv
        return e, f


class FairChem:
    def __init__(self, model, task, device):
        from fairchem.core import pretrained_mlip, FAIRChemCalculator
        t0 = time.time()
        unit = pretrained_mlip.get_predict_unit(model, device=device)
        self.calc = FAIRChemCalculator(unit, task_name=task)
        self.name = f"{model} ({task}, {device})"
        print(f"loaded {self.name} in {time.time() - t0:.1f}s", flush=True)
        self._atoms = None

    def compute(self, pos):
        from ase import Atoms
        if self._atoms is None or len(self._atoms) != len(pos):
            self._atoms = Atoms(numbers=[6] * len(pos), positions=pos, pbc=False)
            self._atoms.calc = self.calc
        else:
            self._atoms.set_positions(pos)
        e = float(self._atoms.get_potential_energy())
        f = np.asarray(self._atoms.get_forces(), dtype=float)
        return e, f


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="surrogate")
    ap.add_argument("--task", default="omat",
                    help="fairchem task head: omat (materials) / omol / oc20")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--port", type=int, default=8977)
    args = ap.parse_args()

    if args.model == "surrogate":
        eng = Surrogate()
    else:
        eng = FairChem(args.model, args.task, args.device)

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", args.port))
    srv.listen(1)
    print(f"ml sidecar: {eng.name} listening on 127.0.0.1:{args.port}", flush=True)

    while True:
        conn, _ = srv.accept()
        print("plugin connected", flush=True)
        buf = b""
        try:
            while True:
                chunk = conn.recv(1 << 20)
                if not chunk:
                    break
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    if not line.strip():
                        continue
                    try:
                        req = json.loads(line)
                    except json.JSONDecodeError:
                        conn.sendall(b'{"ok":0,"err":"bad json"}\n')
                        continue
                    # Compact separators everywhere: the plugin parses replies
                    # by plain string matching, and '"ok": 1' (spaced, the
                    # json.dumps default) versus '"ok":1' already cost one
                    # debugging round.
                    if req.get("cmd") == "hello":
                        conn.sendall((json.dumps(
                            {"ok": 1, "model": eng.name},
                            separators=(",", ":")) + "\n").encode())
                    elif req.get("cmd") == "forces":
                        p = np.asarray(req["pos"], dtype=float).reshape(-1, 3)
                        t0 = time.time()
                        e, f = eng.compute(p)
                        ms = (time.time() - t0) * 1000
                        conn.sendall((json.dumps(
                            {"ok": 1, "e": e, "ms": round(ms, 1),
                             "f": [round(v, 8) for v in f.ravel().tolist()]},
                            separators=(",", ":")) + "\n").encode())
                    else:
                        conn.sendall(b'{"ok":0,"err":"unknown cmd"}\n')
        except (ConnectionResetError, ConnectionAbortedError):
            pass
        finally:
            conn.close()
            print("plugin disconnected", flush=True)


if __name__ == "__main__":
    sys.exit(main())
