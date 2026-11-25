/* One Todo Tree — dialogs: new edition, people, history/restore, trash, settings, help, conflict. */
(function () {
  'use strict';
  const S = OTT.S, C = OTT.cmd;
  const modal = $('#modal');
  let onClose = null;

  function open(html, cls, closeCb) {
    modal.innerHTML = `<div class="mbg"></div><div class="dlg ${cls || ''}">${html}</div>`;
    modal.hidden = false;
    onClose = closeCb || null;
    modal.querySelector('.mbg').addEventListener('click', () => { if (!modal.querySelector('.dlg.sticky')) close(); });
    const f = modal.querySelector('[autofocus]'); if (f) setTimeout(() => f.focus(), 30);
    return modal.querySelector('.dlg');
  }
  function close(v) { modal.hidden = true; modal.innerHTML = ''; const cb = onClose; onClose = null; if (cb) cb(v); OTT.focusStage(); }
  const head = (t, sub) => `<header><h2>${t}</h2>${sub ? `<p>${sub}</p>` : ''}<button class="dx" data-close>${ICON('x')}</button></header>`;
  modal.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });

  const D = OTT.dialogs = { open, close };

  D.info = (title, html) => { open(head(E(title)) + `<div class="dbody"><p>${html}</p></div><footer><button class="primary" data-close autofocus>OK</button></footer>`, 'small'); };

  D.prompt = (title, label, value) => new Promise((resolve) => {
    const dlg = open(head(E(title)) + `<div class="dbody"><label class="fl">${E(label)}<input id="pv" value="${E(value || '')}" autofocus spellcheck="false"></label></div><footer><button data-close>Cancel</button><button class="primary" id="pok">OK</button></footer>`, 'small', (v) => resolve(v || null));
    const ok = () => { const v = $('#pv', dlg).value.trim(); close(v); };
    $('#pok', dlg).onclick = ok;
    $('#pv', dlg).addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
  });

  D.confirm = (title, html, yes, danger) => new Promise((resolve) => {
    const dlg = open(head(E(title)) + `<div class="dbody"><p>${html}</p></div><footer><button data-close>Cancel</button><button class="${danger ? 'dangerbtn' : 'primary'}" id="cok" autofocus>${E(yes || 'OK')}</button></footer>`, 'small', (v) => resolve(!!v));
    $('#cok', dlg).onclick = () => close(true);
  });

  // ---------- conflict: the file changed on another PC ----------
  D.conflict = (theirs) => new Promise((resolve) => {
    const tCount = theirs && theirs.nodes ? Object.keys(theirs.nodes).length : '?';
    const when = theirs && theirs.modified ? new Date(theirs.modified).toLocaleString('en-GB') : 'unknown time';
    const dlg = open(head(ICON('warn') + ' Changed on another computer', 'Nothing has been overwritten.') + `<div class="dbody">
      <p>“${E(S.ed.title)}” was saved elsewhere (${E(when)}, ${tCount} items) after you opened it here. Choose which version to continue with. <b>The other version is kept in the journal either way</b> and can be brought back from History.</p>
      </div><footer><button id="ctheirs">Load the other version</button><button class="primary" id="cmine">Keep mine (this window)</button></footer>`, 'small sticky', () => resolve());
    $('#cmine', dlg).onclick = async () => {
      if (theirs) await ott.journalTheirs(S.ed.id, theirs);
      close();
      S.dirtyEd = true; OTT.saveNow(true);
    };
    $('#ctheirs', dlg).onclick = async () => {
      await ott.journalNow(S.ed, 'mine-before-reload');
      close();
      S.dirtyEd = false;
      await OTT.loadEdition(S.ed.id);
      OTT.toast('Loaded the other version. Yours is in History (journal).');
    };
  });

  // ---------- new edition ----------
  function nextId() {
    const ids = S.editions.map(e => e.id);
    const now = M.todayStr().slice(0, 7);
    let base = now;
    if (ids.includes(base)) { const [y, m] = now.split('-').map(Number); const d = new Date(y, m, 1); base = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
    let id = base, i = 2;
    while (ids.includes(id)) id = base + '-' + (i++);
    return id;
  }
  function titleFor(id) { const m = /^(\d{4})-(\d{2})/.exec(id); if (!m) return id; return new Date(+m[1], +m[2] - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' }) + (id.length > 7 ? ' (' + id.slice(8) + ')' : ''); }

  D.newEdition = async () => {
    const templates = await ott.listTemplates();
    const curCount = M.countStructure(M.extractStructure(S.ed));
    const id = nextId();
    const src = S.ed;
    const der = S.der;
    const include = new Set();
    // checklist tree of the current edition (categories expanded, tasks collapsed below depth 2)
    const item = (nid, depth) => {
      const n = src.nodes[nid], d = der.get(nid);
      if (n.kind === 'group' && !M.inPeople(src, nid)) { // subcategory: always carried over, like a category
        return `<div class="ck grp" style="padding-left:${depth * 18}px"><span class="cdot" style="background:${OTT.catColor(der.get(nid).cat)}"></span><b>${E(OTT.title(n))}</b> <i class="tag">subcategory</i></div>` + n.children.map(c => item(c, depth + 1)).join('');
      }
      if (n.kind === 'group' || n.kind === 'person') { // people branch always comes along; only tasks under persons are optional
        return n.children.map(c => item(c, depth)).join('');
      }
      const kids = n.children.map(c => item(c, depth + 1)).join('');
      if (n.kind === 'category') {
        return `<div class="ck cat"><span class="cdot" style="background:${OTT.catColor(n.cat)}"></span><b>${E(n.title)}</b><button class="mini" data-all="${nid}">all</button><button class="mini" data-none="${nid}">none</button></div><div class="ckids">${kids || '<div class="hint">empty</div>'}</div>`;
      }
      return `<div class="ck" style="padding-left:${depth * 18}px"><label><input type="checkbox" data-ck="${nid}"> <span class="${d.done ? 'donet' : ''}">${E(OTT.title(n))}</span>${d.done ? ' <i class="tag">done</i>' : ''}${n.deadline ? ' <i class="tag">' + E(OTT.fmtDate(n.deadline)) + '</i>' : ''}</label></div>` + kids;
    };
    const tree = src.nodes.root.children.map(c => item(c, 0)).join('');
    const dlg = open(head('New edition', 'Start a new month (or any period). Every edition stays available and editable.') + `<div class="dbody">
      <div class="grid2"><label class="fl">Short id<input id="neid" value="${E(id)}" spellcheck="false"></label><label class="fl">Title<input id="netitle" value="${E(titleFor(id))}"></label></div>
      <div class="modes">
        <label class="mode"><input type="radio" name="nem" value="copy" checked><div><b>Copy everything</b><span>An editable copy of “${E(src.title)}”. You are asked about items past their date.</span></div></label>
        <label class="mode"><input type="radio" name="nem" value="branches"><div><b>Selected branches</b><span>Pick what continues from “${E(src.title)}”.</span></div></label>
        <label class="mode"><input type="radio" name="nem" value="scratch"><div><b>From scratch</b><span>No tasks; choose the structure below (the People list carries over).</span></div></label>
      </div>
      <label class="fl inline"><input type="checkbox" id="nedrop" checked> Leave out finished tasks</label>
      <label class="fl inline" id="nestructrow">Structure
        <select id="nestruct">
          <option value="current">Subcategories from “${E(src.title)}” (${curCount})</option>
          ${templates.map((t, i) => `<option value="t${i}">Template: ${E(t.name)} (${M.countStructure(t)})</option>`).join('')}
          <option value="none">Only the categories</option>
        </select>
        <span class="hint">Save a structure with “Save structure as template…” in the edition menu.</span></label>
      <div id="nepick" class="picker">${tree}</div>
      </div><footer><span class="hint" id="necount"></span><button data-close>Cancel</button><button class="primary" id="nego">Create edition</button></footer>`, 'wide');
    const upd = () => {
      const m = dlg.querySelector('input[name=nem]:checked').value;
      $('#nepick', dlg).style.display = m === 'branches' ? '' : 'none';
      $('#nedrop', dlg).closest('label').style.display = m === 'scratch' ? 'none' : '';
      $('#nestructrow', dlg).style.display = m === 'scratch' ? '' : 'none';
      $('#necount', dlg).textContent = m === 'branches' ? include.size + ' picked' : '';
    };
    dlg.addEventListener('change', (e) => {
      const ck = e.target.dataset && e.target.dataset.ck;
      if (ck) {
        // ticking a task ticks its whole subtree; unticking unticks the subtree
        for (const x of M.subtreeIds(src, ck)) {
          if (e.target.checked) include.add(x); else include.delete(x);
          const box = dlg.querySelector(`[data-ck="${x}"]`); if (box) box.checked = e.target.checked;
        }
        // ticking a child implies its ancestors' structure (handled in makeEdition)
      }
      if (e.target.id === 'neid') $('#netitle', dlg).value = titleFor(e.target.value.trim());
      upd();
    });
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-all],[data-none]');
      if (!b) return;
      const cid = b.dataset.all || b.dataset.none;
      for (const x of M.subtreeIds(src, cid)) {
        if (x === cid || (src.nodes[x].kind && src.nodes[x].kind !== 'info')) continue;
        if (b.dataset.all) include.add(x); else include.delete(x);
        const box = dlg.querySelector(`[data-ck="${x}"]`); if (box) box.checked = !!b.dataset.all;
      }
      upd();
    });
    upd();
    $('#nego', dlg).onclick = async () => {
      const nid = $('#neid', dlg).value.trim().replace(/[<>:"/\\|?*]/g, '-');
      if (!nid) return OTT.toast('Give the edition an id', 'warn');
      if (S.editions.some(e => e.id === nid)) return OTT.toast('An edition “' + nid + '” already exists', 'warn');
      const mode = dlg.querySelector('input[name=nem]:checked').value;
      await OTT.saveNow();
      const sv = $('#nestruct', dlg).value;
      const structure = sv === 'current' || sv === 'none' ? sv : templates[+sv.slice(1)];
      const o = { id: nid, title: $('#netitle', dlg).value.trim() || nid, mode, include, dropDone: mode !== 'scratch' && $('#nedrop', dlg).checked, structure: mode === 'scratch' ? structure : undefined };
      const past = mode === 'scratch' ? [] : pastItems(src, der, o);
      if (past.length) return reviewPast(src, der, o, past);
      createEdition(src, o, null);
    };
  };

  /** Items that would be carried over although their date has passed (deadline gone by, or period ended). */
  function pastItems(src, der, o) {
    const out = [];
    for (const [id, d] of der) {
      const n = src.nodes[id];
      if (!n || (n.kind && n.kind !== 'info') || !n.deadline) continue;
      if (o.mode === 'branches' && !o.include.has(id)) continue;
      if (o.dropDone && d.done) continue;
      const passed = d.end ? d.ended : d.days < 0;
      if (passed) out.push({ id, n, d });
    }
    out.sort((a, b) => a.n.deadline.localeCompare(b.n.deadline));
    return out;
  }
  /** Ask, item by item, whether past items continue into the new edition. */
  function reviewPast(src, der, o, past) {
    const keepDefault = (it) => !it.d.done && !it.d.end;   // unfinished deadlines usually still need doing; ended periods and finished items stay behind
    const status = (it) => it.d.done ? 'done' : it.d.end ? 'ended ' + OTT.fmtDate(it.d.end) : (-it.d.days) + ' day' + (it.d.days === -1 ? '' : 's') + ' overdue';
    const rows = past.map((it, i) => {
      const sub = M.subtreeIds(src, it.id).length - 1;
      const path = M.pathTitles(src, it.id).slice(0, -1).join(' › ');
      return `<label class="pastrow"><input type="checkbox" data-pi="${i}" ${keepDefault(it) ? 'checked' : ''}><span class="cdot" style="background:${OTT.catColor(der.get(it.id).cat)}"></span><span class="pt"><b>${E(OTT.title(it.n))}</b><small>${E(path)}${sub ? ' · with ' + sub + ' subitem' + (sub > 1 ? 's' : '') : ''}</small></span><span class="tag ${it.d.done ? '' : it.d.end ? '' : 'bad'}">${E(status(it))}</span><span class="pdate">${E(it.d.end ? OTT.fmtRange(it.n.deadline, it.d.end) : OTT.fmtDate(it.n.deadline))}</span></label>`;
    }).join('');
    const dlg = open(head('Past their date (' + past.length + ')', 'Tick what continues into “' + E(o.title) + '”. Unticked items stay in “' + E(src.title) + '” (nothing is deleted).') + `<div class="dbody"><div class="irow btns"><button id="pall">Carry all over</button><button id="pnone">Leave all behind</button></div><div class="pastlist">${rows}</div></div>
      <footer><span class="hint" id="pcount"></span><button data-close>Cancel</button><button class="primary" id="pgo">Create edition</button></footer>`, 'wide');
    const count = () => { const k = dlg.querySelectorAll('[data-pi]:checked').length; $('#pcount', dlg).textContent = k + ' of ' + past.length + ' carried over'; };
    dlg.addEventListener('change', count);
    $('#pall', dlg).onclick = () => { dlg.querySelectorAll('[data-pi]').forEach(x => { x.checked = true; }); count(); };
    $('#pnone', dlg).onclick = () => { dlg.querySelectorAll('[data-pi]').forEach(x => { x.checked = false; }); count(); };
    count();
    $('#pgo', dlg).onclick = () => {
      const exclude = new Set();
      dlg.querySelectorAll('[data-pi]').forEach(x => { if (!x.checked) exclude.add(past[+x.dataset.pi].id); });
      createEdition(src, o, exclude);
    };
  }
  async function createEdition(src, o, exclude) {
    const ed = M.makeEdition(src, Object.assign({}, o, { exclude }), S.settings);
    const r = await ott.createEdition(ed);
    if (r.error) return OTT.toast(r.error, 'error');
    close();
    await OTT.loadEdition(o.id);
    OTT.toast('Edition “' + ed.title + '” created' + (exclude && exclude.size ? ' — ' + exclude.size + ' past item' + (exclude.size > 1 ? 's' : '') + ' left behind' : ''));
  }

  // ---------- category -> subcategory/task of another category ----------
  D.demote = (catId) => {
    const cat = S.ed.nodes[catId];
    if (!cat) return;
    const hasGroups = cat.children.some(k => S.ed.nodes[k].kind === 'group');
    const n = M.subtreeIds(S.ed, catId).length - 1;
    const opts = [];
    const walk = (id, dep) => {
      const x = S.ed.nodes[id];
      opts.push(`<label class="tgt" style="padding-left:${8 + dep * 18}px"><input type="radio" name="dtgt" value="${id}"><span class="cdot" style="background:${OTT.catColor(OTT.d(id).cat)}"></span>${dep ? '' : '<b>'}${E(OTT.title(x))}${dep ? '' : '</b>'}</label>`);
      for (const k of x.children) if (S.ed.nodes[k].kind === 'group') walk(k, dep + 1);
    };
    for (const k of S.ed.nodes.root.children) if (k !== catId && k !== M.PEOPLE_CAT) walk(k, 0);
    const dlg = open(head('Move “' + E(cat.title) + '” into another category', n + ' item' + (n === 1 ? '' : 's') + ' move along. Older editions keep the category as it was.') + `<div class="dbody">
      <div class="fl inline"><b>As</b>
        <label><input type="radio" name="dkind" value="group" checked> subcategory</label>
        <label ${hasGroups ? 'title="It contains subcategories, so it stays a subcategory"' : ''}><input type="radio" name="dkind" value="task" ${hasGroups ? 'disabled' : ''}> task</label></div>
      <div class="picker tgtlist">${opts.join('')}</div></div>
      <footer><span class="hint">Undo with Ctrl+Z; the category can be brought back in Settings.</span><button data-close>Cancel</button><button class="primary" id="dgo" disabled>Move</button></footer>`, 'wide');
    dlg.addEventListener('change', () => { $('#dgo', dlg).disabled = !dlg.querySelector('input[name=dtgt]:checked'); });
    $('#dgo', dlg).onclick = async () => {
      const t = dlg.querySelector('input[name=dtgt]:checked'); if (!t) return;
      const k = dlg.querySelector('input[name=dkind]:checked').value;
      close();
      await C.demoteCategory(catId, t.value, k);
    };
  };

  // ---------- structure templates ----------
  function structureHtml(tpl) {
    const walk = (arr, dep) => arr.map(g => `<div style="padding-left:${dep * 16}px">▸ ${E(g.title || '(untitled)')}</div>` + walk(g.children || [], dep + 1)).join('');
    const keys = Object.keys(tpl.cats || {});
    if (!keys.length) return '<div class="hint pad">No subcategories yet — add some with right-click › Add subcategory.</div>';
    return keys.map(k => { const c = OTT.catOf(k); return `<h5><span class="cdot" style="background:${c.color}"></span>${E(c.name)}</h5>` + walk(tpl.cats[k], 1); }).join('');
  }
  D.saveTemplate = async () => {
    const tpl = M.extractStructure(S.ed);
    const existing = await ott.listTemplates();
    const n = M.countStructure(tpl);
    const dlg = open(head('Save structure as template', 'The subcategories of every category (at any depth), without tasks. Use it later when starting an edition from scratch.') + `<div class="dbody">
      <label class="fl">Template name<input id="tpname" value="${E(existing.length ? '' : 'Standard')}" placeholder="e.g. Standard" autofocus list="tplist"><datalist id="tplist">${existing.map(t => `<option value="${E(t.name)}">`).join('')}</datalist></label>
      <div class="hint" id="tpwarn"></div>
      <div class="picker tplprev">${structureHtml(tpl)}</div></div>
      <footer><span class="hint">${n} subcategor${n === 1 ? 'y' : 'ies'} from “${E(S.ed.title)}”</span><button data-close>Cancel</button><button class="primary" id="tpsave" ${n ? '' : 'disabled'}>Save template</button></footer>`, 'wide');
    const nameEl = $('#tpname', dlg);
    const warn = () => { const v = nameEl.value.trim(); $('#tpwarn', dlg).textContent = existing.some(t => t.name.toLowerCase() === v.toLowerCase()) ? 'Replaces the existing template “' + v + '” (the old version is kept in templates\\.replaced).' : ''; };
    nameEl.addEventListener('input', warn); warn();
    $('#tpsave', dlg).onclick = async () => {
      const name = nameEl.value.trim();
      if (!name) return OTT.toast('Give the template a name', 'warn');
      const r = await ott.saveTemplate(Object.assign({ name, created: M.nowIso(), from: S.ed.id }, tpl));
      if (r.error) return OTT.toast(r.error, 'error');
      close();
      OTT.toast('Template “' + name + '” saved (' + n + ' subcategories)');
    };
  };

  // ---------- people ----------
  D.people = () => {
    let mode = 'name', q = '';
    const involvement = () => {
      const inv = {};
      for (const n of Object.values(S.ed.nodes)) {
        const add = (pid, role) => { (inv[pid] = inv[pid] || []).push({ id: n.id, role }); };
        if (n.owner) add(n.owner, 'owner');
        for (const s of n.stakeholders || []) add(s, 'stakeholder');
        if (n.person) for (const c of M.subtreeIds(S.ed, n.id).slice(1)) if (!S.ed.nodes[c].kind) add(n.person, 'own task');
      }
      return inv;
    };
    const groupOf = (pid) => { const nid = OTT.personNodeId(pid); if (!nid) return '—'; const p = S.ed.nodes[S.ed.nodes[nid].parent]; return p && p.kind === 'group' ? p.title : '—'; };
    const projectOf = (nid) => { // node directly under a category
      let n = S.ed.nodes[nid], prev = null;
      while (n && n.kind !== 'category') { prev = n; n = S.ed.nodes[n.parent]; }
      return prev && n ? { id: prev.id, title: OTT.title(prev), cat: n.cat, catTitle: n.title } : null;
    };
    const personRow = (p, inv) => `<div class="prow" data-pid="${p.id}"><span class="oav" style="background:${OTT.catColor('people')}">${E(OTT.initials(p.name))}</span><div class="pn"><b>${E(p.name || '(no name)')}</b><span>${E([p.org, p.email].filter(Boolean).join(' · '))}</span></div><span class="pg">${E(groupOf(p.id))}</span><span class="pc">${(inv[p.id] || []).length || ''}</span></div>`;
    const draw = () => {
      const inv = involvement();
      let list = Object.values(S.people.people).filter(p => !q || (p.name + ' ' + (p.org || '') + ' ' + (p.email || '')).toLowerCase().includes(q));
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      let body = '';
      if (mode === 'name') body = list.map(p => personRow(p, inv)).join('');
      else if (mode === 'group') {
        const groups = {};
        for (const p of list) (groups[groupOf(p.id)] = groups[groupOf(p.id)] || []).push(p);
        const order = (S.ed.nodes[M.PEOPLE_CAT] ? S.ed.nodes[M.PEOPLE_CAT].children.map(g => S.ed.nodes[g].title) : []).concat(['—']);
        body = Object.keys(groups).sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(g => `<h5>${E(g === '—' ? 'Not in this edition’s People branch' : g)} <span>${groups[g].length}</span></h5>` + groups[g].map(p => personRow(p, inv)).join('')).join('');
      } else {
        const proj = {};
        for (const p of list) for (const it of inv[p.id] || []) {
          const pr = projectOf(it.id); if (!pr || pr.cat === 'people') continue;
          const k = pr.id; proj[k] = proj[k] || { pr, people: new Map() };
          proj[k].people.set(p.id, (proj[k].people.get(p.id) || []).concat(it.role));
        }
        body = Object.values(proj).sort((a, b) => a.pr.catTitle.localeCompare(b.pr.catTitle) || a.pr.title.localeCompare(b.pr.title)).map(({ pr, people }) =>
          `<h5><span class="cdot" style="background:${OTT.catColor(pr.cat)}"></span>${E(pr.catTitle)} › ${E(pr.title)} <span>${people.size}</span></h5>` +
          [...people.entries()].map(([pid, roles]) => { const p = S.people.people[pid]; return `<div class="prow" data-pid="${pid}"><span class="oav sm">${E(OTT.initials(p.name))}</span><div class="pn"><b>${E(p.name)}</b><span>${E([...new Set(roles)].join(', '))}</span></div></div>`; }).join('')).join('') || '<div class="hint pad">Nobody is assigned as owner or stakeholder yet.</div>';
      }
      $('#plist', dlg).innerHTML = body || '<div class="hint pad">No people yet. Add them in the People branch of the map (Tab on a group), or type a name as owner/stakeholder of a task.</div>';
    };
    const dlg = open(head('People', Object.keys(S.people.people).length + ' people, shared by all editions') + `<div class="dbody">
      <div class="ptools"><div class="seg2"><button data-m="name" class="on">By name</button><button data-m="group">By group</button><button data-m="project">By project</button></div><input id="pq" placeholder="Filter…" autofocus></div>
      <div id="plist" class="plist"></div></div><footer><span class="hint">Click a person to show them in the map.</span><button class="primary" data-close>Done</button></footer>`, 'wide');
    dlg.addEventListener('click', (e) => {
      const m = e.target.closest('[data-m]');
      if (m) { mode = m.dataset.m; dlg.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x === m)); draw(); return; }
      const r = e.target.closest('.prow');
      if (r) {
        const nid = OTT.personNodeId(r.dataset.pid);
        close();
        if (nid) C.select(nid, { reveal: true });
        else OTT.toast('This person has no node in this edition’s People branch.');
      }
    });
    $('#pq', dlg).addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); draw(); });
    draw();
  };

  // ---------- backup: export everything to one JSON file / import it again ----------
  const when = (t) => t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const mb = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' kB';
  D.exportBackup = async (file) => {
    await OTT.saveNow();
    const r = await ott.exportBackup(file);
    if (!r || r.canceled) return r;
    if (r.error) { OTT.toast('Export failed: ' + r.error, 'error', 6000); return r; }
    const dlg = open(head(ICON('check') + ' Backup exported') + `<div class="dbody">
      <p><b class="path">${E(r.file)}</b></p>
      <p>${r.editions} edition${r.editions === 1 ? '' : 's'} (${r.nodes} items), ${r.people} people, settings and categories${r.templates ? ', ' + r.templates + ' structure template' + (r.templates === 1 ? '' : 's') : ''} · ${mb(r.size)}, plain JSON.</p>
      ${r.notes.length ? `<p class="hint">${r.notes.map(E).join('<br>')}</p>` : ''}
      <p class="hint">Read it back in with <b>Import backup…</b> (edition menu or Settings › Data). Attached files are not inside the backup, only the links to them.</p>
      </div><footer><button id="bxshow">${ICON('folder')} Show in Explorer</button><button class="primary" data-close autofocus>OK</button></footer>`, 'small');
    $('#bxshow', dlg).onclick = () => ott.revealFile(r.file);
    return r;
  };

  D.importBackup = async (file) => {
    await OTT.saveNow();
    const r = await ott.pickImport(file);
    if (!r || r.canceled) return r;
    if (r.error) { D.info('Cannot import this file', E(r.error)); return r; }
    const full = r.type !== 'edition';
    const src = full ? `Backup made ${E(when(r.created))}${r.machine ? ' on ' + E(r.machine) : ''}${r.app ? ' (' + E(r.app) + (r.version ? ' ' + E(r.version) : '') + ')' : ''}.` : 'A single edition file.';
    const edRows = r.editions.map(e => `<label class="pastrow"><input type="checkbox" data-imp="${E(e.id)}" checked><span class="pt"><b>${E(e.title)}</b><small>${e.count} items · saved ${E(when(e.modified))}</small></span><span class="tag ${e.exists ? 'bad' : ''}">${e.exists ? 'replaces the current one (' + e.curCount + ' items, ' + E(when(e.curModified)) + ')' : 'new edition'}</span></label>`).join('');
    const extra = (r.people != null ? `<label class="pastrow"><input type="checkbox" id="impp" checked><span class="pt"><b>People list</b><small>${r.people} people · replaces the current list</small></span></label>` : '') +
      (r.categories ? `<label class="pastrow"><input type="checkbox" id="imps" checked><span class="pt"><b>Settings and categories</b><small>${E(r.categories.join(', '))}</small></span></label>` : '') +
      (r.templates ? `<label class="pastrow"><input type="checkbox" id="impt" checked><span class="pt"><b>Structure templates</b><small>${r.templates} · same names are replaced (old ones kept aside)</small></span></label>` : '');
    const dlg = open(head('Import backup', E(r.name) + ' — ' + src) + `<div class="dbody">
      <p class="hint">Tick what to read in. Before anything is replaced, the current state is saved as one backup file in the data folder (<b>backups\\before-import-….json</b>) — import that file to undo this import.</p>
      <div class="pastlist">${edRows || '<div class="hint pad">No editions in this file.</div>'}${extra}</div>
      ${r.notes && r.notes.length ? `<p class="hint">${r.notes.map(E).join('<br>')}</p>` : ''}
      </div><footer><button data-close>Cancel</button><button class="primary" id="impgo">Import</button></footer>`, 'wide');
    const go = $('#impgo', dlg);
    const sync = () => { go.disabled = !dlg.querySelector('input:checked'); };
    dlg.addEventListener('change', sync); sync();
    return new Promise((resolve) => {
      go.onclick = async () => {
        const eds = [...dlg.querySelectorAll('[data-imp]:checked')].map(x => x.dataset.imp);
        const choice = { editions: eds, people: !!($('#impp', dlg) || {}).checked, settings: !!($('#imps', dlg) || {}).checked, templates: !!($('#impt', dlg) || {}).checked };
        const replacing = r.editions.filter(e => e.exists && eds.includes(e.id)).length;
        if ((replacing || choice.people || choice.settings) && !(await D.confirm('Replace with the imported version?', `${replacing ? replacing + ' edition' + (replacing === 1 ? '' : 's') + (choice.people || choice.settings ? ', ' : '') : ''}${choice.people ? 'the people list' + (choice.settings ? ', ' : '') : ''}${choice.settings ? 'settings and categories' : ''} will be replaced. The current state is saved first and can be imported again.`, 'Import'))) return resolve({ canceled: true });
        // the edition to show afterwards: the open one if it was imported, else the newest imported
        choice.open = eds.includes(S.ed.id) ? S.ed.id : eds[0];
        S.importing = true;   // from now on nothing in memory is saved: the files on disk are the new truth
        const res = await ott.applyImport(choice);
        if (!res || res.error) { S.importing = false; OTT.toast('Import failed: ' + ((res && res.error) || 'unknown error'), 'error', 8000); return resolve(res); }
        try { sessionStorage.setItem('ott-imported', JSON.stringify({ n: res.editions.length, people: choice.people, settings: choice.settings, safety: res.safety })); } catch (_) {}
        resolve(res);
        setTimeout(() => location.reload(), 50);   // start over from the imported files
      };
    });
  };

  // ---------- history / restore ----------
  D.history = async () => {
    const list = await ott.listBackups(S.ed.id);
    const fmt = (t) => new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const dlg = open(head('History of “' + E(S.ed.title) + '”', 'Every save is journalled (last 300), one snapshot per day is kept forever, and a mirror lives outside Dropbox on this PC.') + `<div class="dbody"><div class="hlist">${list.length ? list.map((b, i) => `<div class="hrow"><span class="hk ${b.kind}">${b.kind}</span><span class="ht">${E(fmt(b.time))}</span><span class="hn">${E(b.name.replace(/^\d{8}-\d{6}_?/, '').replace(/-/g, ' '))}</span><button data-prev="${i}">Preview</button><button class="primary" data-res="${i}">Restore</button></div>`).join('') : '<div class="hint pad">No backups yet.</div>'}</div><div id="hprev" class="hprev"></div></div>
      <footer><button id="hfolder">${ICON('folder')} Open data folder</button><button id="hexp">Export backup…</button><button id="himp">Import backup…</button><button data-close>Close</button></footer>`, 'wide');
    $('#hfolder', dlg).onclick = () => ott.openDataFolder();
    $('#hexp', dlg).onclick = () => { close(); D.exportBackup(); };
    $('#himp', dlg).onclick = () => { close(); D.importBackup(); };
    dlg.addEventListener('click', async (e) => {
      const p = e.target.closest('[data-prev]'), r = e.target.closest('[data-res]');
      if (!p && !r) return;
      const b = list[p ? +p.dataset.prev : +r.dataset.res];
      const ed = await ott.readBackup(b.file);
      if (ed.error) return OTT.toast(ed.error, 'error');
      if (p) {
        const der = M.derive(ed, S.settings);
        const lines = [];
        const walk = (id, dep) => { const n = ed.nodes[id]; if (dep > 0 && dep < 4) lines.push(`<div style="padding-left:${(dep - 1) * 14}px">${E(n.title || '(untitled)')} <i>${der.get(id).progress != null ? Math.round(der.get(id).progress * 100) + '%' : ''}</i></div>`); if (dep < 3) n.children.forEach(c => walk(c, dep + 1)); };
        walk('root', 0);
        $('#hprev', dlg).innerHTML = `<h5>${E(fmt(b.time))} — ${Object.keys(ed.nodes).length} items</h5>` + lines.join('');
        return;
      }
      if (!(await D.confirm('Restore this version?', 'The edition will be replaced by the version from <b>' + E(fmt(b.time)) + '</b>. The current state is saved to the journal first, and Ctrl+Z also undoes the restore.', 'Restore'))) return;
      await ott.journalNow(S.ed, 'before-restore');
      OTT.tx('Restore ' + fmt(b.time), (c) => {
        for (const id of Object.keys(S.ed.nodes)) if (!ed.nodes[id]) c.remove(id);
        for (const [id, n] of Object.entries(ed.nodes)) { c.touch(id); S.ed.nodes[id] = n; }
      });
      S.sel = 'root';
      OTT.toast('Restored');
    });
  };

  // ---------- trash ----------
  D.trash = () => {
    const draw = () => S.ed.trash.length ? S.ed.trash.map(t => `<div class="hrow"><span class="ht">${new Date(t.time).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span><span class="hn"><b>${E(t.title || '(untitled)')}</b> ${Object.keys(t.nodes).length > 1 ? '+' + (Object.keys(t.nodes).length - 1) + ' below' : ''} <i>${E(t.why || '')}</i></span><button class="primary" data-rt="${t.id}">Restore</button></div>`).join('') : '<div class="hint pad">Trash is empty.</div>';
    const dlg = open(head('Trash', 'Deleted items of this edition. They stay here (up to 500 entries).') + `<div class="dbody"><div class="hlist" id="tl">${draw()}</div></div><footer><button data-close>Close</button></footer>`, 'wide');
    dlg.addEventListener('click', (e) => { const b = e.target.closest('[data-rt]'); if (!b) return; C.restoreTrash(b.dataset.rt); $('#tl', dlg).innerHTML = draw(); OTT.toast('Restored'); });
  };

  // ---------- settings ----------
  D.settings = async (opts) => {
    opts = opts || {};
    const sys = await ott.sysGet();
    let templates = await ott.listTemplates();
    const st = clone(S.settings);
    const tplRows = () => templates.length ? templates.map((t, i) => `<div class="catrow del"><span>${ICON('tree')}</span><b>${E(t.name)}</b><span class="hint">${M.countStructure(t)} subcategories · saved ${t.created ? new Date(t.created).toLocaleDateString('en-GB') : ''}${t.from ? ' from ' + E(t.from) : ''}</span><button class="mini wide" data-deltpl="${i}">Delete</button></div>`).join('') : '<div class="hint">No templates yet. Use “Save structure as template…” in the edition menu (top left).</div>';
    if (!Array.isArray(st.semesters)) st.semesters = M.DTU_PERIODS.map(p => ({ ...p }));
    const semRows = () => st.semesters.map((p, i) => `<div class="catrow semrow" data-i="${i}"><input value="${E(p.label)}" data-sl="${i}" placeholder="Label"><input type="date" value="${p.start}" data-ss="${i}"><span class="hint">–</span><input type="date" value="${p.end}" data-se="${i}"><select data-sk="${i}"><option value="teach" ${p.kind !== 'exam' ? 'selected' : ''}>teaching</option><option value="exam" ${p.kind === 'exam' ? 'selected' : ''}>exams</option></select><button class="mini" data-delsem="${i}" title="Remove">${ICON('x')}</button></div>`).join('') || '<div class="hint">No periods.</div>';
    const wasArchived = new Set(S.settings.categories.filter(c => c.archived).map(c => c.key));
    const itemsIn = (key) => S.ed.nodes['cat-' + key] ? M.subtreeIds(S.ed, 'cat-' + key).length - 1 : 0;
    const catRows = () => {
      let h = st.categories.map((c, i) => {
        if (c.archived && wasArchived.has(c.key)) return '';
        if (c.archived) { // marked for deletion in this dialog
          const n = itemsIn(c.key);
          return `<div class="catrow del" data-i="${i}"><span class="cdot" style="background:${c.color}"></span><s>${E(c.name)}</s><span class="hint">deleted on Save${n ? ' — its ' + n + ' item' + (n > 1 ? 's' : '') + ' in this edition go to Trash' : ''}</span><button class="mini wide" data-keep="${i}">Keep</button></div>`;
        }
        const isPeople = 'cat-' + c.key === M.PEOPLE_CAT;
        return `<div class="catrow" data-i="${i}"><input type="color" value="${c.color}" data-cc="${i}"><input value="${E(c.name)}" data-cn="${i}"><button class="mini" data-up="${i}" title="Move up">↑</button><button class="mini" data-dn="${i}" title="Move down">↓</button><button class="mini" data-delcat="${i}" ${isPeople ? 'disabled title="People holds the people list and cannot be deleted (you can rename it)"' : 'title="Delete category"'}>${ICON('trash')}</button></div>`;
      }).join('');
      const gone = st.categories.map((c, i) => [c, i]).filter(([c]) => c.archived && wasArchived.has(c.key));
      if (gone.length) h += `<div class="hint" style="margin-top:8px">Deleted categories (older editions still show them):</div>` + gone.map(([c, i]) => `<div class="catrow del"><span class="cdot" style="background:${c.color}"></span><span>${E(c.name)}</span><span class="tb-spacer"></span><button class="mini wide" data-restorecat="${i}">Restore</button></div>`).join('');
      return h;
    };
    const dlg = open(head('Settings') + `<div class="dbody settings">
      <h4>Categories</h4><div id="cats">${catRows()}</div><button id="addcat">${ICON('plus')} Add category</button>
      <h4>Structure templates</h4><div id="tpls">${tplRows()}</div>
      <h4>Deadlines</h4><label class="fl inline">Tasks become urgent <input type="number" id="slead" min="1" max="120" value="${st.defaultLead || 14}" class="num"> days before their deadline (very urgent in the last ${M.FINAL_DAYS}).</label>
      <label class="fl inline">Default currency <input id="scur" value="${E(st.currency || 'DKK')}" class="num"></label>
      <h4>Calendar: DTU periods</h4><div id="sems">${semRows()}</div><div class="irow btns"><button id="addsem">${ICON('plus')} Add period</button><button id="resetsem">Reset to DTU 2026/27</button></div>
      <p class="hint">Shown as a thin strip in the calendar (blue = teaching, purple = exams). From student.dtu.dk; add next year's periods when they are published.</p>
      <h4>Node colours</h4>
      <label class="fl inline"><input type="radio" name="scs" value="classic" ${st.nodeColors !== 'frame' ? 'checked' : ''}> Classic: category-coloured frame, thicker when critical; urgent tasks glow</label>
      <label class="fl inline"><input type="radio" name="scs" value="frame" ${st.nodeColors === 'frame' ? 'checked' : ''}> Criticality as frame (colour + thickness), urgency as fill colour; unrated stays white</label>
      <h4>Map layout</h4>
      <label class="fl inline"><input type="radio" name="sml" value="auto" ${!(st.mapLayout && st.mapLayout.mode === 'manual') ? 'checked' : ''}> Balanced automatically: the main categories are shared between the right and left of the title</label>
      <label class="fl inline"><input type="radio" name="sml" value="manual" ${st.mapLayout && st.mapLayout.mode === 'manual' ? 'checked' : ''}> Arranged by me: drag a main category to the right, left, above or below the title; it snaps into place there</label>
      <div class="irow btns"><button id="smlreset" ${st.mapLayout && st.mapLayout.sides && Object.keys(st.mapLayout.sides).length ? '' : 'disabled'}>Forget my arrangement</button><span class="hint">Only the main categories move; everything inside them is laid out automatically. Kept for all editions.</span></div>
      <h4>Notifications &amp; start-up</h4>
      <label class="fl inline"><input type="checkbox" id="sauto" ${sys.autostart ? 'checked' : ''}> Start in the tray when I log in to Windows</label>
      <label class="fl inline"><input type="checkbox" id="smorn" ${sys.morning.on ? 'checked' : ''}> Morning summary at <input type="time" id="smtime" value="${E(sys.morningTime)}"> even when the app is closed${sys.morning.on && sys.morning.next ? ' <span class="hint">(next: ' + E(sys.morning.next) + ')</span>' : ''}</label>
      <div class="irow btns"><button id="stoast">Show a test notification</button></div>
      <p class="hint">Show/hide the window anywhere with <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd>. Toasts appear when a task steps up in urgency or becomes overdue.</p>
      <h4>Data</h4><div class="kv"><span>Data folder</span><b class="path">${E(S.boot.dataDir)}</b><span>Dropbox root</span><b class="path">${E(S.boot.dropboxRoot || '—')}</b><span>This PC</span><b>${E(S.boot.machine)}</b></div>
      <div class="irow btns"><button id="sopen">${ICON('folder')} Open data folder</button><button id="smove">Use another data folder…</button><button id="spdf">${ICON('phone')} Update phone PDF now</button><button id="spdfo">Open phone PDF</button></div>
      <div class="irow btns"><button id="sexp">${ICON('copy')} Export backup…</button><button id="simp">${ICON('history')} Import backup…</button><span class="hint">Everything in one JSON file — keep a copy outside Dropbox.</span></div>
      <h4>Program</h4><div class="irow btns"><button id="srestart">Restart ${E(M.getAppName())}</button><button id="squit">Quit ${E(M.getAppName())} (Ctrl+Q)</button></div>
      <p class="hint">Closing the window only hides it (it keeps running in the tray for reminders). Quit stops it completely; everything is saved first.</p>
      </div><footer><button data-close>Cancel</button><button class="primary" id="ssave">Save</button></footer>`, 'wide');
    // opened from a category's right-click menu: go straight to its row
    if (opts.category) {
      const i = st.categories.findIndex(c => c.key === opts.category);
      const row = i >= 0 && dlg.querySelector(`.catrow[data-i="${i}"]`);
      if (row) {
        row.classList.add('flash');
        setTimeout(() => { row.scrollIntoView({ block: 'center' }); const inp = row.querySelector('[data-cn]'); if (inp) { inp.focus(); inp.select(); } }, 60);
      }
    }
    $('#srestart', dlg).onclick = async () => { await OTT.saveNow(); ott.restart(); };
    $('#squit', dlg).onclick = async () => { await OTT.saveNow(); ott.quit(); };
    const redraw = () => { $('#cats', dlg).innerHTML = catRows(); };
    dlg.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.cc) st.categories[+t.dataset.cc].color = t.value;
      if (t.dataset.cn) st.categories[+t.dataset.cn].name = t.value;
      if (t.dataset.sl) st.semesters[+t.dataset.sl].label = t.value;
      if (t.dataset.ss) st.semesters[+t.dataset.ss].start = t.value;
      if (t.dataset.se) st.semesters[+t.dataset.se].end = t.value;
      if (t.dataset.sk) st.semesters[+t.dataset.sk].kind = t.value;
    });
    dlg.addEventListener('click', async (e) => {
      const up = e.target.closest('[data-up]'), dn = e.target.closest('[data-dn]');
      if (up || dn) {
        const i = +(up || dn).dataset[up ? 'up' : 'dn'], step = up ? -1 : 1;
        let j = i + step;
        while (j >= 0 && j < st.categories.length && st.categories[j].archived) j += step;   // skip deleted ones
        if (j < 0 || j >= st.categories.length) return;
        [st.categories[i], st.categories[j]] = [st.categories[j], st.categories[i]]; redraw();
      }
      const del = e.target.closest('[data-delcat]'), keep = e.target.closest('[data-keep]'), res = e.target.closest('[data-restorecat]');
      if (del) { st.categories[+del.dataset.delcat].archived = true; redraw(); }
      if (keep) { delete st.categories[+keep.dataset.keep].archived; redraw(); }
      if (res) { delete st.categories[+res.dataset.restorecat].archived; wasArchived.delete(st.categories[+res.dataset.restorecat].key); redraw(); }
      const ds = e.target.closest('[data-delsem]');
      if (ds) { st.semesters.splice(+ds.dataset.delsem, 1); $('#sems', dlg).innerHTML = semRows(); }
      if (e.target.closest('#addsem')) { const last = st.semesters[st.semesters.length - 1]; const s = last ? M.addDays(last.end, 1) : M.todayStr(); st.semesters.push({ label: 'New period', start: s, end: M.addDays(s, 20), kind: 'teach' }); $('#sems', dlg).innerHTML = semRows(); }
      if (e.target.closest('#resetsem')) { st.semesters = M.DTU_PERIODS.map(p => ({ ...p })); $('#sems', dlg).innerHTML = semRows(); }
      const dt = e.target.closest('[data-deltpl]');
      if (dt) {
        const tp = templates[+dt.dataset.deltpl];
        await ott.deleteTemplate(tp.file);
        templates = await ott.listTemplates();
        $('#tpls', dlg).innerHTML = tplRows();
        OTT.toast('Template “' + tp.name + '” deleted (a copy is kept in templates\\.deleted)');
      }
    });
    $('#addcat', dlg).onclick = () => { const key = 'c' + M.uid().slice(-6); st.categories.push({ key, name: 'New category', color: '#7b8794' }); redraw(); };
    $('#stoast', dlg).onclick = () => ott.testToast();
    $('#sopen', dlg).onclick = () => ott.openDataFolder();
    $('#sexp', dlg).onclick = () => { close(); D.exportBackup(); };
    $('#simp', dlg).onclick = () => { close(); D.importBackup(); };
    $('#smove', dlg).onclick = async () => { if (await D.confirm('Use another data folder?', 'The app restarts and uses (or creates) data in the folder you pick. The current folder is left untouched.', 'Choose folder…')) { await OTT.saveNow(); ott.chooseDataFolder(); } };
    $('#spdf', dlg).onclick = async () => { const r = await ott.pdfNow(); OTT.toast(r.ok ? 'Phone PDF updated' : 'PDF failed', r.ok ? '' : 'error'); };
    $('#spdfo', dlg).onclick = () => ott.pdfOpen();
    $('#smlreset', dlg).onclick = (e) => { st.mapLayout = Object.assign({}, st.mapLayout, { sides: {} }); e.target.disabled = true; OTT.toast('Arrangement forgotten — Save to apply (the categories go back to the automatic sides).'); };
    $('#ssave', dlg).onclick = async () => {
      st.defaultLead = Math.max(1, +$('#slead', dlg).value || 14);
      st.currency = $('#scur', dlg).value.trim().toUpperCase() || 'DKK';
      st.nodeColors = ($('input[name="scs"]:checked', dlg) || {}).value === 'frame' ? 'frame' : 'classic';
      st.mapLayout = { mode: ($('input[name="sml"]:checked', dlg) || {}).value === 'manual' ? 'manual' : 'auto', sides: (st.mapLayout && st.mapLayout.sides) || {} };
      st.semesters = st.semesters.filter(p => p.start && p.end).map(p => p.end < p.start ? Object.assign(p, { start: p.end, end: p.start }) : p);
      for (const c of st.categories) c.name = c.name.trim() || 'Untitled';
      if (!st.categories.some(c => !c.archived)) return OTT.toast('Keep at least one category.', 'warn');
      const newlyDeleted = st.categories.filter(c => c.archived && !(S.settings.categories.find(o => o.key === c.key) || {}).archived);
      const r = await ott.saveSettings(st);
      if (r.error) return OTT.toast(r.error, 'error');
      // the deleted categories' content in this edition goes to Trash (undoable, restorable)
      for (const c of newlyDeleted) C.removeCategory('cat-' + c.key, c.name);
      S.settings = st;
      M.syncCategories(S.ed, st); S.dirtyEd = true; OTT.scheduleSave();
      const auto = $('#sauto', dlg).checked, morn = $('#smorn', dlg).checked, mt = $('#smtime', dlg).value || '08:00';
      if (auto !== sys.autostart) await ott.setAutostart(auto);
      if (morn !== sys.morning.on || mt !== sys.morningTime) { const m = await ott.setMorning(morn, mt); if (m && m.ok === false) OTT.toast('Could not set the morning task: ' + m.error, 'error', 6000); }
      close();
      S.der = null; OTT.inspector.invalidate(); OTT.render();
      OTT.toast('Settings saved');
    };
  };

  // ---------- help ----------
  D.help = () => {
    const k = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
    open(head(M.getAppName() + ' — keys & gestures') + `<div class="dbody help"><table>
      ${k('<kbd>Tab</kbd>', 'Add subtask (in People: group → person → task)')}
      ${k('<kbd>Enter</kbd>', 'Add task below')}
      ${k('type / <kbd>F2</kbd>', 'Rename (double-click renames tasks without subtasks)')}
      ${k('Mouse wheel on a task without subtasks', 'Step progress: Not started → Started → Nearly done → Done')}
      ${k('<kbd>Ctrl</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd>', 'Same, from the keyboard')}
      ${k('Wheel elsewhere / drag background', 'Zoom / pan · double-click background: fit')}
      ${k('Arrows', 'Move selection')}
      ${k('<kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> · <kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd>', 'Reorder · outdent/indent')}
      ${k('Drag a task', 'Onto a task: becomes its subtask · upper/lower edge: before/after')}
      ${k('<kbd>Space</kbd> · double-click', 'Fold / unfold · fold or unfold everything below')}
      ${k('<kbd>Ctrl</kbd>+<kbd>Enter</kbd> · <kbd>Esc</kbd>', 'Focus on branch · leave focus')}
      ${k('<kbd>Ctrl</kbd>+<kbd>X</kbd>/<kbd>C</kbd>/<kbd>V</kbd>', 'Cut / copy / paste branches. Indented text from Word, mail etc. pastes as tasks; copied branches paste elsewhere as indented text.')}
      ${k('<kbd>Shift</kbd>/<kbd>Ctrl</kbd>+click', 'Select several items (in the outline Shift selects a range). Then Ctrl+C or Ctrl+X, click the target, Ctrl+V — or drag them (hold Ctrl to copy), or right-click › Move to… / Copy to…; Del deletes them; Esc clears.')}
      ${k('<kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd>', 'Undo / redo (unlimited)')}
      ${k('<kbd>Del</kbd>', 'Delete (to Trash)')}
      ${k('<kbd>Ctrl</kbd>+<kbd>F</kbd>, <kbd>F3</kbd>', 'Search, next hit')}
      ${k('<kbd>Ctrl</kbd>+<kbd>1</kbd>…<kbd>5</kbd>', 'Map · Tree · Outline · Matrix · Calendar')}
      ${k('Calendar', 'drag down over days = new period · double-click a day = deadline · click an item = status · double-click = show in tree')}
      ${k('Drop files on a task', 'Attach (Dropbox files linked in place; others or <kbd>Ctrl</kbd>+drop copied into the tree folder)')}
      ${k('<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd>', 'Show / hide ' + E(M.getAppName()) + ' from anywhere')}
      </table>
      <h4>Reading the map</h4><p><b>Ring</b> = progress. <b>Bold, coloured border</b> = more critical. <b>Amber / red glow</b> = urgent / very urgent (deadlines raise urgency automatically ${S.settings.defaultLead || 14} and ${M.FINAL_DAYS} days ahead). <b>Red border</b> = overdue. Dashed curves link related tasks across categories.</p>
      </div><footer><button class="primary" data-close>OK</button></footer>`, 'wide');
  };
})();
