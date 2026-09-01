"""Prepare an exported deck for the benchmark run.

Only run configuration is touched — threads, run length, dump cadence. The
potentials, fixes and driver are left exactly as the plugin wrote them, so this
stays a test of the exporter rather than of my editing.

    python patch_deck.py <dir> [threads] [runsteps]
"""
import io, os, sys

d = sys.argv[1]
threads = sys.argv[2] if len(sys.argv) > 2 else "18"
runsteps = sys.argv[3] if len(sys.argv) > 3 else "2600"

p = os.path.join(d, "run.in")
s = io.open(p, encoding="utf-8", newline="").read()
if not os.path.exists(p + ".asexported"):
    io.open(p + ".asexported", "w", encoding="utf-8", newline="").write(s)

misses = []


def rep(old, new, n=1):
    global s
    if s.count(old) != n:
        misses.append("%r found %d times, wanted %d" % (old[:70], s.count(old), n))
        return
    s = s.replace(old, new)


rep("units metal\n", "package omp %s\nsuffix omp\n\nunits metal\n" % threads)
rep("thermo 100\n", "thermo 50\n")

# one dump for the sheet, a rare one for the substrate: dumping every atom
# often is gigabytes of text and tells you nothing extra.
import re
m = re.search(r"dump traj all custom \d+ traj\.lammpstrj id type x y z\ndump_modify traj sort id\n", s)
if m:
    rep(m.group(0),
        "dump sh sheet custom 250 sheet.lammpstrj id x y z\n"
        "dump_modify sh sort id\n"
        "dump sb sub custom 1250 sub.lammpstrj id x y z\n"
        "dump_modify sb sort id\n")
else:
    misses.append("dump line not found")

m = re.search(r"run \d+\n", s)
if m:
    rep(m.group(0),
        "# the lift cycle completes at step 2497; the tail lets it settle\n"
        "run %s\n" % runsteps)
else:
    misses.append("run line not found")

if misses:
    print("ABORTED, nothing written:")
    for x in misses:
        print("  " + x)
    sys.exit(1)

io.open(p, "w", encoding="utf-8", newline="").write(s)
print("patched", p)
for ln in s.splitlines():
    if any(k in ln for k in ("package omp", "suffix", "dump ", "run ", "pair_style", "group edge")):
        print("   " + ln[:110])
