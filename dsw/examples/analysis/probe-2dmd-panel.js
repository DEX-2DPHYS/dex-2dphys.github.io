// Does the 2DMD panel offer what the core can actually build?
//
// The core grew a material table and every material built and ran, verified by
// probe-2dmd-materials.js -- and the panel still had the four dichalcogenides
// `disabled` with the label "trilayer, not supported", because nothing had told
// it otherwise. The port was real and invisible. That is the same class as
// Photo-Synth's Q factor: a thing can work perfectly and look broken, and only
// a check that reads the PANEL catches it.
//
// So this asserts the two halves agree:
//   * every material in the core's table is offered, and offered enabled
//   * picking a trilayer moves the engine to LAMMPS by itself, because the
//     Morse model has one bond length and a 2.4 A M-X bond sits an angstrom up
//     the exponential
//
// It parses the page rather than driving it: no host, no browser, so it can run
// in a second after any edit.
//
//   node probe-2dmd-panel.js

const fs = require("fs"), path = require("path");
const BASE = path.join(__dirname, "..", "Plugins", "2D Materials", "2dmd");
const ui = fs.readFileSync(path.join(BASE, "ui", "index.html"), "utf8");
const core = fs.readFileSync(path.join(BASE, "src", "plugin.cpp"), "utf8");

let bad = 0;
const ck = (n, ok, d) => { console.log("    " + (ok ? "PASS" : "FAIL") + "  " + n +
  (d ? "   " + d : "")); if (!ok) bad++; };

console.log("2DMD panel vs core\n");

// ---- what the core's table holds, and which need LAMMPS --------------------
const tbl = core.match(/const MatSpec MATS\[\][\s\S]*?\n\};/);
if (!tbl) { console.log("  MATS table not found in the core"); process.exit(1); }
const coreMats = [...tbl[0].matchAll(/\{\s*"([a-z0-9]+)"/g)].map(m => m[1]);
// a trilayer is flagged in its row; the rows carry `true` for the trilayer bool
const triCore = [];
for (const row of tbl[0].split(/\n\s*\{\s*"/).slice(1)) {
  const key = row.match(/^([a-z0-9]+)/);
  if (key && /\btrue\b/.test(row.split("//")[0])) triCore.push(key[1]);
}
console.log("  core builds:   " + coreMats.join(", "));
console.log("  trilayers:     " + triCore.join(", ") + "\n");

// ---- what the panel offers -------------------------------------------------
const sel = ui.match(/<select id="material">[\s\S]*?<\/select>/);
if (!sel) { console.log("  material selector not found"); process.exit(1); }
const opts = [...sel[0].matchAll(/<option([^>]*)value="([a-z0-9]+)"/g)]
  .map(m => ({ key: m[2], disabled: /\bdisabled\b/.test(m[1]) }));

for (const k of coreMats) {
  const o = opts.find(x => x.key === k);
  ck("offered: " + k, !!o && !o.disabled,
     !o ? "the core builds it and the panel does not list it"
        : o.disabled ? "listed but DISABLED -- the core builds this" : "");
}
for (const o of opts)
  ck("no phantom: " + o.key, coreMats.includes(o.key),
     coreMats.includes(o.key) ? "" : "offered but the core has no such material");

// the selector must not be greyed wholesale by the capability map
const absent = ui.match(/const ABSENT = \{[\s\S]*?\};/);
ck("the selector is live", !!absent && !/\bmaterial:/.test(absent[0]),
   "`material` in ABSENT greys the whole control");

// ---- picking a trilayer must move the engine -------------------------------
// Anchored on the block's own last statement rather than on a call inside
// it: the forcing logic changed shape when the fast engine became general,
// and a regex tied to its innards reported "the TRI block is gone" for a
// block that was right there.
const blk = ui.match(/const TRI = \{[\s\S]*?alloyRow'\)[^\n]*\n  \}/);
if (!blk) { ck("engine forcing present", false, "the TRI block is gone"); }
else {
  const run = mat => {
    const options = [{ value: "classic", textContent: "", disabled: false },
                     { value: "lammps", textContent: "", disabled: false },
                     { value: "ml" }];
    const eng = { value: "classic", options };
    const q = id => id === "material" ? { value: mat }
                  : id === "engine" ? eng : null;
    let pushed = 0; const pushParams = () => pushed++;
    eval(blk[0]);
    return { engine: eng.value, classicDisabled: options[0].disabled,
             lammpsDisabled: !!options[1].disabled };
  };
  // The contract INVERTED once the fast model became material-general: rest
  // lengths now come from the lattice as built, so a dichalcogenide is no
  // longer born under strain and runs on the Morse engine. The only constraint
  // left is the alloy, and it points the other way -- no published Mo-W-Te
  // potential exists, so LAMMPS cannot take it.
  const alloyCore = [...core.matchAll(/\{"(\w+)"[\s\S]*?true\},/g)]
    .map(m => m[1]).filter(k => /mowte2/.test(k));
  for (const k of coreMats) {
    const r = run(k), fastOnly = alloyCore.includes(k);
    ck((fastOnly ? "alloy " : "") + k,
       fastOnly ? (r.engine === "classic" && r.lammpsDisabled)
                : (!r.classicDisabled && !r.lammpsDisabled),
       fastOnly ? "must fall back to the fast engine: no Mo-W-Te potential exists"
                : "must offer both engines now that the fast model is general");
  }
}

// ---- the page state must agree with the markup it displays ---------------
// physicsMsg sends S, not the DOM, so a value that differs between them is a
// value the panel displays and never runs. That is what made Run detonate:
// the dt input said 0.5 fs and S.dtFs said 1, and with the integrator units
// bug that difference was the whole explosion.
const Sblk = ui.match(/const S = \{[\s\S]*?\n\};/);
const domVal = {};
for (const m of ui.matchAll(/<input([^>]*)id="([A-Za-z0-9_]+)"([^>]*)>/g)) {
  const v = (m[1] + m[3]).match(/value="([^"]*)"/);
  if (v && v[1] !== "" && isFinite(Number(v[1]))) domVal[m[2]] = Number(v[1]);
}
// S names the timestep dtFs while its control is dt; everything else matches
const ALIAS = { dtFs: "dt" };
let compared = 0;
if (Sblk) {
  const re = /(?:^|[\s,{])([A-Za-z0-9_]+)\s*:\s*(-?[0-9.]+)\s*[,}]/gm;
  for (const m of Sblk[0].matchAll(re)) {
    const key = m[1], id = ALIAS[key] || key;
    if (!(id in domVal)) continue;
    compared++;
    ck("S." + key + " matches its " + id + " control",
       Number(m[2]) === domVal[id],
       Number(m[2]) === domVal[id] ? ""
         : "S says " + m[2] + ", the panel shows " + domVal[id] +
           " -- physicsMsg sends S, so the panel is lying");
  }
}
ck("the two default sets were actually compared", compared > 0,
   compared + " shared value(s)");

// a duplicate id means q(id) answers for one control and the other is furniture
const seenId = {}, dup = [];
for (const m of ui.matchAll(/<(?:input|select)[^>]*\bid="([A-Za-z0-9_]+)"/g))
  { if (seenId[m[1]]) dup.push(m[1]); seenId[m[1]] = 1; }
ck("no duplicate control ids", dup.length === 0, dup.join(", "));

console.log("\n  " + (bad ? bad + " CHECK(S) FAILED"
  : "ALL CLEAR — the panel offers exactly what the core builds"));
process.exit(bad ? 1 : 0);
