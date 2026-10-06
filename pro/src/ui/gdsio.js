// GDSII import / export dialogs. The work is in core/gds; this file only asks and reports.
//
// Import: pick a .gds, see what is in it, optionally add a dose table ("Dose Layer"
// text) so a corrected file is simulated with its doses, then replace the layout (the PSF and the
// other settings are kept).
// Export: the layout as drawn ("design"), or the fractured writing data as dose classes
// (layer = datatype = class, plus the dose table).

import { $, esc, toast, openModal, readFile, busyStep, busyDone, BIG_FILE } from './dom.js';
import { readGds, parseDoseTable } from '../core/gds/read.js';
import { findExactDuplicates } from '../core/gds/dedupe.js';
import { writeGds } from '../core/gds/write.js';
import { makeProject } from '../core/project.js';

// a file picked and read (with the loading panel for a large one); cb(data, name, big)
function pick(accept, binary, cb) {
  const inp = $('fileInput');
  inp.accept = accept; inp.value = '';
  inp.onchange = async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    let data;
    try { data = await readFile(f, binary); } catch (e) { alert(`Could not read ${f.name}:\n${e.message}`); return; }
    try { await cb(data, f.name, f.size >= BIG_FILE); } finally { busyDone(); }
  };
  inp.click();
}
function save(name, data, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const summarise = (report) => {
  const els = Object.entries(report.elements).map(([k, v]) => `${v.toLocaleString()} ${k}`).join(', ') || 'no elements';
  const skipped = Object.entries(report.skipped).map(([k, v]) => `${v} ${k}`).join(', ');
  const layers = Object.entries(report.layers).map(([k, v]) => `${k} (${v.toLocaleString()})`).join(', ');
  return `<b>${report.structures}</b> structure${report.structures === 1 ? '' : 's'}, top <b>${esc(report.top)}</b> · ${esc(els)}`
    + `<br>Layers: ${esc(layers || '—')}`
    + `<br>Database unit ${report.units ? (report.units.dbuMeters * 1e9).toPrecision(6) + ' nm' : '?'} → stored on the 1 nm grid`
    + (skipped ? `<br><span style="color:#b45309">Skipped: ${esc(skipped)}</span>` : '')
    + (report.warnings.length ? `<br><span style="color:#b45309">${report.warnings.map(esc).join('<br>')}</span>` : '');
};

export function installGdsIO(app, { setProject }) {
  $('btnImportGds').onclick = () => pick('.gds,.gds2,.gdsii,application/octet-stream', true, async (bytes, name, big) => {
    let table = null, tableName = '';
    // The file is read once (for the summary); Import only sets the doses on that library, which is
    // what a second read with the dose table would give. Large files are not parsed twice.
    const read = () => {
      const nom = +$('gdsNom').value || 100, { library, report } = first, missing = new Set();
      for (const c of Object.values(library.cells)) for (const s of c.shapes) {
        s.dose = nom;
        if (!table) { s.writeDose = null; continue; }
        const rel = table.get(parseInt(s.layer, 10));
        if (rel == null) missing.add(parseInt(s.layer, 10));
        s.writeDose = (rel ?? 1) * nom;
      }
      if (table) for (const l of library.layers) { const L = parseInt(l.key, 10), rel = table.get(L); if (rel != null && l.purpose === 'exposure') l.name = `Layer ${l.key} · dose ×${rel}`; }
      if (missing.size) report.warnings.push(`layer${missing.size > 1 ? 's' : ''} ${[...missing].join(', ')} not in the dose table: written at the nominal dose`);
      return { library, report };
    };
    let first;
    try { first = await busyStep(big, `Reading the GDS structures of <b>${esc(name)}</b>…`, () => readGds(bytes, { nominalDose: app.nominalDose() })); } catch (e) { busyDone(); alert(`Could not read ${name}:\n${e.message}`); return; }
    busyDone();
    const bigFile = big;
    openModal({
      title: `Import ${name}`,
      narrow: false,
      html: `<div class="hint" id="gdsSum">${summarise(first.report)}</div>
        <div class="two" style="margin-top:10px;"><div><div class="label">Nominal dose (µC/cm²) <span class="q" data-tip="The target dose every imported shape gets.">?</span></div><input class="field" id="gdsNom" type="number" value="${app.nominalDose()}" min="0" step="10"></div>
        <div><div class="label">Dose table (optional) <span class="q" data-tip="For a proximity-corrected file from a correction program (BEAMER, for example): the text file with &quot;Dose Layer&quot; lines. Each shape then keeps the nominal dose as its target and gets the relative dose of its layer as its writing dose, so the Exposure tab shows what the corrected file delivers.">?</span></div>
        <div class="row"><button class="btn small" id="gdsTable">Choose…</button><span class="hint" id="gdsTableName">none</span></div></div></div>
        <div class="hint" style="margin-top:8px;">Importing replaces the current layout. The PSF and the other settings are kept.</div>`,
      onOpen: (box) => {
        box.querySelector('#gdsTable').onclick = () => pick('.txt,.csv,text/plain', false, (text, tname) => {
          try { table = parseDoseTable(text); tableName = tname; box.querySelector('#gdsTableName').textContent = `${tname}: ${table.size} layers, ×${Math.min(...table.values())}–×${Math.max(...table.values())}`; }
          catch (e) { alert(`${tname}: ${e.message}`); }
        });
      },
      buttons: [{ label: 'Cancel' }, { label: 'Import', primary: true, fn: () => { setTimeout(() => importIt(), 0); } }],
    });
    // after the dialog has closed: the steps that take seconds on a large file, each announced first
    async function importIt() {
        let got;
        try { got = read(); } catch (e) { alert(`Could not import ${name}:\n${e.message}`); return; }
        const dups = await busyStep(bigFile, 'Looking for exact duplicates…', () => findExactDuplicates(got.library));
        busyDone();
        const finish = async (removed) => {
          try {
            await busyStep(bigFile, `Building the layout of <b>${esc(name)}</b>…`, () => {
            if (removed) dups.remove();
            const { library, report } = got;
            const p = { ...makeProject(), library, psf: app.project.psf, settings: app.project.settings || {} };
            setProject(p, name.replace(/\.gds\w*$/i, '') + '.ebw.json', { fit: true });
            const n = Object.values(library.cells).reduce((t, c) => t + c.shapes.length, 0);
            toast(`Imported <b>${esc(name)}</b>: ${n.toLocaleString()} shapes in ${report.structures} structure${report.structures === 1 ? '' : 's'}${table ? `, doses from ${esc(tableName)}` : ''}.`
              + (removed ? ` ${dups.count.toLocaleString()} exact duplicate${dups.count > 1 ? 's' : ''} deleted.` : dups.count ? ` ${dups.count.toLocaleString()} exact duplicate${dups.count > 1 ? 's' : ''} kept.` : '')
              + (report.warnings.length ? ' ' + report.warnings.length + ' note(s) — see the import dialog.' : ''), 6000);
            });
          } catch (e) { alert(`Could not import ${name}:\n${e.message}`); }
          finally { busyDone(); }
        };
        if (!dups.count) { finish(false); return; }
        duplicateDialog(dups, finish);
    }
  });

  // Exact duplicates: say how many, offer to delete them (the default), explain on request.
  function duplicateDialog(dups, finish) {
    const n = dups.count, s = n > 1 ? 's' : '';
    const fmt = (v) => (v / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });
    const layerList = (L) => L.length > 6 ? `${L.slice(0, 5).map(esc).join(', ')} … (${L.length} layers)` : L.map(esc).join(', ');
    const rows = dups.groups.slice(0, 8).map((g) => `<tr><td>${esc(g.cell)}</td><td>(${fmt(g.x)}, ${fmt(g.y)})</td><td style="text-align:right">${g.copies}</td><td>${layerList(g.layers)}</td><td style="text-align:right">${g.placed > 1 ? '×' + g.placed.toLocaleString() : g.placed ? '1' : 'unused'}</td></tr>`).join('');
    const worst = dups.groups[0];
    openModal({
      title: 'Exact duplicates',
      narrow: false,
      html: `<div id="dupMain">I found <b>${n.toLocaleString()}</b> exact duplicate${s} and will delete ${n > 1 ? 'them' : 'it'}.</div>
        <div class="hint" style="margin-top:4px;">Shape${s} identical in outline and position to another shape of the same cell, on exposed layers${dups.crossLayer ? ` (${dups.crossLayer.toLocaleString()} on a different layer from the copy kept)` : ''}. One copy of each is kept. Worst: <b>${worst.copies}</b> copies at (${fmt(worst.x)}, ${fmt(worst.y)}) µm in cell ${esc(worst.cell)}${worst.placed > 1 ? `, placed ${worst.placed.toLocaleString()} times` : ''}.</div>
        <div id="dupMore" hidden style="margin-top:10px;font-size:12px;line-height:1.4;">
          <p style="margin:0 0 6px;"><b>Why delete them.</b> The writer exposes every shape it is given, so a spot drawn ${worst.copies} times gets ${worst.copies} × the dose. The proximity correction cannot take that back: it can lower a shape's own dose only to the floor, and the copies around it still deliver too much (the Exposure tab then reports them as <i>held at the dose limit</i>).</p>
          <p style="margin:0 0 6px;"><b>Where they come from.</b> Usually CAD bookkeeping: markers that give every layer the chip's extent (a small square at each corner on each layer), or a shape pasted twice.</p>
          <p style="margin:0 0 6px;"><b>When to keep them (Cancel).</b> If your layers are written in separate exposures — different resist steps, not one write — copies on different layers are not exposed together and nothing is doubled. Cancel imports the file as it is, duplicates included; you can still delete them by hand.</p>
          <p style="margin:0 0 6px;"><b>What is kept.</b> The first copy in the file, on its own layer. Only the imported layout changes; the .gds file is not touched.</p>
          <table style="border-collapse:collapse;width:100%;font-size:11.5px;" class="duptable"><tr style="text-align:left;color:var(--muted,#666)"><th>Cell</th><th>Position (µm, in the cell)</th><th style="text-align:right">Copies</th><th>Layers</th><th style="text-align:right">Placed</th></tr>${rows}</table>
          ${dups.groups.length > 8 ? `<div class="hint">… and ${(dups.groups.length - 8).toLocaleString()} more place${dups.groups.length - 8 > 1 ? 's' : ''}.</div>` : ''}
        </div>`,
      buttons: [
        { label: 'Cancel', fn: () => finish(false) },
        { label: 'Tell me more', fn: (box) => { const m = box.querySelector('#dupMore'); m.hidden = !m.hidden; return false; } },
        { label: 'Proceed', primary: true, fn: () => finish(true) },
      ],
      onDismiss: () => finish(false),                         // Esc or a click beside it: as Cancel
    });
  }

  $('btnExportGds').onclick = () => {
    const w = app.project.writing;
    const hasClasses = !!(w && w.library && w.classes);
    const base = (app.fileName && app.fileName !== 'demo' ? app.fileName : 'layout').replace(/(\.ebw)?\.json$/i, '');
    openModal({
      title: 'Export GDSII',
      html: `<div class="label">Content</div>
        <select class="field" id="gdsMode"><option value="design">Design — the layout as drawn (for CleWin, L-Edit, BEAMER)</option>
        <option value="classes" ${hasClasses ? '' : 'disabled'}>Dose classes — the fractured writing data${hasClasses ? '' : ' (run Fracture &amp; correct and Use as writing data first)'}</option></select>
        <label class="row" style="gap:6px;margin-top:4px;font-size:12px;"><input type="checkbox" id="gdsDev"> include the Fab Studio device areas (layer 200/0)</label>
        <div class="label" style="margin-top:8px;">File name</div><input class="field" id="gdsName" value="${esc(base)}">
        <div class="hint" id="gdsNote" style="margin-top:6px;">Units 1 µm / 1 nm. Hierarchy and arrays are kept; fused objects are merged into one outline; circles become polygons with ≤ 1 nm chord error.</div>`,
      onOpen: (box) => {
        const mode = box.querySelector('#gdsMode');
        mode.onchange = () => { box.querySelector('#gdsNote').innerHTML = mode.value === 'classes'
          ? 'Each fragment on layer = datatype = its dose class, and a <i>name</i>_doses.txt with the relative dose of every class (relative to the nominal dose).'
          : 'Units 1 µm / 1 nm. Hierarchy and arrays are kept; fused objects are merged into one outline; circles become polygons with ≤ 1 nm chord error.'; };
      },
      buttons: [{ label: 'Cancel' }, { label: 'Export', primary: true, fn: (box) => {
        const mode = box.querySelector('#gdsMode').value, name = box.querySelector('#gdsName').value.replace(/\.gds$/i, '').trim() || 'layout';
        try {
          const lib = mode === 'classes' ? w.library : app.project.library;
          const r = writeGds(lib, { mode, classes: w?.classes, nominalDose: app.nominalDose(), includeDevice: box.querySelector('#gdsDev').checked, libName: name });
          save(`${name}.gds`, r.bytes, 'application/octet-stream');
          if (r.doseTable) setTimeout(() => save(`${name}_doses.txt`, r.doseTable, 'text/plain'), 400);
          const rep = r.report;
          toast(`Exported <b>${esc(name)}.gds</b> (${(r.bytes.length / 1024).toFixed(0)} kB): ${rep.boundaries.toLocaleString()} boundaries, ${rep.srefs + rep.arefs} references in ${rep.cells} cells${r.doseTable ? `, plus ${esc(name)}_doses.txt` : ''}.${rep.warnings.length ? '<br>' + rep.warnings.map(esc).join('<br>') : ''}`, 7000);
        } catch (e) { alert(`Could not export:\n${e.message}`); }
      } }],
    });
  };
}
