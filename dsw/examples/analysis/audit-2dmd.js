// Which of 2DMD's controls actually do anything?
//
// The panel is graphene-md's, grafted onto a different core. Three faults have
// already come from that: the render loop died formatting a field the core does
// not send, Elevate did nothing, and the material selector is ignored. Fixing
// them one report at a time is the wrong shape of work -- this checks all of
// them at once, mechanically.
//
// It cross-references three things:
//   * every control id in the panel
//   * every key the page SENDS (physicsMsg, the build message, coreSend calls)
//   * every key the core READS (num("..."), get_str(m, "..."))
//
// A control that sends a key the core never reads is a control that lies. A key
// the core reads that nothing sends is a dead parameter. Both are reported.
//
//   node audit-2dmd.js

const fs = require("fs"), path = require("path");
const BASE = path.join(__dirname, "..", "Plugins", "2D Materials", "2dmd");
const ui = fs.readFileSync(path.join(BASE, "ui", "index.html"), "utf8");
const core = fs.readFileSync(path.join(BASE, "src", "plugin.cpp"), "utf8");

// ---- what the core reads ---------------------------------------------------
const reads = new Set();
for (const m of core.matchAll(/\bnum\("([A-Za-z0-9_]+)"/g)) reads.add(m[1]);
for (const m of core.matchAll(/get_num\(m,\s*"([A-Za-z0-9_]+)"/g)) reads.add(m[1]);
for (const m of core.matchAll(/get_str\(m,\s*"([A-Za-z0-9_]+)"/g)) reads.add(m[1]);
const types = new Set();
for (const m of core.matchAll(/t\s*==\s*"([a-z]+)"/g)) types.add(m[1]);

// ---- what the page sends ---------------------------------------------------
// keys appearing as `name:` inside physicsMsg / the build message, plus any
// explicit {t:'...'} sends
const sends = new Map();          // key -> where it was seen
const grab = (block, where) => {
  for (const m of block.matchAll(/(?:^|[\s{,])([A-Za-z0-9_]+)\s*:/g)) {
    const k = m[1];
    if (k === "t" || k === "q") continue;
    if (!sends.has(k)) sends.set(k, where);
  }
};
const pm = ui.match(/function physicsMsg\(\)\s*\{[\s\S]*?\n\}/);
if (pm) grab(pm[0], "physicsMsg");
const bm = ui.match(/const msg = Object\.assign\(\{t:'build'[\s\S]*?\}, physicsMsg\(\)\);/);
if (bm) grab(bm[0], "build");
for (const m of ui.matchAll(/coreSend\(\{\s*t:\s*'([a-z]+)'([^}]*)\}/g)) {
  types.add("__sent_" + m[1]);
  if (m[2]) grab("{" + m[2] + "}", "coreSend " + m[1]);
}
const sentTypes = new Set();
for (const m of ui.matchAll(/t:\s*['"]([a-z]+)['"]/g)) sentTypes.add(m[1]);

// ---- the panel's controls --------------------------------------------------
const ids = new Set();
for (const m of ui.matchAll(/<(?:input|select|button|canvas)[^>]*\bid="([A-Za-z0-9_]+)"/g))
  ids.add(m[1]);

// controls that are legitimately page-only: they change the view, not the model
const LOCAL = new Set(["zoom","tilt","azim","zex","zsep","zsepAuto","atomSize","regCell",
  "colorMode","showSel","showSub","bigHud","themeChk","histBins","histMin","histMax",
  "histAuto","histCanvas","view","kpi","status","siminfo","siminfo-bubble","panel",
  "recBtn","recStopBtn","recV","downloadBtn","btnSave","btnLoad","rebuildBtn","resetBtn",
  "runBtn","stepBtn","gasBtn","quickBtn","pinPanel","themeBtn","centerBtn","presetSelect",
  "lmpExportBtn","elevStop","engineNote","engineHint","engineErr","profHint","gAna",
  "histStats","strainRed","regGamma","sheetColor","pointsMode","stage","c","coreState",
  "elevBtn","recSaveBtn","recStartBtn","maxV","histBar","dark","play","step1","kick",
  "reset","rebuild","scale"]);

console.log("2DMD control audit\n");
console.log("  core message types handled: " + [...types].filter(t=>!t.startsWith("__")).sort().join(", "));
console.log("  page sends types:           " + [...sentTypes].sort().join(", "));
const deadTypes = [...sentTypes].filter(t => !types.has(t));
if (deadTypes.length) console.log("  *** SENT BUT NOT HANDLED: " + deadTypes.join(", "));

console.log("\n  Keys the page sends that the core never reads (a control that lies):");
let lies = 0;
for (const [k, where] of [...sends].sort()) {
  if (!reads.has(k)) { console.log("    " + k.padEnd(16) + " (from " + where + ")"); lies++; }
}
if (!lies) console.log("    none");

console.log("\n  Keys the core reads that nothing sends (dead parameters):");
let dead = 0;
for (const k of [...reads].sort())
  if (!sends.has(k)) { console.log("    " + k); dead++; }
if (!dead) console.log("    none");

console.log("\n  Panel controls with no obvious wiring (neither view-only nor sent):");
let orphan = 0;
for (const id of [...ids].sort()) {
  if (LOCAL.has(id) || sends.has(id)) continue;
  // a control may be read by name inside the page rather than sent
  const used = new RegExp("[\"'#]" + id + "[\"']").test(ui) ||
               new RegExp("\\b" + id + "\\b").test(ui.replace(/id="[^"]*"/g, ""));
  console.log("    " + id.padEnd(16) + (used ? "(referenced in the page)" : "(NOT REFERENCED)"));
  orphan++;
}
if (!orphan) console.log("    none");

console.log("\n  " + lies + " lying, " + dead + " dead, " + orphan + " unclear");
