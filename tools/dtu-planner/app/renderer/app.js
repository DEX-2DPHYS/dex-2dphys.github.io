/* One Todo Tree — renderer core: state, transactions/undo, saving, commands, clipboard, keys. */
'use strict';
const M = window.OTTModel;
const OTT = window.OTT = {};
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const E = M.escapeHtml;
const clone = (o) => JSON.parse(JSON.stringify(o));

const S = OTT.S = {
  boot: null, settings: null, people: { people: {} }, editions: [], ed: null, der: null,
  view: 'map', sel: null, focus: 'root', clip: null, undo: [], redo: [],
  dirtyEd: false, dirtyPeople: false, saveState: 'saved', savedAt: null,
  search: '', hits: [], hitIdx: 0, showLinks: true, linkFrom: null, catFilter: null,
  inspectorOpen: true, ui: {},
  multi: [], multiAnchor: null, pickTo: null,   // multiple selection (Shift/Ctrl+click) and "Move/Copy to… click target"
};
OTT.views = {};

// ---------- helpers ----------
OTT.node = (id) => S.ed.nodes[id];
OTT.d = (id) => { if (!S.der) S.der = M.derive(S.ed, S.settings); return S.der.get(id) || {}; };
OTT.catOf = (key) => S.settings.categories.find(c => c.key === key) || { name: key, color: '#8a94a3' };
OTT.catColor = (key) => OTT.catOf(key).color;
OTT.isNewest = () => !S.editions.length || S.editions[0].id === S.ed.id;
OTT.person = (pid) => S.people.people[pid];
OTT.initials = (name) => String(name || '?').split(/[\s-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
OTT.fmtDate = (s) => { if (!s) return ''; const [y, m, d] = s.split('-').map(Number); const dt = new Date(y, m - 1, d); const thisYear = new Date().getFullYear() === y; return dt.toLocaleDateString('en-GB', thisYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: '2-digit' }); };
OTT.dmy = (s) => { if (!s) return ''; const [y, m, d] = s.split('-'); return d + '/' + m + '/' + y.slice(2); };
/** "12–16 May", "28 May – 2 Jun" */
OTT.fmtRange = (a, b) => {
  if (!b || a === b) return OTT.fmtDate(a);
  const [ya, ma, da] = a.split('-').map(Number), [yb, mb, db] = b.split('-').map(Number);
  if (ya === yb && ma === mb) return da + '–' + OTT.fmtDate(b);
  return OTT.fmtDate(a) + ' – ' + OTT.fmtDate(b);
};
OTT.dueLabel = (d) => {
  if (!d.deadline) return '';
  if (d.end) {   // a period (event, travel…): never 'late'
    if (d.done) return OTT.fmtRange(d.deadline, d.end);
    if (d.now) return 'now';
    if (d.ended) return 'ended';
    if (d.days === 1) return 'tomorrow';
    if (d.days < 7) return 'in ' + d.days + 'd';
    return OTT.fmtRange(d.deadline, d.end);
  }
  if (d.done) return OTT.fmtDate(d.deadline);
  if (d.days < 0) return (-d.days) + 'd late';
  if (d.days === 0) return 'today';
  if (d.days === 1) return 'tomorrow';
  if (d.days < 7) return 'in ' + d.days + 'd';
  return OTT.fmtDate(d.deadline);
};
OTT.title = (n) => n.title || (n.kind === 'person' ? '(new person)' : '(untitled)');

// ---------- transactions & undo ----------
/** Run fn(ctx) as one undoable step. ctx.touch(id) before changing a node; ctx.add(node); ctx.remove(id). */
function tx(label, fn, opts) {
  opts = opts || {};
  const before = new Map();
  let trashBefore = null;
  const ctx = {
    touch(id) { if (!before.has(id)) before.set(id, S.ed.nodes[id] ? clone(S.ed.nodes[id]) : null); return S.ed.nodes[id]; },
    add(node) { if (!before.has(node.id)) before.set(node.id, S.ed.nodes[node.id] ? clone(S.ed.nodes[node.id]) : null); S.ed.nodes[node.id] = node; return node; },
    remove(id) { ctx.touch(id); delete S.ed.nodes[id]; },
    touchTrash() { if (!trashBefore) trashBefore = S.ed.trash.slice(); },
  };
  const selBefore = S.sel;
  const r = fn(ctx);
  if (!before.size && !trashBefore) return r;
  const stamp = M.nowIso();
  for (const id of before.keys()) if (S.ed.nodes[id]) S.ed.nodes[id].modified = stamp;
  const after = new Map();
  for (const id of before.keys()) after.set(id, S.ed.nodes[id] ? clone(S.ed.nodes[id]) : null);
  const top = S.undo[S.undo.length - 1];
  if (opts.merge && top && top.merge === opts.merge && Date.now() - top.t < 4000) {
    for (const [id, v] of before) if (!top.before.has(id)) top.before.set(id, v);
    for (const [id, v] of after) top.after.set(id, v);
    top.t = Date.now();
  } else {
    S.undo.push({ label, before, after, trashBefore, trashAfter: trashBefore ? S.ed.trash.slice() : null, edId: S.ed.id, sel: selBefore, selAfter: S.sel, merge: opts.merge, t: Date.now() });
    if (S.undo.length > 1000) S.undo.shift();
  }
  S.redo = [];
  changed();
  return r;
}
OTT.tx = tx;

function applyStates(states) { for (const [id, n] of states) { if (n) S.ed.nodes[id] = clone(n); else delete S.ed.nodes[id]; } }
OTT.undo = () => {
  const e = S.undo.pop();
  if (!e) return OTT.toast('Nothing to undo');
  applyStates(e.before);
  if (e.trashBefore) S.ed.trash = e.trashBefore.slice();
  S.redo.push(e);
  if (e.sel && S.ed.nodes[e.sel]) S.sel = e.sel;
  changed();
  OTT.toast('Undid: ' + e.label);
};
OTT.redoCmd = () => {
  const e = S.redo.pop();
  if (!e) return OTT.toast('Nothing to redo');
  applyStates(e.after);
  if (e.trashAfter) S.ed.trash = e.trashAfter.slice();
  S.undo.push(e);
  if (e.selAfter && S.ed.nodes[e.selAfter]) S.sel = e.selAfter;
  changed();
  OTT.toast('Redid: ' + e.label);
};

/** UI-state change that is saved but not undoable (collapse). */
OTT.setQuiet = (id, field, value) => { S.ed.nodes[id][field] = value; S.dirtyEd = true; S.der = null; scheduleSave(); OTT.render(); };

function changed() { S.der = null; S.dirtyEd = true; scheduleSave(); OTT.render(); }
OTT.changed = changed;

// ---------- saving ----------
let saveTimer = null, saving = false, saveAgain = false, retryTimer = null;
function scheduleSave(ms) { clearTimeout(saveTimer); setSaveState('pending'); saveTimer = setTimeout(saveNow, ms == null ? 600 : ms); }
OTT.scheduleSave = scheduleSave;
OTT.peopleChanged = () => { S.dirtyPeople = true; scheduleSave(); };

async function saveNow(force) {
  clearTimeout(saveTimer);
  if (S.importing) return;   // an import has replaced the files on disk; the window reloads, nothing in memory may be written back
  if (!S.ed || (!S.dirtyEd && !S.dirtyPeople)) { if (!saving) setSaveState('saved'); return; }
  if (saving) { saveAgain = true; return; }
  saving = true; setSaveState('saving');
  let failed = null;
  try {
    if (S.dirtyPeople) {
      S.dirtyPeople = false;
      let r = await ott.savePeople(S.people);
      if (r && r.conflict) {
        // people.json is shared by editions and PCs: merge (union; ours wins per person)
        const theirs = (r.theirs && r.theirs.people) || {};
        S.people.people = Object.assign({}, theirs, S.people.people);
        r = await ott.savePeople(S.people, { force: true });
      }
      if (!r || r.error) { S.dirtyPeople = true; failed = (r && r.error) || 'people not saved'; }
    }
    if (S.dirtyEd) {
      S.dirtyEd = false;
      const r = await ott.saveEdition(S.ed, { force: !!force });
      if (r && r.conflict) { S.dirtyEd = true; saving = false; await OTT.dialogs.conflict(r.theirs); return; }
      if (!r || r.error) { S.dirtyEd = true; failed = (r && r.error) || 'not saved'; }
      else S.savedAt = new Date();
    }
  } catch (e) { failed = e.message; S.dirtyEd = true; }
  saving = false;
  if (failed) {
    setSaveState('error', failed);
    clearTimeout(retryTimer); retryTimer = setTimeout(() => saveNow(), 5000);
    return;
  }
  if (saveAgain || S.dirtyEd || S.dirtyPeople) { saveAgain = false; return saveNow(); }
  setSaveState('saved');
}
OTT.saveNow = saveNow;
OTT.flush = async () => { await saveNow(); };

function setSaveState(st, msg) {
  S.saveState = st;
  const el = $('#savestate');
  if (!el) return;
  el.className = 'no-drag ss-' + st;
  const t = S.savedAt ? S.savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
  el.innerHTML = st === 'saved' ? ICON('check') + '<span>Saved' + (t ? ' ' + t : '') + '</span>'
    : st === 'error' ? ICON('warn') + '<span>Not saved — retrying</span>'
    : '<span class="spin"></span><span>Saving…</span>';
  el.title = st === 'error' ? 'Save failed: ' + msg + '\nYour changes are kept in memory and retried every 5 s.' : 'Every change is saved automatically, with a journal and daily snapshots.';
}
OTT.setSaveState = setSaveState;

// ---------- loading editions ----------
OTT.loadEdition = async (id) => {
  if (S.ed) { await saveNow(); }
  const r = await ott.loadEdition(id);
  if (r.error) { OTT.toast('Could not open edition: ' + r.error, 'error'); return false; }
  S.ed = r.edition; S.der = null; S.undo = []; S.redo = []; S.focus = 'root'; S.dirtyEd = false; S.spot = null; S.lens = null;
  S.multi = []; S.pickTo = null; document.body.classList.remove('linking');
  S.sel = (S.ui.sel && S.ui.sel[id] && S.ed.nodes[S.ui.sel[id]]) ? S.ui.sel[id] : 'root';
  S.editions = await ott.listEditions();
  if (r.recovered) OTT.dialogs.info('Edition recovered', 'The edition file could not be read, so the newest backup was loaded instead: <b>' + E(r.recovered) + '</b>.<br>The damaged file was kept next to it. Your next change saves the recovered version.');
  else if (r.fixes && r.fixes.length) console.warn('repairs', r.fixes);
  if (r.lock) OTT.toast('Heads-up: this edition is also open on ' + r.lock.machine + '. Changes made there will be detected before saving.', 'warn', 8000);
  OTT.render();
  OTT.views.map && OTT.views.map.fitSoon && OTT.views.map.fitSoon();
  return true;
};

// ---------- people ----------
OTT.findPersonByName = (name) => {
  const k = String(name).trim().toLowerCase();
  return Object.values(S.people.people).find(p => (p.name || '').trim().toLowerCase() === k) || null;
};
/** Create a person record + node in People › Other (current edition). Part of an outer tx if ctx given. */
OTT.createPerson = (name, ctx, groupId) => {
  const pid = 'p' + M.uid();
  S.people.people[pid] = { id: pid, name: String(name).trim(), org: '', email: '', created: M.nowIso() };
  OTT.peopleChanged();
  const gid = groupId || (S.ed.nodes['cat-people-other'] ? 'cat-people-other' : M.PEOPLE_CAT);
  if (S.ed.nodes[gid]) {
    const run = (c) => { const g = c.touch(gid); const n = c.add(M.newNode({ parent: gid, kind: 'person', person: pid, title: name })); g.children.push(n.id); };
    if (ctx) run(ctx); else tx('Add person', run);
  }
  return pid;
};
OTT.personNodeId = (pid) => Object.keys(S.ed.nodes).find(id => S.ed.nodes[id].person === pid) || null;

// ---------- commands ----------
const C = OTT.cmd = {};

C.select = (id, opts) => {
  if (!id || !S.ed.nodes[id]) return;
  if (S.linkFrom && S.linkFrom !== id) { C.addRelation(S.linkFrom, id); S.linkFrom = null; document.body.classList.remove('linking'); }
  if (S.pickTo) {   // "Move to… / Copy to…": this click names the target
    const p = S.pickTo;
    if (p.ids.includes(id)) return OTT.toast('Pick a place outside the selected items (Esc cancels).', 'warn');
    S.pickTo = null; document.body.classList.remove('linking');
    if (p.copy) C.copyTo(p.ids, id, null); else C.moveMany(p.ids, id, null);
    return;
  }
  if (!(opts && opts.keepMulti)) { S.multi = []; S.multiAnchor = id; }
  S.sel = id;
  S.ui.sel = S.ui.sel || {}; S.ui.sel[S.ed.id] = id; saveUiSoon();
  if (opts && opts.reveal) C.reveal(id);
  OTT.render();
  if (opts && opts.scroll !== false) {
    const v = OTT.activeView();
    if (v && v.scrollTo) setTimeout(() => v.scrollTo(id), 20);
  }
};

C.reveal = (id) => {
  // expand collapsed ancestors, leave focus if node is outside it
  let n = S.ed.nodes[S.ed.nodes[id].parent];
  let changedAny = false;
  while (n) { if (n.collapsed) { n.collapsed = false; changedAny = true; } n = S.ed.nodes[n.parent]; }
  if (S.focus !== 'root' && !M.isAncestor(S.ed, S.focus, id)) S.focus = 'root';
  if (changedAny) { S.dirtyEd = true; S.der = null; scheduleSave(); }
};

C.addChild = (pid, title) => {
  pid = pid || S.sel || 'root';
  const p = S.ed.nodes[pid];
  if (!p) return;
  if (pid === 'root') return OTT.toast('Categories are set in Settings. Select a category and press Tab to add a task.');
  if (p.kind === 'info') return OTT.toast('An information note has no subtasks — add it next to the note instead (Enter).');
  const kind = M.childKind(S.ed, pid);
  let newId;
  tx(kind === 'person' ? 'Add person' : kind === 'group' ? 'Add group' : 'Add task', (c) => {
    const par = c.touch(pid);
    const n = M.newNode({ parent: pid, title: title || '' });
    if (kind) n.kind = kind;
    if (kind === 'person') {
      const pidp = 'p' + M.uid();
      S.people.people[pidp] = { id: pidp, name: title || '', org: '', email: '', created: M.nowIso() };
      n.person = pidp; OTT.peopleChanged();
    }
    c.add(n);
    par.children.push(n.id);
    par.collapsed = false;
    newId = n.id;
  });
  S.sel = newId;
  OTT.render();
  if (!title) OTT.startEdit(newId, { isNew: true });
  return newId;
};

C.addSibling = (id) => {
  id = id || S.sel;
  const n = S.ed.nodes[id];
  if (!n || n.kind === 'root' || n.kind === 'category') return C.addChild(id);
  const pid = n.parent;
  const kind = n.kind === 'group' || n.kind === 'person' ? n.kind : null;
  let newId;
  tx('Add task', (c) => {
    const par = c.touch(pid);
    const s = M.newNode({ parent: pid });
    if (kind) s.kind = kind;
    if (kind === 'person') { const pp = 'p' + M.uid(); S.people.people[pp] = { id: pp, name: '', org: '', email: '', created: M.nowIso() }; s.person = pp; OTT.peopleChanged(); }
    c.add(s);
    par.children.splice(par.children.indexOf(id) + 1, 0, s.id);
    newId = s.id;
  });
  S.sel = newId;
  OTT.render();
  OTT.startEdit(newId, { isNew: true });
};

C.rename = (id, title) => {
  const n = S.ed.nodes[id];
  if (!n || n.title === title) return;
  if (n.kind === 'category') return OTT.toast('Rename categories in Settings.');
  tx('Rename', (c) => { c.touch(id).title = title; });
  if (n.person && S.people.people[n.person]) { S.people.people[n.person].name = title; OTT.peopleChanged(); }
};

// ---------- subcategories ----------
/** Can this task become a subcategory? Any task outside People, wherever it sits (its subtasks stay inside). */
C.canMakeGroup = (id) => {
  const n = S.ed.nodes[id];
  if (!n || n.kind) return false;
  return !M.inPeople(S.ed, id);
};
/** Can this subcategory become a task again? Not in People, and only if nothing inside is a person/subcategory. */
// ---------- information notes: text + links, no dates, progress or ratings ----------
C.addInfo = (pid) => {
  pid = pid || S.sel;
  let p = S.ed.nodes[pid];
  if (!p || pid === 'root' || pid === M.PEOPLE_CAT) return;
  if (p.kind === 'info') { pid = p.parent; p = S.ed.nodes[pid]; }   // next to a note, not inside it
  let newId;
  tx('Add information note', (c) => {
    const par = c.touch(pid);
    const n = M.newNode({ parent: pid, kind: 'info' });
    c.add(n); par.children.push(n.id); par.collapsed = false; newId = n.id;
  });
  S.sel = newId;
  OTT.render();
  OTT.startEdit(newId, { isNew: true });
  return newId;
};
C.canMakeInfo = (id) => { const n = S.ed.nodes[id]; return !!n && !n.kind && !n.children.length && !M.inPeople(S.ed, id); };
C.toInfo = (id) => {
  id = id || S.sel;
  if (!C.canMakeInfo(id)) return;
  tx('Make information note', (c) => { c.touch(id).kind = 'info'; });
  OTT.toast('Now an information note: no date, progress or rating (they are kept in case you turn it back into a task)');
};
C.infoToTask = (id) => {
  id = id || S.sel;
  const n = S.ed.nodes[id];
  if (!n || n.kind !== 'info') return;
  tx('Make task', (c) => { delete c.touch(id).kind; });
};
OTT.urlsIn = (text) => [...new Set(String(text || '').match(/\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/gi) || [])];
/** Notes as HTML with clickable links (data-url) */
OTT.linkify = (text) => E(text || '').replace(/\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/gi, (u) => { const raw = u.replace(/&amp;/g, '&'); return `<a href="#" data-url="${E(raw)}" title="${E(raw)}">${u}</a>`; }).replace(/\n/g, '<br>');
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[data-url]');
  if (!a) return;
  e.preventDefault();
  ott.openAttachment({ kind: 'url', url: a.dataset.url }).then(r => { if (r && r.error) OTT.toast(r.error, 'error'); });
});

C.canMakeTask = (id) => {
  const n = S.ed.nodes[id];
  if (!n || n.kind !== 'group' || M.inPeople(S.ed, id)) return false;
  return n.children.every(c => !S.ed.nodes[c].kind);
};
C.toGroup = (id) => {
  id = id || S.sel;
  if (!C.canMakeGroup(id)) {
    const n = S.ed.nodes[id];
    return OTT.toast(n && n.kind ? 'This is not a task.' : 'In People, use “Add subgroup” on a group instead.');
  }
  tx('Make subcategory', (c) => { c.touch(id).kind = 'group'; });
  OTT.toast('“' + OTT.title(S.ed.nodes[id]) + '” is now a subcategory (Tab adds tasks inside it)');
};
C.toTask = (id) => {
  id = id || S.sel;
  if (!C.canMakeTask(id)) return OTT.toast(M.inPeople(S.ed, id) ? 'Groups in People stay groups.' : 'Move the subcategories inside it out first.');
  tx('Make task', (c) => { delete c.touch(id).kind; });
};
/** Add an (empty) subcategory under a category or subcategory, then rename it in place. */
C.addGroup = (pid) => {
  pid = pid || S.sel;
  const p = S.ed.nodes[pid];
  if (!p || !(p.kind === 'category' || p.kind === 'group')) return OTT.toast('Select a category or subcategory first.');
  let newId;
  tx(M.inPeople(S.ed, pid) ? 'Add group' : 'Add subcategory', (c) => {
    const par = c.touch(pid);
    const n = M.newNode({ parent: pid, kind: 'group' });
    c.add(n);
    // subcategories go before the loose tasks so they read like headings
    let i = 0; while (i < par.children.length && S.ed.nodes[par.children[i]] && S.ed.nodes[par.children[i]].kind === 'group') i++;
    par.children.splice(i, 0, n.id);
    par.collapsed = false;
    newId = n.id;
  });
  S.sel = newId;
  OTT.render();
  OTT.startEdit(newId, { isNew: true });
};

// ---------- task/subcategory <-> main category ----------
const EXTRA_COLORS = ['#0f9d8a', '#c2185b', '#5d6bd6', '#8d6e63', '#7cb342', '#f4511e', '#3949ab', '#00838f', '#ad1457', '#6d4c41', '#9e9d24', '#5e35b1'];
function nextCategoryColor() {
  const used = new Set(S.settings.categories.map(c => c.color.toLowerCase()));
  return EXTRA_COLORS.find(c => !used.has(c)) || EXTRA_COLORS[S.settings.categories.length % EXTRA_COLORS.length];
}
/** Point every 'related' link at oldId to newId instead (inside a tx). */
function relinkRelations(c, oldId, newId) {
  for (const n of Object.values(S.ed.nodes)) if (n.relates && n.relates.includes(oldId)) { const x = c.touch(n.id); x.relates = x.relates.map(r => r === oldId ? newId : r); }
}
C.canPromote = (id) => { const n = S.ed.nodes[id]; return !!n && (!n.kind || n.kind === 'group') && !M.inPeople(S.ed, id); };
/** A task or subcategory becomes a new main category (settings + this edition). */
C.promoteToCategory = async (id) => {
  id = id || S.sel;
  if (!C.canPromote(id)) return OTT.toast(M.inPeople(S.ed, id) ? 'Items in People cannot become categories.' : 'Only tasks and subcategories can become a category.');
  const n = S.ed.nodes[id];
  const lost = [n.deadline && 'deadline', (n.crit || n.urg) && 'ratings', n.owner && 'owner', n.budget && 'budget'].filter(Boolean);
  const name = (n.title || 'New category').trim();
  const key = 'c' + M.uid().slice(-6);
  // place it right after the category it came from
  let top = n; while (top && top.kind !== 'category') top = S.ed.nodes[top.parent];
  const settings = clone(S.settings);
  const at = top ? settings.categories.findIndex(c => c.key === top.cat) + 1 : settings.categories.length;
  settings.categories.splice(at, 0, { key, name, color: nextCategoryColor() });
  const r = await ott.saveSettings(settings);
  if (r && r.error) return OTT.toast(r.error, 'error');
  S.settings = settings;
  const catId = 'cat-' + key;
  tx('Make main category', (c) => {
    const cat = c.add(M.newNode({ id: catId, parent: 'root', kind: 'category', cat: key, title: name, notes: n.notes, attachments: n.attachments.slice(), relates: n.relates.slice() }));
    for (const k of n.children) c.touch(k).parent = catId;
    cat.children = n.children.slice();
    const par = c.touch(n.parent); par.children = par.children.filter(x => x !== id);
    const root = c.touch('root'); const i = top ? root.children.indexOf(top.id) + 1 : root.children.length; root.children.splice(i, 0, catId);
    relinkRelations(c, id, catId);
    c.remove(id);
  });
  M.syncCategories(S.ed, S.settings);
  S.sel = catId;
  C.reveal(catId); OTT.render(); OTT.views.map.fitSoon();
  OTT.toast('“' + name + '” is now a main category' + (lost.length ? ' (its ' + lost.join(', ') + ' did not carry over — categories have none)' : ''), 'info', 5000);
};
C.canDemote = (catId) => { const n = S.ed.nodes[catId]; return !!n && n.kind === 'category' && catId !== M.PEOPLE_CAT; };
/** A main category moves under another category/subcategory as a subcategory ('group') or a task. */
C.demoteCategory = async (catId, targetId, asKind) => {
  if (!C.canDemote(catId)) return;
  const cat = S.ed.nodes[catId];
  const target = S.ed.nodes[targetId];
  if (!target || M.isAncestor(S.ed, catId, targetId)) return OTT.toast('Pick another category.', 'warn');
  const hasGroups = cat.children.some(k => S.ed.nodes[k].kind === 'group');
  const kind = asKind === 'task' && !hasGroups ? null : 'group';
  let newId;
  tx('Move category into “' + OTT.title(target) + '”', (c) => {
    const n = c.add(M.newNode({ parent: targetId, title: cat.title, notes: cat.notes, attachments: cat.attachments.slice(), relates: cat.relates.slice() }));
    if (kind) n.kind = kind;
    for (const k of cat.children) c.touch(k).parent = n.id;
    n.children = cat.children.slice();
    const t = c.touch(targetId);
    if (kind === 'group') { let i = 0; while (i < t.children.length && S.ed.nodes[t.children[i]] && S.ed.nodes[t.children[i]].kind === 'group') i++; t.children.splice(i, 0, n.id); }
    else t.children.push(n.id);
    t.collapsed = false;
    const root = c.touch('root'); root.children = root.children.filter(x => x !== catId);
    relinkRelations(c, catId, n.id);
    c.remove(catId);
    newId = n.id;
  });
  // retire the category in settings (older editions keep showing it; Settings can restore it)
  const settings = clone(S.settings);
  const def = settings.categories.find(x => 'cat-' + x.key === catId);
  if (def) def.archived = true;
  const r = await ott.saveSettings(settings);
  if (r && r.error) OTT.toast(r.error, 'error'); else S.settings = settings;
  if (S.focus === catId) S.focus = 'root';
  S.sel = newId;
  C.reveal(newId); OTT.render(); OTT.views.map.fitSoon();
  OTT.toast('“' + cat.title + '” is now a ' + (kind ? 'subcategory' : 'task') + ' in “' + OTT.title(target) + '”' + (asKind === 'task' && hasGroups ? ' (kept as subcategory because it contains subcategories)' : ''), 'info', 5000);
};

/** Throw away a just-created, still empty node: revert its creating step instead of trashing it. */
C.discardNew = (id) => {
  const n = S.ed.nodes[id];
  if (!n) return;
  const top = S.undo[S.undo.length - 1];
  if (n.person && S.people.people[n.person] && !S.people.people[n.person].name) { delete S.people.people[n.person]; OTT.peopleChanged(); }
  if (top && top.before.has(id) && top.before.get(id) === null) {
    S.undo.pop();
    applyStates(top.before);
    if (S.sel === id) S.sel = top.sel && S.ed.nodes[top.sel] ? top.sel : n.parent;
    S.der = null; S.dirtyEd = true; scheduleSave(); OTT.render();
  } else C.remove(id, 'Discard');
};

C.setField = (id, field, value, label, merge) => {
  const n = S.ed.nodes[id];
  if (!n || JSON.stringify(n[field]) === JSON.stringify(value)) return;
  tx(label || 'Edit ' + field, (c) => { c.touch(id)[field] = value; }, merge ? { merge: field + id } : null);
};

C.setStage = (id, stage) => {
  const d = OTT.d(id);
  if (!d.leaf) return false;
  stage = Math.max(0, Math.min(M.STAGE_MAX, stage));
  if (S.ed.nodes[id].stage === stage) return false;
  tx('Progress: ' + M.STAGES[stage], (c) => { c.touch(id).stage = stage; }, { merge: 'stage' + id });
  return true;
};

// ---------- timeline: dated steps towards the deadline ----------
const tlSet = (id, label, fn) => tx(label, (c) => { const x = c.touch(id); const list = (x.timeline || []).map(s => Object.assign({}, s)); fn(list, x); x.timeline = M.sortSteps(list); if (!x.timeline.length) { delete x.timeline; delete x.tlPin; } });
const mkTodos = (texts) => (texts || []).map(t => ({ id: M.uid(), text: String(t.text != null ? t.text : t), done: !!t.done }));
/** steps: [{date, title, todos?: [text]}] or {attachTo: sid, todos} (to-dos for an existing step).
 *  A date line without a title whose date already has a step adds its to-dos to that step. */
C.addSteps = (id, steps) => {
  if (!steps.length) return;
  const nTodo = steps.reduce((k, s) => k + ((s.todos || []).length), 0), nStep = steps.filter(s => !s.attachTo).length;
  const label = nStep > 1 ? 'Add ' + nStep + ' timeline steps' : nStep ? 'Add step “' + (steps.find(s => !s.attachTo).title || steps.find(s => !s.attachTo).date) + '”' : 'Add ' + nTodo + ' to-do' + (nTodo === 1 ? '' : 's');
  tlSet(id, label, (list) => {
    for (const s of steps) {
      const into = s.attachTo ? list.find(x => x.id === s.attachTo)
        : (!s.title && s.todos && s.todos.length ? list.find(x => x.date === s.date) : null);
      if (into) {
        const add = mkTodos(s.todos);
        if (add.length) { into.todos = (into.todos || []).map(t => Object.assign({}, t)).concat(add); into.done = false; }
        continue;
      }
      const st = { id: M.uid(), title: s.title || '', date: s.date, done: !!s.done };
      if (s.todos && s.todos.length) st.todos = mkTodos(s.todos);
      list.push(st);
    }
  });
};
C.setStep = (id, sid, patch, label) => tlSet(id, label || 'Edit step', (list) => { const s = list.find(x => x.id === sid); if (s) Object.assign(s, patch); });
C.toggleStep = (id, sid) => {
  const s = ((S.ed.nodes[id] || {}).timeline || []).find(x => x.id === sid);
  if (!s) return;
  const patch = { done: !s.done };
  if (!s.done && s.todos && s.todos.length) patch.todos = s.todos.map(t => Object.assign({}, t, { done: true }));   // the whole step done: its to-dos too
  C.setStep(id, sid, patch, (s.done ? 'Reopen: ' : 'Done: ') + M.stepTitle(s));
};
/** To-dos under a step. Ticking the last open one marks the step done; unticking one reopens it. */
const todoSet = (id, sid, label, fn) => tlSet(id, label, (list) => {
  const s = list.find(x => x.id === sid);
  if (!s) return;
  const td = (s.todos || []).map(t => Object.assign({}, t));
  fn(td, s);
  if (td.length) { s.todos = td; s.done = td.every(t => t.done); } else delete s.todos;
});
C.toggleTodo = (id, sid, tid) => { const t = OTT.todoOf(id, sid, tid); if (t) todoSet(id, sid, (t.done ? 'Reopen: ' : 'Done: ') + t.text, (td) => { const x = td.find(y => y.id === tid); x.done = !x.done; }); };
C.setTodo = (id, sid, tid, text) => { const t = OTT.todoOf(id, sid, tid); if (!t || t.text === text) return; if (!String(text).trim()) return C.removeTodo(id, sid, tid); todoSet(id, sid, 'Edit to-do', (td) => { td.find(y => y.id === tid).text = text; }); };
C.removeTodo = (id, sid, tid) => todoSet(id, sid, 'Remove to-do', (td) => { const i = td.findIndex(y => y.id === tid); if (i >= 0) td.splice(i, 1); });
OTT.todoOf = (id, sid, tid) => { const s = ((S.ed.nodes[id] || {}).timeline || []).find(x => x.id === sid); return s && (s.todos || []).find(t => t.id === tid); };
/** Where "- …" lines typed without a date line go: the next open step (else the last one). */
OTT.attachStep = (id) => {
  const list = M.sortSteps((S.ed.nodes[id] || {}).timeline || []);
  return list.find(s => !s.done && s.date >= M.todayStr()) || list.find(s => !s.done) || list[list.length - 1] || null;
};
C.removeStep = (id, sid) => tlSet(id, 'Remove step', (list) => { const i = list.findIndex(x => x.id === sid); if (i >= 0) list.splice(i, 1); });
C.toggleTlPin = (id) => {
  const n = S.ed.nodes[id];
  if (!n || !n.timeline || !n.timeline.length) return;
  tx(n.tlPin ? 'Hide timeline on map' : 'Show timeline on map', (c) => { const x = c.touch(id); if (x.tlPin) delete x.tlPin; else x.tlPin = true; });
};
/** Copy another node's steps; dates keep their distance to the deadline when both have one. */
C.copyTimeline = (from, to) => {
  const a = S.ed.nodes[from], b = S.ed.nodes[to];
  if (!a || !b || !a.timeline || !a.timeline.length) return;
  const da = OTT.d(from).deadline, db = OTT.d(to).deadline;
  const shift = da && db ? M.daysUntil(db, da) : 0;
  C.addSteps(to, a.timeline.map(s => ({ title: s.title, date: shift ? M.addDays(s.date, shift) : s.date, todos: (s.todos || []).map(t => t.text) })));
  OTT.toast('Copied ' + a.timeline.length + ' step' + (a.timeline.length > 1 ? 's' : '') + (shift ? ', moved ' + Math.abs(shift) + ' days ' + (shift > 0 ? 'later' : 'earlier') + ' to fit this deadline' : ''));
};
/** Lines of a timeline including the deadline and a 'today' marker, for the map, pop-up and inspector. */
OTT.tlLines = (id) => {
  const n = S.ed.nodes[id], d = OTT.d(id), today = M.todayStr();
  const lines = [];
  for (const s of M.sortSteps(n.timeline || [])) {
    const days = M.daysUntil(s.date, today), late = !s.done && days < 0;
    lines.push({ t: 'step', s, days, late });
    for (const td of s.todos || []) lines.push({ t: 'todo', s, td, days, late: late && !td.done });
  }
  if (n.deadline) {
    let i = lines.findIndex(l => l.t === 'step' && l.s.date > n.deadline);
    if (i < 0) i = lines.length;
    lines.splice(i, 0, { t: 'dl', date: n.deadline, days: d.days, late: d.overdue });
  }
  let k = lines.findIndex(l => l.t !== 'todo' && (l.t === 'step' ? l.s.date : l.date) >= today);
  if (k < 0) k = lines.length;
  lines.splice(k, 0, { t: 'today', date: today });
  return lines;
};
OTT.stepDays = (days) => days < 0 ? (-days) + 'd late' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + 'd';

C.toggleCollapse = (id, v) => {
  const n = S.ed.nodes[id];
  if (!n || !n.children.length || id === S.focus) return;
  OTT.setQuiet(id, 'collapsed', v == null ? !n.collapsed : v);
};

C.canRemove = (id) => { const n = S.ed.nodes[id]; return n && n.kind !== 'root' && n.kind !== 'category'; };

C.remove = (id, label) => {
  id = id || S.sel;
  if (!C.canRemove(id)) return OTT.toast('Categories cannot be deleted here (see Settings).');
  const n = S.ed.nodes[id];
  const pid = n.parent;
  const par = S.ed.nodes[pid];
  const idx = par.children.indexOf(id);
  const ids = M.subtreeIds(S.ed, id);
  const next = par.children[idx + 1] || par.children[idx - 1] || pid;
  tx(label || 'Delete', (c) => {
    c.touchTrash();
    const nodes = {};
    for (const x of ids) nodes[x] = clone(S.ed.nodes[x]);
    S.ed.trash.unshift({ id: M.uid(), time: M.nowIso(), root: id, parent: pid, index: idx, title: n.title, nodes, why: label || 'Delete' });
    if (S.ed.trash.length > 500) S.ed.trash.length = 500;
    c.touch(pid).children.splice(idx, 1);
    for (const x of ids) c.remove(x);
  });
  S.sel = next;
  if (!S.ed.nodes[S.focus]) S.focus = 'root';
  OTT.render();
  if (!label) OTT.toast(ids.length > 1 ? 'Deleted ' + ids.length + ' items (Ctrl+Z, or restore from Trash)' : 'Deleted (Ctrl+Z to undo)');
};
/** Delete several items as one undo step (each branch gets its own Trash entry). */
C.removeMany = (list, label) => {
  const roots = OTT.topIds(list).filter(C.canRemove);
  if (!roots.length) return OTT.toast('Categories cannot be deleted here (see Settings).');
  S.multi = [];
  if (roots.length === 1) return C.remove(roots[0], label);
  const first = S.ed.nodes[roots[0]];
  let total = 0;
  tx(label || 'Delete ' + roots.length + ' items', (c) => {
    c.touchTrash();
    for (const id of roots) {
      const n = S.ed.nodes[id], pid = n.parent, idx = S.ed.nodes[pid].children.indexOf(id);
      const ids = M.subtreeIds(S.ed, id);
      total += ids.length;
      const nodes = {};
      for (const x of ids) nodes[x] = clone(S.ed.nodes[x]);
      S.ed.trash.unshift({ id: M.uid(), time: M.nowIso(), root: id, parent: pid, index: idx, title: n.title, nodes, why: label || 'Delete' });
      c.touch(pid).children.splice(idx, 1);
      for (const x of ids) c.remove(x);
    }
    if (S.ed.trash.length > 500) S.ed.trash.length = 500;
  });
  S.sel = S.ed.nodes[first.parent] ? first.parent : 'root';
  if (!S.ed.nodes[S.focus]) S.focus = 'root';
  OTT.render();
  if (!label) OTT.toast('Deleted ' + roots.length + ' items' + (total > roots.length ? ' (' + total + ' with subtasks)' : '') + ' — Ctrl+Z, or restore from Trash');
};

/** Delete a category from this edition: each branch under it goes to Trash, then the category node goes. */
C.removeCategory = (catId, name) => {
  const cat = S.ed.nodes[catId];
  if (!cat || catId === M.PEOPLE_CAT) return;
  const n = M.subtreeIds(S.ed, catId).length - 1;
  tx('Delete category ' + (name || cat.title), (c) => {
    c.touchTrash();
    cat.children.forEach((kid, idx) => {
      const ids = M.subtreeIds(S.ed, kid);
      const nodes = {};
      for (const x of ids) nodes[x] = clone(S.ed.nodes[x]);
      S.ed.trash.unshift({ id: M.uid(), time: M.nowIso(), root: kid, parent: catId, index: idx, title: S.ed.nodes[kid].title, nodes, why: 'Category “' + (name || cat.title) + '” deleted' });
      for (const x of ids) c.remove(x);
    });
    const root = c.touch('root');
    root.children = root.children.filter(x => x !== catId);
    c.remove(catId);
  });
  if (S.focus === catId || !S.ed.nodes[S.focus]) S.focus = 'root';
  if (!S.ed.nodes[S.sel]) S.sel = 'root';
  if (n) OTT.toast('“' + (name || cat.title) + '” deleted — its ' + n + ' item' + (n > 1 ? 's are' : ' is') + ' in Trash', 'info', 4500);
};

C.restoreTrash = (entryId) => {
  const i = S.ed.trash.findIndex(t => t.id === entryId);
  if (i < 0) return;
  const t = S.ed.trash[i];
  const pid = S.ed.nodes[t.parent] ? t.parent : (S.ed.nodes['cat-' + (t.nodes[t.root].cat || '')] ? 'cat-' + t.nodes[t.root].cat : 'root');
  const target = pid === 'root' ? S.ed.nodes.root.children[0] : pid;
  tx('Restore from trash', (c) => {
    c.touchTrash();
    const map = {};
    for (const id of Object.keys(t.nodes)) map[id] = S.ed.nodes[id] ? M.uid() : id;
    for (const [id, nn] of Object.entries(t.nodes)) {
      const n = clone(nn); n.id = map[id];
      n.children = n.children.map(x => map[x]).filter(Boolean);
      if (id === t.root) n.parent = target; else n.parent = map[n.parent];
      c.add(n);
    }
    const par = c.touch(target);
    par.children.splice(Math.min(t.index, par.children.length), 0, map[t.root]);
    S.ed.trash.splice(i, 1);
    S.sel = map[t.root];
  });
  C.reveal(S.sel);
  if (target !== t.parent) OTT.toast('Its original place no longer exists — restored under “' + OTT.title(S.ed.nodes[target]) + '”. Drag it where it belongs.', 'info', 5000);
  OTT.render();
};

/** Move id under newParent at index (or end). */
C.move = (id, newParent, index, label) => {
  const n = S.ed.nodes[id];
  if (!n || !C.canRemove(id)) return false;
  if (M.isAncestor(S.ed, id, newParent)) { OTT.toast('Cannot move a task into itself.'); return false; }
  if (newParent === 'root') { OTT.toast('Only categories live at the top level.'); return false; }
  if (S.ed.nodes[newParent] && S.ed.nodes[newParent].kind === 'info') { OTT.toast('An information note cannot hold other items.'); return false; }
  const oldP = n.parent;
  tx(label || 'Move', (c) => {
    const op = c.touch(oldP);
    const oi = op.children.indexOf(id);
    op.children.splice(oi, 1);
    const np = c.touch(newParent);
    let i = index == null ? np.children.length : index;
    if (oldP === newParent && oi < i) i--;
    np.children.splice(Math.max(0, Math.min(i, np.children.length)), 0, id);
    np.collapsed = false;
    c.touch(id).parent = newParent;
  });
  return true;
};

// ---------- multiple selection ----------
// S.sel stays the "current" item (inspector, keys); S.multi holds the whole selection when it has 2+ items.
OTT.isMulti = (id) => S.multi.length > 1 && S.multi.includes(id);
const plural = (k, w) => k + ' ' + w + (k === 1 ? '' : 's');
/** Selected items without the ones already inside another selected item, in tree order. */
OTT.topIds = (ids) => {
  const set = new Set(ids.filter(id => S.ed.nodes[id]));
  const order = new Map(M.subtreeIds(S.ed, 'root').map((id, i) => [id, i]));
  return [...set].filter(id => { let p = S.ed.nodes[id].parent; while (p) { if (set.has(p)) return false; p = S.ed.nodes[p] && S.ed.nodes[p].parent; } return true; })
    .sort((a, b) => order.get(a) - order.get(b));
};
/** The items a command works on: the multiple selection, or just the current item. */
OTT.selIds = () => S.multi.length > 1 ? OTT.topIds(S.multi) : (S.sel ? [S.sel] : []);
C.clearMulti = () => { if (!S.multi.length) return false; S.multi = []; OTT.render(); return true; };
/** Shift/Ctrl+click: add the item to the selection, or take it out again. */
C.toggleMulti = (id) => {
  if (!S.ed.nodes[id]) return;
  if (!C.canRemove(id)) return OTT.toast('Categories cannot be part of a multiple selection.');
  if (S.multi.length < 2) S.multi = S.sel && S.sel !== id && C.canRemove(S.sel) ? [S.sel] : [];
  const i = S.multi.indexOf(id);
  if (i >= 0) { S.multi.splice(i, 1); if (S.sel === id) S.sel = S.multi[S.multi.length - 1]; }
  else { S.multi.push(id); S.sel = id; }
  if (S.multi.length < 2) { S.sel = S.multi[0] || id; S.multi = []; }
  S.multiAnchor = id;
  if (S.multi.length === 2 && !S.ui.multiHint) { S.ui.multiHint = true; saveUiSoon(); OTT.toast('Ctrl+C / Ctrl+X, then select the target and Ctrl+V — or drag them (hold Ctrl to copy). Esc clears.', 'info', 6000); }
  OTT.render();
};
/** Shift+click in a list: everything between the last clicked item and this one (order = visible rows). */
C.selectRange = (order, id) => {
  const a = order.indexOf(S.multiAnchor && S.ed.nodes[S.multiAnchor] ? S.multiAnchor : S.sel), b = order.indexOf(id);
  if (a < 0 || b < 0) return C.toggleMulti(id);
  const ids = order.slice(Math.min(a, b), Math.max(a, b) + 1).filter(C.canRemove);
  if (ids.length < 2) { C.select(id, { scroll: false }); return; }
  S.multi = ids; S.sel = id;
  OTT.render();
};
/** Move several items under newParent (at index, or at the end) as one undo step. */
C.moveMany = (ids, newParent, index, label) => {
  const tp = S.ed.nodes[newParent];
  if (!tp) return false;
  if (newParent === 'root') { OTT.toast('Only categories live at the top level.'); return false; }
  if (tp.kind === 'info') { OTT.toast('An information note cannot hold other items.'); return false; }
  ids = OTT.topIds(ids).filter(C.canRemove);
  const bad = ids.filter(id => M.isAncestor(S.ed, id, newParent));
  if (bad.length) { OTT.toast('Cannot move items into one of themselves.'); return false; }
  if (!ids.length) return false;
  if (ids.length === 1 && !label) return C.move(ids[0], newParent, index);
  tx(label || 'Move ' + plural(ids.length, 'item'), (c) => {
    let i = index == null ? null : index;
    for (const id of ids) {
      const n = S.ed.nodes[id], op = c.touch(n.parent), oi = op.children.indexOf(id);
      if (i != null && n.parent === newParent && oi < i) i--;
      op.children.splice(oi, 1);
      const np = c.touch(newParent);
      const at = i == null ? np.children.length : Math.max(0, Math.min(i, np.children.length));
      np.children.splice(at, 0, id);
      if (i != null) i = at + 1;
      np.collapsed = false;
      c.touch(id).parent = newParent;
    }
  });
  C.reveal(newParent);
  OTT.toast('Moved ' + plural(ids.length, 'item') + ' to “' + OTT.title(tp) + '” (Ctrl+Z to undo)');
  return true;
};
/** Copy several items (with everything below them) under target. */
C.copyTo = (ids, target, index) => {
  ids = OTT.topIds(ids).filter(C.canRemove);
  if (!ids.length) return false;
  const clip = subtreeClip(ids);
  const made = pasteClip(clip, target, index, 'Copy ' + plural(ids.length, 'item'));
  if (!made) return false;
  OTT.toast('Copied ' + plural(ids.length, 'item') + (Object.keys(clip.nodes).length > ids.length ? ' (with ' + plural(Object.keys(clip.nodes).length - ids.length, 'subtask') + ')' : '') + ' to “' + OTT.title(S.ed.nodes[target]) + '”');
  return made;
};
/** Right-click › Move to… / Copy to…: the next click picks the target. */
C.startPick = (copy) => {
  const ids = OTT.selIds().filter(C.canRemove);
  if (!ids.length) return;
  S.pickTo = { ids, copy: !!copy };
  document.body.classList.add('linking');
  OTT.toast('Click where the ' + plural(ids.length, 'item') + ' should go (Esc cancels)', 'info', 5000);
  OTT.render();
};
/** End of a drag in the map or outline: d = {id, ids?, target: {id, zone}}; copy = Ctrl held at the drop. */
OTT.dropItems = (d, copy) => {
  const t = d.target, tn = S.ed.nodes[t.id];
  if (!tn) return;
  const ids = d.ids || [d.id];
  let parent = t.id, index = null;
  if (t.zone !== 'child') { parent = tn.parent; const i = S.ed.nodes[parent].children.indexOf(t.id); index = t.zone === 'before' ? i : i + 1; }
  if (copy) return C.copyTo(ids, parent, index);
  if (ids.length > 1) { if (C.moveMany(ids, parent, index)) { S.multi = ids.slice(); S.sel = d.id; OTT.render(); } return; }
  C.move(d.id, parent, index);
  C.select(d.id, { scroll: false });
};
/** Set crit/urg on all selected items at once (outline dots). */
C.setFieldMany = (ids, field, value, label) => {
  ids = ids.filter(id => S.ed.nodes[id]);
  if (!ids.length) return;
  tx(label, (c) => { for (const id of ids) c.touch(id)[field] = value; });
};

C.reorder = (id, delta) => {
  const n = S.ed.nodes[id];
  if (!n || !C.canRemove(id)) return;
  const par = S.ed.nodes[n.parent];
  const i = par.children.indexOf(id);
  const j = i + delta;
  if (j < 0 || j >= par.children.length) return;
  tx('Reorder', (c) => { const p = c.touch(n.parent); p.children.splice(i, 1); p.children.splice(j, 0, id); }, { merge: 'reorder' + id });
};

C.indent = (id) => { // become child of previous sibling
  const n = S.ed.nodes[id]; if (!n || !C.canRemove(id)) return;
  const par = S.ed.nodes[n.parent]; const i = par.children.indexOf(id);
  if (i <= 0) return;
  C.move(id, par.children[i - 1], null, 'Indent');
};
C.outdent = (id) => {
  const n = S.ed.nodes[id]; if (!n || !C.canRemove(id)) return;
  const par = S.ed.nodes[n.parent];
  if (!par || par.kind === 'category' || par.kind === 'root') return;
  const gp = S.ed.nodes[par.parent];
  C.move(id, gp.id, gp.children.indexOf(par.id) + 1, 'Outdent');
};

C.focusOn = (id) => {
  const n = S.ed.nodes[id || S.sel];
  if (!n) return;
  if (n.children.length === 0 && n.parent) n.collapsed = false;
  S.focus = n.id; if (n.collapsed) OTT.setQuiet(n.id, 'collapsed', false);
  OTT.render(); OTT.views.map.fitSoon();
};
C.unfocus = () => { if (S.focus === 'root') return false; const f = S.focus; S.focus = 'root'; S.sel = f; OTT.render(); OTT.views.map.fitSoon(); return true; };

// ---------- overview helpers for large trees ----------
/** Change many collapse flags at once (saved, not undoable — like folding in an outliner). */
function bulkCollapse(fn, fit) {
  let n = 0;
  const set = (id, v) => { const x = S.ed.nodes[id]; if (x && x.children.length && !!x.collapsed !== v) { x.collapsed = v; n++; } };
  fn(set);
  if (n) { S.dirtyEd = true; S.der = null; scheduleSave(); }
  OTT.render();
  if (fit !== false) OTT.views.map.fitSoon();
  return n;
}
/** Double-click: if anything below is folded, unfold the whole branch; otherwise fold it. */
C.toggleAll = (id) => {
  const n = S.ed.nodes[id];
  if (!n || !n.children.length) return false;
  const ids = M.subtreeIds(S.ed, id);
  const anyFolded = ids.some(x => S.ed.nodes[x].children.length && S.ed.nodes[x].collapsed);
  if (anyFolded) bulkCollapse((set) => { for (const x of ids) set(x, false); }, false);
  else if (id === S.focus) bulkCollapse((set) => { for (const c of n.children) set(c, true); }, false);   // the centre cannot fold itself: fold its children
  else bulkCollapse((set) => set(id, true), false);
  return true;
};
/** Keep the path to id open, fold everything else (at every level along the path). */
C.collapseOthers = (id) => {
  id = id || S.sel;
  const path = [];
  for (let n = S.ed.nodes[id]; n; n = S.ed.nodes[n.parent]) path.unshift(n.id);
  bulkCollapse((set) => {
    for (const p of path) {
      set(p, false);
      for (const c of S.ed.nodes[p].children) if (!path.includes(c)) set(c, true);
    }
  });
  if (S.focus !== 'root' && !path.includes(S.focus)) S.focus = 'root';
  OTT.toast('Showing only “' + OTT.title(S.ed.nodes[id]) + '” (Alt+4 shows everything)');
};
/** Show `levels` levels below the current root (focus); Infinity = everything. */
C.showLevels = (levels) => {
  const root = S.focus;
  bulkCollapse((set) => {
    const walk = (id, d) => { for (const c of S.ed.nodes[id].children) { set(c, d + 1 >= levels); walk(c, d + 1); } };
    set(root, false);
    walk(root, 0);
  });
};
C.expandBelow = (id, v) => { id = id || S.sel; bulkCollapse((set) => { for (const x of M.subtreeIds(S.ed, id)) set(x, x === id ? false : !!v); if (v) set(id, false); }); };
C.spotlight = (id) => {
  id = id === undefined ? S.sel : id;
  if (!id || id === 'root' || S.spot === id) { S.spot = null; }
  else { S.spot = id; const n = S.ed.nodes[id]; if (n.collapsed) n.collapsed = false; if (S.focus !== 'root' && !M.isAncestor(S.ed, S.focus, id)) S.focus = 'root'; if (S.view !== 'map' && S.view !== 'tree') OTT.setView('map'); }
  OTT.render(); OTT.views.map.fitSoon();
};
C.openLens = (id) => {
  id = id || S.sel;
  if (!id || !S.ed.nodes[id]) return;
  if (S.lens === id) { S.lens = null; } else S.lens = id === 'root' ? null : id;
  document.body.classList.toggle('lens-open', !!S.lens);
  OTT.render();
  setTimeout(() => { OTT.views.map.fitSoon(); if (S.lens) $('#lens').focus({ preventScroll: true }); }, 30);
};
/** The view that keyboard navigation and in-place editing should talk to. */
OTT.activeView = () => (S.lens && document.activeElement && document.activeElement.closest && document.activeElement.closest('#lens') && OTT.views.lens) ? OTT.views.lens : OTT.views[S.view];

C.addRelation = (a, b) => {
  if (a === b) return;
  const na = S.ed.nodes[a], nb = S.ed.nodes[b];
  if (!na || !nb) return;
  if (na.relates.includes(b) || nb.relates.includes(a)) return OTT.toast('Already linked');
  tx('Link', (c) => { c.touch(a).relates.push(b); });
  OTT.toast('Linked “' + OTT.title(na) + '” ↔ “' + OTT.title(nb) + '”');
};
C.removeRelation = (a, b) => {
  tx('Unlink', (c) => {
    if (S.ed.nodes[a] && S.ed.nodes[a].relates.includes(b)) { const n = c.touch(a); n.relates = n.relates.filter(x => x !== b); }
    if (S.ed.nodes[b] && S.ed.nodes[b].relates.includes(a)) { const n = c.touch(b); n.relates = n.relates.filter(x => x !== a); }
  });
};
C.startLink = (id) => {
  S.linkFrom = id || S.sel;
  document.body.classList.add('linking');
  OTT.toast('Click the task to link with (Esc cancels)', 'info', 4000);
};
let relCache = null, relFor = null;
/** Fast "has any related link" test, rebuilt once per data change. */
OTT.hasRel = (id) => {
  if (!S.der) S.der = M.derive(S.ed, S.settings);
  if (relFor !== S.der) {
    relCache = new Set();
    for (const n of Object.values(S.ed.nodes)) for (const r of n.relates || []) if (S.ed.nodes[r]) { relCache.add(n.id); relCache.add(r); }
    relFor = S.der;
  }
  return relCache.has(id);
};
OTT.relationsOf = (id) => {
  const out = new Set(S.ed.nodes[id] ? S.ed.nodes[id].relates.filter(x => S.ed.nodes[x]) : []);
  for (const n of Object.values(S.ed.nodes)) if (n.relates && n.relates.includes(id)) out.add(n.id);
  return [...out];
};

// ---------- attachments ----------
OTT.attachPaths = async (id, paths, copy) => {
  const n = S.ed.nodes[id];
  if (!n || !paths.length) return;
  const d = OTT.d(id);
  const recs = await ott.attach(paths, !!copy, { id, title: n.title, category: OTT.catOf(d.cat).name });
  if (recs.error) return OTT.toast(recs.error, 'error');
  const ok = recs.filter(r => !r.error);
  for (const r of recs.filter(r => r.error)) OTT.toast(r.error, 'error');
  if (!ok.length) return;
  tx('Attach', (c) => { const nn = c.touch(id); nn.attachments = nn.attachments.concat(ok); });
  const copied = ok.filter(r => r.copied).length;
  OTT.toast(ok.length + ' attached' + (copied ? ' (' + copied + ' copied into the tree folder)' : ' (linked in place)'));
};
OTT.attachUrl = (id, url, label) => {
  url = url.trim();
  if (!/^(https?:|mailto:)/i.test(url)) url = 'https://' + url;
  tx('Attach link', (c) => { const nn = c.touch(id); nn.attachments = nn.attachments.concat([{ id: M.uid(), kind: 'url', url, name: label || url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60), added: M.nowIso() }]); });
};
/** Handle a drop of files / urls on node id. */
OTT.handleDrop = async (id, e) => {
  const dt = e.dataTransfer;
  const files = Array.from(dt.files || []);
  if (files.length) {
    const paths = files.map(f => ott.pathForFile(f)).filter(Boolean);
    if (paths.length) return OTT.attachPaths(id, paths, e.ctrlKey);
    return OTT.toast('Could not read the dropped files (try saving them to disk first).', 'warn');
  }
  const uri = dt.getData('text/uri-list') || dt.getData('text/plain');
  if (uri && /^(https?:|mailto:)/i.test(uri.trim())) return OTT.attachUrl(id, uri.split('\n')[0]);
};

// ---------- hover pop-up: open attachments / read notes without leaving the map ----------
OTT.pop = (() => {
  let el = null, hideT = null, cur = null;
  const ensure = () => {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'attpop';
    el.hidden = true;
    document.body.appendChild(el);
    el.addEventListener('pointerenter', () => clearTimeout(hideT));
    el.addEventListener('pointerleave', () => { if (!cur || !cur.pinned) hideSoon(); });
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b || !cur) return;
      const n = S.ed.nodes[cur.id]; if (!n) return;
      const a = n.attachments.find(x => x.id === b.dataset.id);
      if (b.dataset.act === 'open' && a) { const r = await ott.openAttachment(a); if (r && r.error) OTT.toast(r.error, 'error'); else hide(); }
      if (b.dataset.act === 'reveal' && a) { ott.revealAttachment(a); hide(); }
      if (b.dataset.act === 'add') { hide(); const p = await ott.pickFiles(); if (p && p.length) OTT.attachPaths(cur.id, p, false); }
      if (b.dataset.act === 'edit') { hide(); C.select(cur.id); const t = $('#inspector textarea[data-f="notes"]'); if (t) { t.focus(); t.scrollIntoView({ block: 'center' }); } }
      if (b.dataset.act === 'tlk' || b.dataset.act === 'tdk' || b.dataset.act === 'tlpin') {
        const k = cur;
        if (b.dataset.act === 'tlk') C.toggleStep(k.id, b.dataset.sid);
        else if (b.dataset.act === 'tdk') C.toggleTodo(k.id, b.dataset.sid, b.dataset.tid);
        else C.toggleTlPin(k.id);
        OTT.renderNow();
        el.hidden = true; cur = null; show(k.id, k.rect, 'tl', k.pinned);
      }
      if (b.dataset.act === 'tledit') { const id = cur.id; hide(); C.select(id); OTT.renderNow(); const t = $('#inspector [data-f="tladd"]'); if (t) { t.scrollIntoView({ block: 'center' }); t.focus(); } }
    });
    return el;
  };
  const hide = () => { clearTimeout(hideT); if (el) el.hidden = true; cur = null; };
  const hideSoon = () => { clearTimeout(hideT); hideT = setTimeout(hide, 350); };
  function show(id, rect, kind, pinned) {
    const n = S.ed.nodes[id];
    if (!n) return;
    if (cur && cur.id === id && cur.kind === kind && !el.hidden) { clearTimeout(hideT); if (pinned) cur.pinned = true; return; }
    ensure();
    clearTimeout(hideT);
    cur = { id, kind, pinned: !!pinned, rect: { left: rect.left, top: rect.top, bottom: rect.bottom } };
    let h = `<div class="ph">${n.kind === 'info' && kind === 'notes' ? '<span class="kinfo">i</span>' : ICON(kind === 'notes' ? 'note' : kind === 'tl' ? 'steps' : 'clip')}<span>${E(OTT.title(n))}</span></div>`;
    if (kind === 'tl') {
      h += `<div class="ptl">${OTT.tlLines(id).map(l => {
        if (l.t === 'today') return `<div class="tlrow today"><span class="tlmk"></span><span class="tld">${E(OTT.fmtDate(l.date))}</span><span class="tlt">today</span></div>`;
        if (l.t === 'dl') return `<div class="tlrow dl ${l.late ? 'late' : ''}"><span class="tlmk">${ICON('flag')}</span><span class="tld">${E(OTT.fmtDate(l.date))}</span><span class="tlt">Deadline</span><span class="tlday">${OTT.dueLabel(OTT.d(id))}</span></div>`;
        if (l.t === 'todo') return `<div class="tlrow todo ${l.td.done ? 'done' : ''} ${l.late ? 'late' : ''}"><span class="tlmk"></span><span class="tld"></span><button class="tdmk chk" data-act="tdk" data-sid="${l.s.id}" data-tid="${l.td.id}" title="${l.td.done ? 'Mark as not done' : 'Mark as done'}">${l.td.done ? ICON('check') : ''}</button><span class="tlt">${E(l.td.text)}</span></div>`;
        return `<div class="tlrow ${l.s.done ? 'done' : ''} ${l.late ? 'late' : ''}"><button class="tlmk chk" data-act="tlk" data-sid="${l.s.id}" title="${l.s.done ? 'Mark as not done' : 'Mark as done'}">${l.s.done ? ICON('check') : ''}</button><span class="tld">${E(OTT.fmtDate(l.s.date))}</span><span class="tlt">${l.s.title ? E(l.s.title) : l.s.todos && l.s.todos.length ? '<i>' + l.s.todos.filter(t => t.done).length + '/' + l.s.todos.length + ' to-dos</i>' : '—'}</span><span class="tlday">${l.s.done ? '' : OTT.stepDays(l.days)}</span></div>`;
      }).join('')}</div>`;
      h += `<div class="pf"><button data-act="tlpin" class="${n.tlPin ? 'on' : ''}">${ICON('pin')} ${n.tlPin ? 'Unpin from map' : 'Pin on map'}</button><button data-act="tledit">Edit timeline…</button></div>`;
    } else if (kind === 'notes') {
      h += `<div class="pnotes">${n.notes && n.notes.trim() ? OTT.linkify(n.notes) : '<span class="hint">No text yet.</span>'}</div>`;
      if (n.kind === 'info' && n.attachments.length) h += n.attachments.map(a => `<div class="pa" data-aid="${a.id}"><span class="aic">${ICON(a.kind === 'url' ? 'ext' : a.kind === 'folder' ? 'folder' : 'clip')}</span><span class="pn2" title="${E(a.url || a.dbx || a.copied || a.abs || '')}">${E(a.name)}</span><button class="popen" data-act="open" data-id="${a.id}">Open</button></div>`).join('');
      h += `<div class="pf"><button data-act="edit">${n.kind === 'info' ? 'Edit note' : 'Edit notes'}</button></div>`;
    } else {
      h += n.attachments.map(a => `<div class="pa" data-aid="${a.id}"><span class="aic">${ICON(a.kind === 'url' ? 'ext' : a.kind === 'folder' ? 'folder' : 'clip')}</span><span class="pn2" title="${E(a.url || a.dbx || a.copied || a.abs || '')}">${E(a.name)}</span><span class="atag">${a.kind === 'url' ? 'link' : a.copied ? 'copied' : 'file'}</span><button class="popen" data-act="open" data-id="${a.id}">Open</button>${a.kind !== 'url' ? `<button class="mini" data-act="reveal" data-id="${a.id}" title="Show in Explorer">${ICON('folder')}</button>` : ''}</div>`).join('');
      h += `<div class="pf"><button data-act="add">${ICON('plus')} Add files…</button></div>`;
    }
    el.innerHTML = h;
    el.hidden = false;
    const r = el.getBoundingClientRect();
    let x = rect.left, y = rect.bottom + 6;
    if (x + r.width > innerWidth - 8) x = innerWidth - r.width - 8;
    if (y + r.height > innerHeight - 8) y = rect.top - r.height - 6;
    el.style.left = Math.max(8, x) + 'px'; el.style.top = Math.max(8, y) + 'px';
    if (kind === 'att') {
      const files = n.attachments.filter(a => a.kind !== 'url');
      if (files.length) ott.attachStatus(files).then(st => {
        if (!Array.isArray(st) || !cur || cur.id !== id) return;
        for (const s of st) if (!s.exists) { const row = el.querySelector(`.pa[data-aid="${s.id}"]`); if (row) { row.classList.add('missing'); row.querySelector('.atag').textContent = 'missing'; } }
      });
    }
  }
  /** Ctrl+O: one attachment opens directly, several show the list. */
  async function openSelected() {
    const n = S.ed.nodes[S.sel];
    if (!n || !n.attachments.length) return OTT.toast('No attachments on this task (drop a file on it, or use Files… in the panel).');
    if (n.attachments.length === 1) { const r = await ott.openAttachment(n.attachments[0]); if (r && r.error) OTT.toast(r.error, 'error'); return; }
    const g = document.querySelector(`.node[data-id="${CSS.escape(n.id)}"], .orow[data-id="${CSS.escape(n.id)}"]`);
    show(n.id, g ? g.getBoundingClientRect() : { left: innerWidth / 2 - 150, top: innerHeight / 2, bottom: innerHeight / 2 }, 'att', true);
  }
  document.addEventListener('pointerdown', (e) => { if (cur && !e.target.closest('#attpop')) hide(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cur) { hide(); e.stopImmediatePropagation(); } }, true);
  /** Wire hover/click on badge elements inside a container. */
  const BADGES = '[data-attbadge],[data-notebadge],[data-tlbadge]';
  const kindOf = (b) => b.dataset.notebadge ? 'notes' : b.dataset.tlbadge ? 'tl' : 'att';
  function wire(container) {
    container.addEventListener('pointerover', (e) => {
      const b = e.target.closest && e.target.closest(BADGES);
      if (!b || document.body.classList.contains('busy-drag')) return;
      const host = b.closest('[data-id]');
      if (host) show(host.dataset.id, b.getBoundingClientRect(), kindOf(b), false);
    });
    container.addEventListener('pointerout', (e) => {
      const b = e.target.closest && e.target.closest(BADGES);
      if (b && !(e.relatedTarget && b.contains(e.relatedTarget)) && cur && !cur.pinned) hideSoon();
    });
    // click on a badge pins the pop-up (and does not start a drag); on the map the timeline badge
    // instead pins the timeline open on the node itself
    container.addEventListener('pointerdown', (e) => {
      const b = e.target.closest && e.target.closest(BADGES);
      if (!b) return;
      e.stopPropagation(); e.preventDefault();
      const host = b.closest('[data-id]');
      if (!host) return;
      C.select(host.dataset.id, { scroll: false });
      hide();
      if (b.dataset.tlbadge && container.id === 'mapwrap') { C.toggleTlPin(host.dataset.id); return; }
      show(host.dataset.id, b.getBoundingClientRect(), kindOf(b), true);
    }, true);
  }
  return { show, hide, openSelected, wire };
})();

// ---------- clipboard ----------
function subtreeClip(ids) {
  const nodes = {};
  const roots = [];
  for (const id of ids) { for (const x of M.subtreeIds(S.ed, id)) nodes[x] = clone(S.ed.nodes[x]); roots.push(id); }
  const lines = [];
  const walk = (id, depth) => { const n = nodes[id]; lines.push('\t'.repeat(depth) + (n.title || '')); for (const c of n.children) walk(c, depth + 1); };
  for (const r of roots) walk(r, 0);
  return { nodes, roots, text: lines.join('\r\n'), edId: S.ed.id };
}
C.copy = async (cut) => {
  if (S.multi.length > 1) {
    const ids = OTT.topIds(S.multi).filter(C.canRemove);
    if (!ids.length) return;
    S.clip = subtreeClip(ids);
    S.clip.cut = !!cut;
    ott.clipWrite(S.clip.text);
    const extra = Object.keys(S.clip.nodes).length - ids.length;
    const what = plural(ids.length, 'item') + (extra ? ' (with ' + plural(extra, 'subtask') + ')' : '');
    if (cut) { C.removeMany(ids, 'Cut ' + ids.length + ' items'); OTT.toast('Cut ' + what + ' — select where they go and press Ctrl+V (also kept in Trash)', 'info', 4500); }
    else OTT.toast('Copied ' + what + ' — select where they go and press Ctrl+V', 'info', 4000);
    return;
  }
  const id = S.sel;
  const n = S.ed.nodes[id];
  if (!n || n.kind === 'root') return;
  const ids = n.kind === 'category' ? n.children.slice() : [id];
  if (!ids.length) return;
  S.clip = subtreeClip(ids);
  S.clip.cut = !!cut;
  ott.clipWrite(S.clip.text);
  if (cut) {
    if (n.kind === 'category') return OTT.toast('Copied (categories themselves cannot be cut)');
    C.remove(id, 'Cut');
    OTT.toast('Cut — paste with Ctrl+V (also kept in Trash)');
  } else OTT.toast('Copied ' + Object.keys(S.clip.nodes).length + ' item' + (Object.keys(S.clip.nodes).length > 1 ? 's' : ''));
};
C.paste = async () => {
  const target = S.sel;
  const tn = S.ed.nodes[target];
  if (!tn) return;
  if (target === 'root') return OTT.toast('Select a category or task to paste into.');
  if (tn.kind === 'info') return OTT.toast('An information note cannot hold other items — paste into its parent.');
  let text = '';
  try { text = (await ott.clipRead()) || ''; } catch (_) {}
  let clip = S.clip;
  if (!clip || (text && text.replace(/\r/g, '') !== clip.text.replace(/\r/g, ''))) {
    if (!text.trim()) return OTT.toast('Clipboard is empty');
    clip = parseTextClip(text);
  }
  const made = pasteClip(clip, target, null, clip.roots.length > 1 ? 'Paste ' + clip.roots.length + ' items' : 'Paste');
  if (clip.cut) S.clip = Object.assign({}, clip, { cut: false });  // next paste is a copy
  if (made && made.length > 1) OTT.toast('Pasted ' + made.length + ' items into “' + OTT.title(tn) + '” (they stay selected)');
};
/** Insert a clip's items under target (at index, or at the end) as one undo step; selects them. Returns the new ids. */
function pasteClip(clip, target, index, label) {
  const tn = S.ed.nodes[target];
  if (!tn || target === 'root') { OTT.toast('Select a category or task to paste into.'); return null; }
  if (tn.kind === 'info') { OTT.toast('An information note cannot hold other items.'); return null; }
  const keepIds = clip.cut || clip.edId !== S.ed.id;
  const map = {};
  for (const id of Object.keys(clip.nodes)) map[id] = keepIds && !S.ed.nodes[id] ? id : M.uid();
  const made = [];
  tx(label || 'Paste', (c) => {
    const par = c.touch(target);
    for (const [id, nn] of Object.entries(clip.nodes)) {
      const n = clone(nn);
      n.id = map[id];
      n.children = n.children.map(x => map[x]).filter(Boolean);
      n.parent = clip.roots.includes(id) ? target : map[n.parent];
      n.relates = (n.relates || []).map(x => map[x] || x).filter(x => map[x] || S.ed.nodes[x] || Object.values(map).includes(x));
      if (n.kind === 'category' || n.kind === 'root') n.kind = null;
      c.add(n);
    }
    let i = index == null ? par.children.length : Math.max(0, Math.min(index, par.children.length));
    for (const r of clip.roots) { par.children.splice(i++, 0, map[r]); made.push(map[r]); }
    par.collapsed = false;
  });
  S.multi = made.length > 1 ? made.slice() : [];
  S.sel = made[made.length - 1] || target;
  C.reveal(S.sel);
  OTT.render();
  return made;
}
function parseTextClip(text) {
  const nodes = {}, roots = [];
  const stack = []; // [{indent, id}]
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    if (!raw.trim()) continue;
    const m = /^([\t ]*)(.*)$/.exec(raw);
    const indent = m[1].replace(/\t/g, '    ').length;
    const title = m[2].replace(/^([-*•·▪◦]|\d+(\.\d+)*[.)]?)\s+/, '').trim();
    const n = M.newNode({ title });
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (stack.length) { const p = nodes[stack[stack.length - 1].id]; p.children.push(n.id); n.parent = p.id; } else roots.push(n.id);
    nodes[n.id] = n;
    stack.push({ indent, id: n.id });
  }
  return { nodes, roots, text, edId: null };
}

// ---------- in-place title editing ----------
OTT.startEdit = (id, opts) => {
  OTT.renderNow();   // the node must be laid out before we can place the editor over it
  const view = OTT.activeView();
  const host = view && view.editRect ? view : OTT.views.map;
  const r = host.editRect ? host.editRect(id) : null;
  const n = S.ed.nodes[id];
  if (!n) return;
  if (n.kind === 'root') return;
  if (n.kind === 'category') return OTT.toast('Rename categories in Settings.');
  if (!r) { // e.g. matrix: edit in inspector
    const t = $('#insp-title'); if (t) { t.focus(); t.select(); }
    return;
  }
  const inp = document.createElement('input');
  inp.className = 'inplace';
  inp.value = opts && opts.initial != null ? opts.initial : (n.title || '');
  inp.spellcheck = true;
  Object.assign(inp.style, { left: r.x + 'px', top: r.y + 'px', width: Math.max(160, r.w) + 'px', height: r.h + 'px', fontSize: r.fs + 'px' });
  r.parent.appendChild(inp);
  inp.focus();
  if (!(opts && opts.initial != null)) inp.select();
  let done = false;
  const finish = (commit, then) => {
    if (done) return; done = true;
    const v = inp.value.trim();
    inp.remove();
    if (commit) {
      if (!v && opts && opts.isNew) C.discardNew(id);
      else if (v !== n.title) C.rename(id, v);
    } else if (opts && opts.isNew) {
      // Esc on a new item keeps what was typed (never throw typing away); empty new items vanish
      if (v) C.rename(id, v); else if (!n.title) C.discardNew(id);
    }
    OTT.render();
    OTT.focusStage();
    if (then) then();
  };
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true, e.shiftKey ? null : (opts && opts.isNew ? () => C.addSibling(id) : null)); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    else if (e.key === 'Tab') { e.preventDefault(); const v = inp.value.trim(); finish(true, () => { if (v || !(opts && opts.isNew)) C.addChild(id); }); }
  });
  inp.addEventListener('blur', () => finish(true));
};
OTT.isEditing = () => !!$('.inplace') || ['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement || {}).tagName) || (document.activeElement && document.activeElement.isContentEditable);
OTT.focusStage = () => { if (S.lens && OTT.lensHadFocus) { $('#lens').focus({ preventScroll: true }); return; } const v = S.view === 'outline' ? $('#outline') : S.view === 'matrix' ? $('#matrix') : S.view === 'calendar' ? $('#calendar') : $('#mapwrap'); if (v) v.focus({ preventScroll: true }); };

// ---------- render orchestration ----------
let raf = 0;
OTT.render = () => { if (!raf) raf = requestAnimationFrame(doRender); };
OTT.renderNow = () => { if (raf) cancelAnimationFrame(raf); raf = 0; doRender(); };
function doRender() {
  raf = 0;
  if (!S.ed) return;
  if (!S.der) S.der = M.derive(S.ed, S.settings);
  // node colour scheme: 'frame' = criticality as frame, urgency as fill (Settings)
  document.body.classList.toggle('cs-frame', (S.settings && S.settings.nodeColors) === 'frame');
  if (S.sel && !S.ed.nodes[S.sel]) S.sel = 'root';
  if (S.multi.length) { S.multi = S.multi.filter(id => S.ed.nodes[id]); if (S.multi.length < 2) S.multi = []; }
  document.body.classList.toggle('has-multi', S.multi.length > 1);
  if (!S.ed.nodes[S.focus]) S.focus = 'root';
  if (S.lens && !S.ed.nodes[S.lens]) S.lens = null;
  if (S.spot && !S.ed.nodes[S.spot]) S.spot = null;
  document.body.classList.toggle('lens-open', !!S.lens);
  if (S.lens && OTT.views.lens) { try { OTT.views.lens.render(); } catch (e) { console.error('render lens: ' + e.stack); } }
  $('#mapwrap').classList.toggle('on', S.view === 'map' || S.view === 'tree');
  $('#outline').classList.toggle('on', S.view === 'outline');
  $('#matrix').classList.toggle('on', S.view === 'matrix');
  $('#calendar').classList.toggle('on', S.view === 'calendar');
  if (S.view !== 'calendar' && OTT.views.calendar) OTT.views.calendar.hideCard();
  for (const [name, fn] of [['view', () => OTT.views[S.view] && OTT.views[S.view].render()], ['inspector', () => OTT.inspector && OTT.inspector.render()], ['topbar', OTT.renderTopbar], ['status', OTT.renderStatus]]) {
    try { fn(); } catch (e) { console.error('render ' + name + ': ' + (e.stack || e.message)); }
  }
}
OTT.setView = (v) => {
  if (S.view === v) return;
  const wasMap = S.view === 'map' || S.view === 'tree';
  S.view = v; S.ui.view = v; saveUiSoon();
  OTT.render();
  if ((v === 'map' || v === 'tree')) OTT.views.map.fitSoon(!wasMap || true);
  setTimeout(() => { OTT.focusStage(); OTT.views[S.view] && OTT.views[S.view].scrollTo && OTT.views[S.view].scrollTo(S.sel); }, 30);
};

let uiTimer = null;
function saveUiSoon() { clearTimeout(uiTimer); uiTimer = setTimeout(() => ott.saveUi(S.ui), 1500); }
OTT.saveUiSoon = saveUiSoon;

// ---------- search ----------
OTT.runSearch = (q) => {
  S.search = q;
  S.hits = [];
  S.hitIdx = 0;
  const k = q.trim().toLowerCase();
  if (k) {
    const order = [];
    const walk = (id) => { order.push(id); for (const c of S.ed.nodes[id].children) walk(c); };
    walk('root');
    for (const id of order) {
      const n = S.ed.nodes[id];
      const p = n.owner ? OTT.person(n.owner) : null;
      const hay = (n.title + ' ' + (n.notes || '') + ' ' + (p ? p.name : '') + ' ' + n.attachments.map(a => a.name).join(' ')).toLowerCase();
      if (hay.includes(k)) S.hits.push(id);
    }
    if (S.hits.length) { C.reveal(S.hits[0]); S.sel = S.hits[0]; }
  }
  $('#searchCount').textContent = k ? (S.hits.length ? '1/' + S.hits.length : '0') : '';
  OTT.render();
  if (S.hits.length) setTimeout(() => OTT.views[S.view].scrollTo && OTT.views[S.view].scrollTo(S.sel), 40);
};
OTT.nextHit = (dir) => {
  if (!S.hits.length) return;
  S.hitIdx = (S.hitIdx + dir + S.hits.length) % S.hits.length;
  const id = S.hits[S.hitIdx];
  $('#searchCount').textContent = (S.hitIdx + 1) + '/' + S.hits.length;
  C.select(id, { reveal: true });
};

// ---------- toasts ----------
OTT.toast = (msg, kind, ms) => {
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  t.innerHTML = E(msg);
  $('#toasts').appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, ms || 2600);
};

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  if (!S.ed) return;
  const k = e.key;
  const ctrl = e.ctrlKey || e.metaKey;
  if ($('#modal') && !$('#modal').hidden) { if (k === 'Escape') OTT.dialogs.close(); return; }
  if (ctrl && k.toLowerCase() === 'f') { e.preventDefault(); $('#search').focus(); $('#search').select(); return; }
  if (ctrl && k.toLowerCase() === 's') { e.preventDefault(); saveNow(); OTT.toast('Saved'); return; }
  if (ctrl && k.toLowerCase() === 'q') { e.preventDefault(); saveNow().then(() => ott.quit()); return; }
  if (ctrl && ['1', '2', '3', '4', '5'].includes(k)) { e.preventDefault(); OTT.setView(['map', 'tree', 'outline', 'matrix', 'calendar'][+k - 1]); return; }
  if (OTT.isEditing()) return;
  const id = S.sel;
  if (ctrl && k.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); OTT.undo(); return; }
  if (ctrl && (k.toLowerCase() === 'y' || (k.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); OTT.redoCmd(); return; }
  if (ctrl && k.toLowerCase() === 'c') { e.preventDefault(); C.copy(false); return; }
  if (ctrl && k.toLowerCase() === 'x') { e.preventDefault(); C.copy(true); return; }
  if (ctrl && k.toLowerCase() === 'v') { e.preventDefault(); C.paste(); return; }
  if (ctrl && e.shiftKey && k === 'Enter') { e.preventDefault(); C.spotlight(id); return; }
  if (ctrl && k === 'Enter') { e.preventDefault(); C.focusOn(id); return; }
  if (ctrl && k.toLowerCase() === 'l') { e.preventDefault(); C.openLens(id); return; }
  if (ctrl && k.toLowerCase() === 'o') { e.preventDefault(); OTT.pop.openSelected(); return; }
  if (ctrl && k === ' ') { e.preventDefault(); C.collapseOthers(id); return; }
  if (e.altKey && ['1', '2', '3', '4'].includes(k)) { e.preventDefault(); C.showLevels(k === '4' ? Infinity : +k); return; }
  if (ctrl && k === 'ArrowUp') { e.preventDefault(); C.setStage(id, S.ed.nodes[id].stage + 1); return; }
  if (ctrl && k === 'ArrowDown') { e.preventDefault(); C.setStage(id, S.ed.nodes[id].stage - 1); return; }
  if (e.altKey && k === 'ArrowUp') { e.preventDefault(); C.reorder(id, -1); return; }
  if (e.altKey && k === 'ArrowDown') { e.preventDefault(); C.reorder(id, +1); return; }
  if (e.altKey && k === 'ArrowRight') { e.preventDefault(); C.indent(id); return; }
  if (e.altKey && k === 'ArrowLeft') { e.preventDefault(); C.outdent(id); return; }
  if (k === 'Escape') {
    if (S.linkFrom) { S.linkFrom = null; document.body.classList.remove('linking'); OTT.toast('Linking cancelled'); return; }
    if (S.pickTo) { S.pickTo = null; document.body.classList.remove('linking'); OTT.toast('Cancelled'); OTT.render(); return; }
    if (C.clearMulti()) return;
    if (S.search) { $('#search').value = ''; OTT.runSearch(''); return; }
    if (S.spot) { C.spotlight(null); return; }
    C.unfocus(); return;
  }
  if (k === 'Tab') { e.preventDefault(); if (e.shiftKey) C.outdent(id); else C.addChild(id); return; }
  if (k === 'Enter') { e.preventDefault(); C.addSibling(id); return; }
  if (k === 'F2') { e.preventDefault(); OTT.startEdit(id); return; }
  if (k === 'Delete') { e.preventDefault(); if (S.multi.length > 1) C.removeMany(S.multi); else C.remove(id); return; }
  if (k === ' ') { e.preventDefault(); const v = OTT.activeView(); if (v && v.toggle) v.toggle(id); else C.toggleCollapse(id); return; }
  if (k === 'F3') { e.preventDefault(); OTT.nextHit(e.shiftKey ? -1 : 1); return; }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home'].includes(k)) {
    const v = OTT.activeView();
    if (v && v.navigate) { e.preventDefault(); v.navigate(k); }
    return;
  }
  // typing a character starts renaming (replacing the title)
  if (k.length === 1 && !ctrl && !e.altKey && /\S/.test(k)) {
    const n = S.ed.nodes[id];
    if (n && n.kind !== 'root' && n.kind !== 'category' && S.view !== 'matrix') { e.preventDefault(); OTT.startEdit(id, { initial: k }); }
  }
});

// global drag & drop guard: never let a dropped file navigate the window away
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

// context menu
OTT.contextMenu = (x, y, id) => {
  const items = [];
  const add = (label, key, fn, dis) => items.push({ label, key, fn, dis });
  const sep = () => items.push(null);
  if (id && OTT.isMulti(id)) {   // right-click inside a multiple selection: commands for all of them
    S.sel = id; OTT.render();
    const k = OTT.topIds(S.multi).length;
    items.push({ label: k + ' items selected', key: '', fn: () => {}, dis: true, head: true });
    add('Move to… (then click the target)', '', () => C.startPick(false));
    add('Copy to… (then click the target)', '', () => C.startPick(true));
    sep();
    add('Cut', 'Ctrl+X', () => C.copy(true));
    add('Copy', 'Ctrl+C', () => C.copy(false));
    sep();
    add('Delete ' + k + ' items', 'Del', () => C.removeMany(S.multi));
    add('Clear selection', 'Esc', () => C.clearMulti());
    return showMenu(x, y, items);
  }
  if (id) C.select(id, { scroll: false });
  const n = S.ed.nodes[id];
  if (!n) return;
  if (n.kind === 'category') { add('Edit category…', '', () => OTT.dialogs.settings({ category: n.cat })); sep(); }
  if (n.kind !== 'root' && n.kind !== 'info') add('Add subtask', 'Tab', () => C.addChild(id));
  if (n.kind !== 'root' && n.kind !== 'category') add(n.kind === 'info' ? 'Add task below' : 'Add task below', 'Enter', () => C.addSibling(id));
  if (n.kind !== 'root' && !M.inPeople(S.ed, id)) add(n.kind === 'info' ? 'Add information note below' : 'Add information note', '', () => C.addInfo(id));
  sep();
  if (n.kind === 'category' || n.kind === 'group') add(M.inPeople(S.ed, id) ? (n.kind === 'category' ? 'Add group' : 'Add subgroup') : 'Add subcategory', '', () => C.addGroup(id));
  if (n.kind !== 'root' && n.kind !== 'category') add('Rename', 'F2', () => OTT.startEdit(id));
  if (C.canMakeInfo(id)) add('Make information note', '', () => C.toInfo(id));
  if (n.kind === 'info') add('Make task', '', () => C.infoToTask(id));
  if (C.canMakeGroup(id)) add('Make subcategory', '', () => C.toGroup(id));
  if (n.kind === 'group' && !M.inPeople(S.ed, id)) add('Make task', '', () => C.toTask(id), !C.canMakeTask(id));
  if (C.canPromote(id)) add('Make main category', '', () => C.promoteToCategory(id));
  if (C.canDemote(id)) add('Move into another category…', '', () => OTT.dialogs.demote(id));
  sep();
  add(S.spot === id ? 'End spotlight' : 'Spotlight (whole tree stays visible)', 'Ctrl+Shift+Enter', () => C.spotlight(id), n.kind === 'root');
  add(S.lens === id ? 'Close side panel' : 'Open in side panel', 'Ctrl+L', () => C.openLens(id), n.kind === 'root');
  add('Focus on this branch (drill in)', 'Ctrl+Enter', () => C.focusOn(id), !n.children.length);
  sep();
  add('Collapse all but this', 'Ctrl+Space', () => C.collapseOthers(id), n.kind === 'root');
  if (n.children.length) add(n.collapsed ? 'Expand' : 'Collapse', 'Space', () => C.toggleCollapse(id));
  if (n.children.length) add('Expand everything below', '', () => C.expandBelow(id, false));
  if (n.children.length) add('Collapse everything below', '', () => C.expandBelow(id, true));
  sep();
  add('Cut', 'Ctrl+X', () => C.copy(true), !C.canRemove(id));
  add('Copy', 'Ctrl+C', () => C.copy(false), n.kind === 'root');
  add('Paste as subtask', 'Ctrl+V', () => C.paste(), n.kind === 'root');
  sep();
  add('Link to another task…', '', () => C.startLink(id), n.kind === 'root');
  add('Attach files…', '', async () => { const p = await ott.pickFiles(); if (p.length) OTT.attachPaths(id, p, false); }, n.kind === 'root');
  sep();
  add('Delete', 'Del', () => C.remove(id), !C.canRemove(id));
  showMenu(x, y, items);
};
function showMenu(x, y, items) {
  const m = $('#ctxmenu');
  m.innerHTML = items.map((it, i) => it ? `<button data-i="${i}" ${it.dis ? 'disabled' : ''} ${it.head ? 'class="mhead"' : ''}><span>${E(it.label)}</span><kbd>${E(it.key)}</kbd></button>` : '<hr>').join('');
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  m.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; m.hidden = true; items[+b.dataset.i].fn(); };
}
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#ctxmenu')) $('#ctxmenu').hidden = true; }, true);
window.addEventListener('blur', () => { $('#ctxmenu').hidden = true; });
