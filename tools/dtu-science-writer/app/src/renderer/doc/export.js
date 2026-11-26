/* Export: PDF (Typst in the main process) and Word (.docx built here). */
import { docToTypst } from '../../core/typst.js';
import { docToDocx } from '../../core/docx.js';
import { docToLatex } from '../../core/latex.js';
import JSZip from 'jszip';
import { usedMedia } from '../../core/fileformat.js';
import { getMedia } from '../../core/media.js';
import { app, api, baseName, toast, onSaved } from '../context.js';
import { mediaPayload } from './preview.js';
import { splitParts } from '../../core/parts.js';

/** "paper.pdf" -> "paper-SI.pdf": the Supporting Information goes next to the manuscript. */
export const siPath = (p) => p.replace(/(\.[^.\\/]+)?$/, (ext) => '-SI' + ext);

export async function exportPdf(pathArg) {
  const path = pathArg || await api.saveDialog({ defaultName: baseName() + '.pdf', kind: 'pdf' });
  if (!path) return null;
  const { main, si } = splitParts(app.view.state.doc);
  const res = await api.compile({ source: docToTypst(main).source, media: mediaPayload(), format: 'pdf', out: path });
  if (res.error) { toast('PDF export failed: ' + res.error, 'error'); return null; }
  let siFile = null;
  if (si) {
    siFile = siPath(path);
    const r2 = await api.compile({ source: docToTypst(si).source, media: mediaPayload(), format: 'pdf', out: siFile });
    if (r2.error) { toast('The manuscript was exported, the Supporting Information failed: ' + r2.error, 'error'); return path; }
  }
  if (!pathArg) toast('Exported ' + path.split(/[\\/]/).pop() + (siFile ? ' and ' + siFile.split(/[\\/]/).pop() : ''));
  return path;
}

/** SVG images become PNG for Word (Word needs a bitmap fallback for SVG). */
async function rasterize(m) {
  const url = URL.createObjectURL(new Blob([m.bytes], { type: m.mime }));
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const scale = Math.min(4, 2400 / (img.naturalWidth || 600));
    const c = document.createElement('canvas');
    c.width = Math.round((img.naturalWidth || 600) * scale); c.height = Math.round((img.naturalHeight || 400) * scale);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'png', w: c.width, h: c.height };
  } finally { URL.revokeObjectURL(url); }
}

export async function docxBytes(part) {
  const whole = app.view.state.doc;
  const doc = part || whole;
  const images = new Map();
  const sizes = new Map();
  doc.descendants((n) => { if (n.type.name === 'image') sizes.set(n.attrs.src, { w: n.attrs.w, h: n.attrs.h }); return true; });
  for (const name of usedMedia(doc)) {
    const m = getMedia(name);
    if (!m) continue;
    const ext = name.split('.').pop().toLowerCase();
    if (ext === 'svg') images.set(name, await rasterize(m));
    else images.set(name, { bytes: m.bytes, ext: ext === 'jpeg' ? 'jpg' : ext, ...(sizes.get(name) || {}) });
  }
  return docToDocx(doc, { getImage: (name) => images.get(name) || null, zoteroFields: app.settings.wordZotero !== false });
}

export async function exportDocx(pathArg) {
  const path = pathArg || await api.saveDialog({ defaultName: baseName() + '.docx', kind: 'docx' });
  if (!path) return null;
  const { main, si } = splitParts(app.view.state.doc);
  const { bytes, problems } = await docxBytes(main);
  const res = await api.writeFile(path, bytes);
  if (res && res.error) { toast('Word export failed: ' + res.error, 'error'); return null; }
  let siFile = null;
  if (si) {
    siFile = siPath(path);
    const r2 = await api.writeFile(siFile, (await docxBytes(si)).bytes);
    if (r2 && r2.error) { toast('The manuscript was exported, the Supporting Information failed: ' + r2.error, 'error'); return path; }
  }
  if (!pathArg) toast('Exported ' + path.split(/[\\/]/).pop() + (siFile ? ' and ' + siFile.split(/[\\/]/).pop() : '') + (problems.length ? ' — ' + problems.length + ' problem(s), see the preview status' : ''));
  return path;
}

/* "Always save a Word copy" (Settings): after every save of a document, <name>.docx next to it is replaced by a fresh
   export — always the latest, not versioned. Runs in the background; a Word file that is open in Word cannot be
   replaced, which is reported once per document. */
let wordBusy = false, wordAgain = false, wordWarned = null;
export async function saveWordCopy() {
  if (!app.path || !/\.dtusw$/i.test(app.path)) return null;
  if (wordBusy) { wordAgain = true; return null; }
  wordBusy = true;
  const target = app.path.replace(/\.dtusw$/i, '.docx');
  try {
    const { main, si } = splitParts(app.view.state.doc);
    const { bytes } = await docxBytes(main);
    const res = await api.writeFile(target, bytes);
    if (si && !(res && res.error)) await api.writeFile(siPath(target), (await docxBytes(si)).bytes);
    if (res && res.error) {
      if (wordWarned !== target) toast('Word copy not updated: ' + res.error + ' (is ' + target.split(/[\\/]/).pop() + ' open in Word?)', 'error');
      wordWarned = target;
      return null;
    }
    wordWarned = null;
    return target;
  } finally {
    wordBusy = false;
    if (wordAgain) { wordAgain = false; saveWordCopy(); }
  }
}
// a real save only: the document on disk is the one in the editor (restored copies have no path)
onSaved(() => { if (app.settings.alwaysDocx && app.path && app.savedDoc === (app.view && app.view.state.doc)) saveWordCopy(); });

/* LaTeX (step 5): main.tex + references.bib + figures/ in one zip — Overleaf uploads it directly (New project →
   Upload project); for a local LaTeX, unzip and run pdfLaTeX twice. core/latex.js writes the text. */
export async function exportLatex(pathArg) {
  const path = pathArg || await api.saveDialog({ defaultName: baseName() + '-latex.zip', kind: 'zip' });
  if (!path) return null;
  const { main, si } = splitParts(app.view.state.doc);
  const { tex, bib, figures: mainFigures, problems } = docToLatex(main, {});
  const zip = new JSZip();
  zip.file('main.tex', tex);
  zip.file('references.bib', bib);
  const figures = [...mainFigures];
  if (si) {
    // the Supporting Information: its own file in the same project (Overleaf: set it as the main file to compile it)
    const s = docToLatex(si, {});
    zip.file('si.tex', s.tex.replace(/^% Exported by DTU Science Writer\.[^\n]*\n/, '% Supporting Information, exported by DTU Science Writer. Compile with pdfLaTeX (twice).\n'));
    for (const f of s.figures) if (!figures.some(x => x.name === f.name)) figures.push(f);
    problems.push(...s.problems);
  }
  for (const f of figures) {
    const m = getMedia(f.src);
    if (!m) continue;
    const ext = f.src.split('.').pop().toLowerCase();
    zip.file('figures/' + f.name, ext === 'svg' || ext === 'gif' ? (await rasterize(m)).bytes : m.bytes);
  }
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const res = await api.writeFile(path, bytes);
  if (res && res.error) { toast('LaTeX export failed: ' + res.error, 'error'); return null; }
  if (!pathArg) toast('Exported ' + path.split(/[\\/]/).pop() + ' — upload it to Overleaf (New project → Upload project), or unzip and run pdfLaTeX' + (problems.length ? '. ' + problems.length + ' problem(s): check the cross-references' : ''));
  return path;
}
