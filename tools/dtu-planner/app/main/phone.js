/* One Todo Tree — read-only phone view: a narrow PDF in <data>/phone/, read in the Dropbox app. */
'use strict';
const { BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const M = require('../shared/model.js');
const { atomicWrite } = require('./store.js');

let busy = false;

function pdfPath(store) { return store.p('phone', M.getAppName() + '.pdf'); }

async function writePdf(store, log) {
  if (busy) return;
  busy = true;
  let w = null;
  try {
    const list = store.listEditions();
    if (!list.length) return;
    const ed = JSON.parse(fs.readFileSync(store.edFile(list[0].id), 'utf8'));
    M.validate(ed);
    const settings = store.readSettings();
    const people = store.readPeople().people || {};
    const html = buildHtml(ed, settings, people);
    const tmpHtml = path.join(require('os').tmpdir(), 'ott-phone-' + process.pid + '.html');
    fs.writeFileSync(tmpHtml, html, 'utf8');
    w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
    await w.loadFile(tmpHtml);
    const pdf = await w.webContents.printToPDF({ pageSize: { width: 4.0, height: 8.6 }, printBackground: true, margins: { top: 0.3, bottom: 0.3, left: 0.25, right: 0.25 } });
    atomicWrite(pdfPath(store), pdf);
    try { fs.unlinkSync(tmpHtml); } catch (_) {}
  } catch (e) {
    log && log('pdf', e.stack || e.message);
  } finally {
    if (w && !w.isDestroyed()) w.destroy();
    busy = false;
  }
}

function buildHtml(ed, settings, people) {
  const E = M.escapeHtml;
  const der = M.derive(ed, settings);
  const catColor = {};
  for (const c of settings.categories) catColor[c.key] = c.color;
  const items = M.dueItems(ed, settings);
  const over = items.filter(i => i.overdue);
  const week = items.filter(i => !i.overdue && i.days <= 7);
  const later = items.filter(i => !i.overdue && i.days > 7);
  const fmt = (s) => { if (!s) return ''; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
  const due = (it) => it.range ? (it.now ? 'now – ' + fmt(it.end) : fmt(it.deadline) + '–' + fmt(it.end)) : it.days < 0 ? (-it.days) + 'd late' : it.days === 0 ? 'today' : it.days === 1 ? 'tomorrow' : fmt(it.deadline);
  const dot = (cat) => `<span class="dot" style="background:${catColor[cat] || '#888'}"></span>`;
  const row = (it) => `<div class="it">${dot(it.cat)}<div class="t"><b>${E(it.title)}</b><small>${E(it.path.slice(0, -1).join(' › '))}</small></div><span class="due ${it.overdue ? 'o' : it.urg >= 3 ? 'u3' : 'u2'}">${E(due(it))}</span></div>`;
  const sec = (title, arr) => arr.length ? `<h2>${title} <span>${arr.length}</span></h2>${arr.map(row).join('')}` : '';

  // urgent & critical open leaves
  const hot = [];
  for (const [id, d] of der) {
    const n = ed.nodes[id];
    if (!d.leaf || d.done) continue;
    if ((d.crit || 0) >= 3 && (d.urg || 0) >= 2) hot.push({ id, title: n.title, path: M.pathTitles(ed, id), cat: d.cat, days: d.days, deadline: d.deadline, urg: d.urg, overdue: d.overdue });
  }

  // outline of open work per category
  let outline = '';
  const stageName = (n, d) => d.leaf ? M.STAGES[n.stage] : Math.round((d.progress || 0) * 100) + '%';
  const walk = (id, depth) => {
    const n = ed.nodes[id], d = der.get(id);
    if (d.done && !n.kind) return '';
    let s = '';
    if (n.kind !== 'category') {
      const who = n.owner && people[n.owner] ? ' · ' + E(people[n.owner].name) : '';
      const dl = d.deadlineOwn ? ` <span class="due ${d.overdue ? 'o' : d.urg >= 3 ? 'u3' : d.urg >= 2 ? 'u2' : ''}">${E(fmt(n.deadline) + (d.end ? '–' + fmt(d.end) : ''))}</span>` : '';
      const st = n.kind ? '' : `<em>${E(stageName(n, d))}</em>`;
      if (n.kind === 'info') s += `<div class="ol" style="padding-left:${(depth - 2) * 11}px"><span>ⓘ ${E(n.title || '(untitled)')}</span></div>`;
      else s += `<div class="ol" style="padding-left:${(depth - 2) * 11}px"><span class="${n.kind ? 'k' : ''}${(d.crit || 0) >= 3 ? ' c3' : ''}">${E(n.title || '(untitled)')}</span>${who}${dl} ${st}</div>`;
    }
    if (depth < 6) for (const c of n.children) s += walk(c, depth + 1);
    return s;
  };
  for (const cid of ed.nodes.root.children) {
    const c = ed.nodes[cid], d = der.get(cid);
    if (!c.children.length) continue;
    const body = c.children.map(k => walk(k, 2)).join('');
    if (!body) continue;
    outline += `<h3 style="border-color:${catColor[c.cat] || '#888'}">${E(c.title)} <span>${d.progress != null ? Math.round(d.progress * 100) + '%' : ''}</span></h3>${body}`;
  }

  const now = new Date().toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{font:10.5px/1.35 "Segoe UI",sans-serif;color:#1d2228;margin:0}
  h1{font-size:17px;margin:0 0 1px} .sub{color:#6b7380;font-size:9px;margin-bottom:8px}
  h2{font-size:12px;margin:12px 0 4px;padding-bottom:2px;border-bottom:1px solid #dde1e6} h2 span{color:#6b7380;font-weight:400}
  h3{font-size:11.5px;margin:10px 0 3px;border-left:4px solid;padding-left:6px} h3 span{color:#6b7380;font-weight:400;font-size:9.5px}
  .it{display:flex;gap:6px;align-items:flex-start;padding:3px 0;border-bottom:1px solid #f0f2f4;break-inside:avoid}
  .it .t{flex:1;min-width:0} .it small{display:block;color:#6b7380;font-size:8.5px}
  .dot{width:7px;height:7px;border-radius:50%;margin-top:4px;flex:none}
  .due{font-size:8.5px;padding:0 4px;border-radius:6px;background:#eef0f3;white-space:nowrap}
  .due.u2{background:#fff1d6;color:#8a5a00}.due.u3{background:#ffe0e0;color:#a4161a}.due.o{background:#c92a2a;color:#fff}
  .ol{padding:1px 0;break-inside:avoid} .ol em{color:#6b7380;font-style:normal;font-size:8.5px} .ol .k{font-weight:600} .ol .c3{font-weight:700}
  </style></head><body>
  <h1>${E(M.getAppName())}</h1><div class="sub">${E(ed.title)} · updated ${E(now)} · read-only</div>
  ${sec('Overdue', over)}${sec('Due within 7 days', week)}${sec('Urgent &amp; critical', hot.filter(h => !items.some(i => i.id === h.id && !i.step)))}${sec('Coming up', later)}
  <h2>Open work by category</h2>${outline || '<p>No open tasks.</p>'}
  </body></html>`;
}

module.exports = { writePdf, pdfPath, buildHtml };
