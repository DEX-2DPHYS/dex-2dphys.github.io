// Selecting a material in 2DMD: does anything actually rebuild?
//
// Peter: "selecting MoS2 (rebo) or any other often reverts the view to
// graphene ... especially large sizes. could it be memory problem?"
//
// It is not memory. The geometry is only rebuilt by a `build` message, and the
// material lives in that message (`material: S.material`) -- but the material
// selector was never bound to a rebuild. Its only change listener is
// applyCapabilities(), which switches the engine and pushes live parameters;
// none of that regenerates the lattice. So the view keeps showing the last
// geometry that WAS built, which is graphene, and picking a dichalcogenide
// appears to "revert".
//
// "Often" rather than "always" is the tell: touching any control in the
// geometry group afterwards (size, layers, twist) does rebuild, and then picks
// up the material from S -- so it works whenever you happen to change something
// else next, and not when you don't. Large sizes make it worse only because
// nothing incidental is quick enough to hide it.
//
// This drives the real panel, selects each material, and records the messages
// the page emits.
//
//   node probe-2dmd-matchange.js

const fs = require("fs"), path = require("path"), os = require("os"),
      cp = require("child_process");

const UI = path.join(__dirname, "..", "Plugins", "2D Materials", "2dmd",
                     "ui", "index.html");
const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find(p => fs.existsSync(p));
if (!CHROME) { console.log("no chrome/edge found"); process.exit(1); }

let html = fs.readFileSync(UI, "utf8");

// Record every message the page sends, and let it believe the socket is open.
html = html.replace('<script src="/dex.js"></script>', `<script>
window.__sent = [];
window.DEX = { pluginId: () => "2dmd",
  connect(o){ window.__opts = o;
    setTimeout(() => o && o.onStatus && o.onStatus("open"), 0);
    return { send(m){ window.__sent.push(m); }, close(){} }; } };
</script>`);
html = html.replace("<head>", '<head><script>window.__err=[];' +
  'addEventListener("error",e=>window.__err.push(e.message));</script>');

html = html.replace("</body>", `<script>addEventListener("load",()=>setTimeout(()=>{
  const out = { err: window.__err, cases: [] };
  const sel = document.getElementById("material");
  for (const mat of ["mos2","ws2","mote2","wte2","hbn"]) {
    window.__sent.length = 0;
    sel.value = mat;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    const sent = window.__sent.slice();
    out.cases.push({ mat,
      types: sent.map(m => m && m.t),
      builtWith: (sent.filter(m => m && m.t === "build").pop() || {}).material || null,
      engine: (sent.filter(m => m && m.engine).pop() || {}).engine || null });
  }
  const p=document.createElement("pre"); p.id="__out";
  p.textContent=JSON.stringify(out); document.body.appendChild(p);
}, 400));</script></body>`);

const tmp = path.join(os.tmpdir(), "2dmd-mat-" + process.pid);
fs.mkdirSync(tmp, { recursive: true });
// The page loads siblings from ui/ (dmframe.js); copying index.html alone makes
// it throw "DM is not defined" before any binding runs, which reads as "the
// page sends nothing" for entirely the wrong reason.
for (const f of fs.readdirSync(path.dirname(UI)))
  if (f !== "index.html")
    fs.copyFileSync(path.join(path.dirname(UI), f), path.join(tmp, f));
const page = path.join(tmp, "page.html");
fs.writeFileSync(page, html, "utf8");

const out = cp.execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox",
  "--window-size=1600,900", "--user-data-dir=" + path.join(tmp, "prof"),
  "--virtual-time-budget=6000", "--dump-dom",
  "file:///" + page.replace(/\\/g, "/")], { encoding: "utf8", maxBuffer: 1 << 28 });

const m = out.match(/<pre id="__out">([\s\S]*?)<\/pre>/);
if (!m) { console.log("probe produced no output"); process.exit(1); }
const R = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));

let bad = 0;
const ck = (n, ok, d) => { console.log("    " + (ok ? "PASS" : "FAIL") + "  " + n +
  (d ? "   " + d : "")); if (!ok) bad++; };

console.log("2DMD: what happens when you pick a material\n");
if (R.err.length) console.log("    page errors: " + R.err.join(" | ") + "\n");
for (const c of R.cases)
  console.log("    " + c.mat.padEnd(7) + "sends [" + (c.types.join(", ") || "nothing") +
    "]   build carried material: " + (c.builtWith || "-"));
console.log("");

for (const c of R.cases) {
  ck("picking " + c.mat + " rebuilds the geometry", c.types.includes("build"),
     c.types.includes("build") ? "" :
     "no build message -- the lattice is never regenerated, so the view keeps the last one");
  if (c.types.includes("build"))
    ck("...and the build carries " + c.mat, c.builtWith === c.mat,
       "build said material=" + c.builtWith);
}

console.log("\n  " + (bad ? bad + " CHECK(S) FAILED"
  : "ALL CLEAR — choosing a material rebuilds with that material"));
process.exit(bad ? 1 : 0);
