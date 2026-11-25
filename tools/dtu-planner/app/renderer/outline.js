/* One Todo Tree — outline view: numbered, indented list with columns. */
(function () {
  'use strict';
  const S = OTT.S, C = OTT.cmd;
  /** An outline bound to a container; opt.root() gives the branch it shows; opt.lens marks the side panel. */
  function createOutline(box, opt) {
  let order = [];   // visible ids in display order
  // the side panel keeps its own folding (starts fully open), so the map can stay at overview level
  const fold = new Map();
  const isFolded = (id) => opt.lens ? !!fold.get(id) : !!S.ed.nodes[id].collapsed;
  const setFold = (id, v) => { if (opt.lens) { fold.set(id, v); OTT.render(); } else C.toggleCollapse(id, v); };
  let numbers = new Map();

  function fmtMoney(v) {
    if (v == null || v === '' || isNaN(v)) return '';
    v = +v;
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + 'M';
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(v % 1e3 ? 0 : 0) + 'k';
    return String(v);
  }
  OTT.fmtMoney = fmtMoney;

  function dots(kind, own, eff, ramp) {
    let s = '';
    for (let i = 1; i <= 3; i++) {
      const on = eff >= i;
      s += `<i data-${kind}="${i}" class="${on ? 'on' : ''} ${on && !own ? 'inh' : ''} ${on && ramp && i > (own || 0) ? 'ramp' : ''}"></i>`;
    }
    return s;
  }

  function miniRing(d, n, color) {
    const r = 6.5, cx = 8, cy = 8, circ = 2 * Math.PI * r;
    if (d.done) return `<svg class="mr" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" style="fill:${color}"/><path d="M4.8 8.2l2.1 2.1 4.2-4.6" class="ck"/></svg>`;
    const frac = d.progress || 0;
    return `<svg class="mr" viewBox="0 0 16 16"><circle cx="8" cy="8" r="${r}" class="bg"/>${frac > 0 ? `<circle cx="8" cy="8" r="${r}" transform="rotate(-90 8 8)" style="stroke:${color};stroke-dasharray:${(frac * circ).toFixed(1)} ${circ.toFixed(1)}" class="fg"/>` : ''}</svg>`;
  }

  function row(id, depth) {
    const n = S.ed.nodes[id], d = OTT.d(id);
    const color = OTT.catColor(d.cat);
    const kind = n.kind || 'task';
    const cls = ['orow', 'k-' + kind];
    if (id === S.sel) cls.push('sel');
    if (OTT.isMulti(id)) cls.push('msel');
    if (d.done && kind !== 'category') cls.push('done');
    if (S.search && S.hits.includes(id)) cls.push('hit');
    if (kind === 'task' && d.crit) cls.push('c' + d.crit);
    if (kind === 'task' && !d.done && d.urg >= 2) cls.push('u' + d.urg);
    if (d.overdue) cls.push('over');
    const hasKids = n.children.length > 0;
    const open = hasKids && (!isFolded(id) || id === opt.root());
    const chev = hasKids ? `<button class="chev ${open ? 'open' : ''}" data-chev="1">${ICON('chev')}</button>` : '<span class="chev none"></span>';
    const num = numbers.get(id) || '';
    let lead = '';
    if (kind === 'person') lead = `<span class="oav" style="background:${color}">${E(OTT.initials(n.title))}</span>`;
    else if (kind === 'info') lead = `<span class="kinfo" data-notebadge="1" title="Information — hover to read">i</span>`;
    else if (kind === 'category') lead = `<span class="ocat" style="background:${color}"></span>`;
    else if (kind !== 'group') lead = miniRing(d, n, color);
    const icons = [];
    if (n.attachments.length) icons.push(`<span class="obadge" data-attbadge="1" title="Attachments — hover or click">${ICON('clip')}${n.attachments.length > 1 ? n.attachments.length : ''}</span>`);
    if (n.notes && n.notes.trim()) icons.push(`<span class="obadge" data-notebadge="1">${ICON('note')}</span>`);
    if (n.timeline && n.timeline.length && d.tl) icons.push(`<span class="obadge tlb ${d.tl.late && !d.done ? 'late' : d.tl.next && d.tl.next.days <= M.FINAL_DAYS && !d.done ? 'soon' : ''}" data-tlbadge="1" title="Timeline — hover or click">${ICON('steps')}${d.tl.done}/${d.tl.n}</span>`);
    if (OTT.hasRel(id)) icons.push(ICON('link'));
    if (!open && hasKids) icons.push(`<span class="ocount">${n.children.length}</span>`);
    let prog = '';
    if (kind === 'task' || kind === 'person' || kind === 'category' || kind === 'group') {
      if (d.leaf) {
        const segs = [1, 2, 3].map(i => `<i class="${n.stage >= i ? 'on' : ''}" style="${n.stage >= i ? 'background:' + color : ''}"></i>`).join('');
        prog = `<div class="stg" data-wheel="1" title="Scroll or click to change"><span class="segs">${segs}</span><span>${M.STAGES[n.stage]}</span></div>`;
      } else if (d.progress != null) {
        prog = `<div class="pbar"><span><i style="width:${(d.progress * 100).toFixed(1)}%;background:${color}"></i></span><b>${Math.round(d.progress * 100)}%</b></div>`;
      }
    }
    const isTaskish = kind === 'task' || kind === 'person' || (kind === 'group' && !M.inPeople(S.ed, id));
    const crit = isTaskish ? `<div class="dots" title="Criticality (click; click again to inherit)">${dots('crit', n.crit, d.crit || 0)}</div>` : '';
    const urg = isTaskish ? `<div class="dots u" title="Urgency (click; click again to inherit)">${dots('urg', n.urg, d.urg || 0, d.ramped)}</div>` : '';
    let due = '';
    if (kind === 'info') due = '';
    else if (n.deadline) due = `<span class="due ${d.done ? '' : d.overdue ? 'o' : d.urg >= 3 ? 'u3' : d.urg >= 2 ? 'u2' : ''}" data-due="1">${E(OTT.dueLabel(d))}</span>`;
    else if (d.deadline && isTaskish) due = `<span class="due inh" data-due="1" title="Inherited from parent">${E(OTT.fmtDate(d.deadline))}</span>`;
    else if (isTaskish) due = `<span class="due add" data-due="1">+ date</span>`;
    let who = '';
    if (n.owner && OTT.person(n.owner)) who += `<span class="oav sm" title="${E(OTT.person(n.owner).name)} (owner)">${E(OTT.initials(OTT.person(n.owner).name))}</span>`;
    if (n.stakeholders.length) who += `<span class="more" title="${E(n.stakeholders.map(p => (OTT.person(p) || {}).name).filter(Boolean).join(', '))}">+${n.stakeholders.length}</span>`;
    let bud = '';
    const b = d.budget && Object.entries(d.budget)[0];
    if (b && (b[1].alloc || b[1].spent)) bud = `<span class="${d.budgetOwn ? '' : 'inh'}" title="${E(b[0])} spent ${b[1].spent} of ${b[1].alloc}">${fmtMoney(b[1].spent)}/${fmtMoney(b[1].alloc)}</span>`;
    return `<div class="${cls.join(' ')}" data-id="${id}" style="--c:${color}">
      <div class="oc-title" style="padding-left:${8 + depth * 22}px">${chev}<span class="num">${num}</span>${lead}<span class="ot">${E(OTT.title(n))}</span><span class="oi">${icons.join('')}</span></div>
      <div class="oc-prog">${prog}</div><div class="oc-crit">${crit}</div><div class="oc-urg">${urg}</div>
      <div class="oc-due">${due}</div><div class="oc-who">${who}</div><div class="oc-bud">${bud}</div></div>`;
  }

  function render() {
    order = []; numbers = new Map();
    const out = [];
    const rootId = opt.root();
    if (!rootId || !S.ed.nodes[rootId]) { box.innerHTML = ''; return; }
    const walk = (id, depth, prefix) => {
      const n = S.ed.nodes[id];
      const kids = isFolded(id) && id !== rootId ? [] : n.children;
      kids.forEach((c, i) => {
        const num = prefix ? prefix + '.' + (i + 1) : String(i + 1);
        numbers.set(c, num);
        order.push(c);
        out.push([c, depth]);
        walk(c, depth + 1, num);
      });
    };
    if (rootId !== 'root') { order.push(rootId); out.push([rootId, 0]); numbers.set(rootId, ''); walk(rootId, 1, ''); }
    else walk('root', 0, '');
    const st = box.scrollTop;
    let headTitle;
    if (opt.lens) {
      const path = M.pathTitles(S.ed, rootId).slice(0, -1);
      headTitle = `<span class="lenspath">${E(path.join(' › ') || 'Side panel')}</span><span class="tb-spacer"></span><button class="lensbtn" data-lact="spot" title="Spotlight this branch in the map">${ICON('focus')}</button><button class="lensbtn" data-lact="close" title="Close side panel (Ctrl+L)">${ICON('x')}</button>`;
    } else headTitle = rootId !== 'root' ? '<button class="ofocus" title="Leave focus (Esc)">' + ICON('x') + '</button> ' + E(OTT.title(S.ed.nodes[rootId])) : E(S.ed.title);
    box.innerHTML = `<div class="ohead"><div class="oc-title">${headTitle}</div><div class="oc-prog">Progress</div><div class="oc-crit">Critical</div><div class="oc-urg">Urgent</div><div class="oc-due">Deadline</div><div class="oc-who">People</div><div class="oc-bud">Budget</div></div>` +
      out.map(([id, dep]) => row(id, dep)).join('') + '<div class="ofoot">Tab: subtask · Enter: next task · F2 or type: rename · double-click: fold/unfold all below · Alt+arrows: move/indent · Space: fold · drag rows to move · drop files on a row to attach</div>';
    box.scrollTop = st;
  }

  function scrollTo(id) {
    const r = box.querySelector(`.orow[data-id="${CSS.escape(id)}"]`);
    if (r) r.scrollIntoView({ block: 'nearest' });
  }

  function navigate(key) {
    const i = order.indexOf(S.sel);
    const n = S.ed.nodes[S.sel];
    if (key === 'Home') return C.select(order[0]);
    if (key === 'ArrowDown') return C.select(order[Math.min(order.length - 1, i + 1)] || order[0]);
    if (key === 'ArrowUp') return C.select(order[Math.max(0, i - 1)] || order[0]);
    if (key === 'ArrowRight') { if (n.children.length && isFolded(S.sel)) return setFold(S.sel, false); if (n.children.length) return C.select(n.children[0]); return; }
    if (key === 'ArrowLeft') { if (n.children.length && !isFolded(S.sel) && S.sel !== opt.root()) return setFold(S.sel, true); if (n.parent && n.parent !== 'root' && S.sel !== opt.root()) return C.select(n.parent); }
  }

  function editRect(id) {
    const r = box.querySelector(`.orow[data-id="${CSS.escape(id)}"] .ot`);
    if (!r) return null;
    const br = box.getBoundingClientRect(), rr = r.getBoundingClientRect();
    const row = r.closest('.orow').querySelector('.oc-title').getBoundingClientRect();
    return { x: rr.left - br.left - 4, y: rr.top - br.top + box.scrollTop - 4, w: row.right - rr.left - 8, h: rr.height + 8, fs: 13.5, parent: box };
  }

  // ---------- events ----------
  box.addEventListener('click', (e) => {
    if (e.target.closest('.ofocus')) return C.unfocus();
    const la = e.target.closest('[data-lact]');
    if (la) { if (la.dataset.lact === 'close') C.openLens(S.lens); else C.spotlight(S.lens); return; }
    const r = e.target.closest('.orow');
    if (!r) return;
    const id = r.dataset.id;
    const n = S.ed.nodes[id];
    if (e.target.closest('[data-chev]')) return setFold(id, !isFolded(id));
    const dot = e.target.closest('[data-crit],[data-urg]');
    if (dot) {
      const f = dot.dataset.crit ? 'crit' : 'urg';
      const v = +(dot.dataset.crit || dot.dataset.urg);
      if (OTT.isMulti(id)) {   // a dot on one of several selected rows rates all of them
        const ids = S.multi.filter(x => { const k = S.ed.nodes[x] && (S.ed.nodes[x].kind || 'task'); return k === 'task'; });
        const nv = n[f] === v ? null : v;
        S.sel = id;
        return C.setFieldMany(ids, f, nv, (f === 'crit' ? 'Criticality ' : 'Urgency ') + (nv == null ? 'inherit' : nv) + ' for ' + ids.length + ' items');
      }
      C.select(id, { scroll: false });
      return C.setField(id, f, n[f] === v ? null : v, (f === 'crit' ? 'Criticality ' : 'Urgency ') + (n[f] === v ? 'inherit' : v));
    }
    if (e.target.closest('.stg')) { C.select(id, { scroll: false }); C.setStage(id, (n.stage + 1) % (M.STAGE_MAX + 1)); return; }
    if (e.target.closest('[data-due]')) { C.select(id, { scroll: false }); return editDate(id, e.target.closest('[data-due]')); }
    if (Date.now() - dropT < 400) return;          // the click that ends a drag
    if (!S.pickTo && !S.linkFrom) {
      if (e.shiftKey) return C.selectRange(order, id);           // Shift: everything from the last clicked row
      if (e.ctrlKey || e.metaKey) return C.toggleMulti(id);      // Ctrl: add / take out one row
    }
    C.select(id, { scroll: false });
  });
  // our own double-click detection (the row is redrawn between the two clicks, which loses the browser's dblclick)
  let lastDown = {};
  box.addEventListener('pointerdown', (e) => {
    const r = e.target.closest('.orow');
    if (r && e.button === 0 && (e.shiftKey || e.ctrlKey || e.metaKey)) { e.preventDefault(); lastDown = {}; return; }   // no text selection, no double-click
    if (!r || e.button !== 0 || !e.target.closest('.oc-title') || e.target.closest('[data-chev],[data-attbadge],[data-notebadge],[data-tlbadge],input')) { lastDown = {}; return; }
    const now = Date.now(), id = r.dataset.id;
    if (lastDown.id === id && now - lastDown.t < 450 && Math.abs(e.clientY - lastDown.y) < 8) { lastDown = {}; e.preventDefault(); onDouble(id); return; }
    lastDown = { id, t: now, y: e.clientY };
  }, true);
  function onDouble(id) {
    const n = S.ed.nodes[id];
    if (!n) return;
    if (!n.children.length) return setTimeout(() => OTT.startEdit(id), 80);   // no subtasks: double-click renames (after the click, so it keeps focus)
    if (opt.lens) {   // the side panel folds on its own
      const ids = M.subtreeIds(S.ed, id);
      const anyFolded = ids.some(x => S.ed.nodes[x].children.length && isFolded(x) && x !== opt.root());
      if (anyFolded) for (const x of ids) fold.set(x, false);
      else if (id === opt.root()) for (const c of n.children) fold.set(c, true);
      else fold.set(id, true);
      OTT.render();
    } else if (id === opt.root() && id !== 'root') {
      const ids = M.subtreeIds(S.ed, id);
      if (ids.some(x => x !== id && S.ed.nodes[x].children.length && S.ed.nodes[x].collapsed)) C.toggleAll(id);
      else C.expandBelow(id, true);
    } else C.toggleAll(id);
  }
  box.addEventListener('contextmenu', (e) => {
    const r = e.target.closest('.orow');
    if (r) { e.preventDefault(); OTT.contextMenu(e.clientX, e.clientY, r.dataset.id); }
  });

  let wAcc = 0, wT = 0;
  box.addEventListener('wheel', (e) => {
    const st = e.target.closest('[data-wheel]');
    if (!st) return;
    e.preventDefault();
    const id = st.closest('.orow').dataset.id;
    if (Date.now() - wT > 300) wAcc = 0;
    wT = Date.now(); wAcc += e.deltaY;
    if (Math.abs(wAcc) >= 50) {
      const n = S.ed.nodes[id];
      C.setStage(id, n.stage + (wAcc < 0 ? 1 : -1));
      wAcc = 0;
      OTT.showWheelTip(e.clientX, e.clientY, n.stage, OTT.catColor(OTT.d(id).cat));
    }
  }, { passive: false });

  function editDate(id, anchor) {
    const n = S.ed.nodes[id];
    const inp = document.createElement('input');
    inp.type = 'date';
    inp.className = 'inplace date';
    inp.value = n.deadline || '';
    const br = box.getBoundingClientRect(), ar = anchor.closest('.oc-due').getBoundingClientRect();
    Object.assign(inp.style, { left: (ar.left - br.left) + 'px', top: (ar.top - br.top + box.scrollTop + 2) + 'px', width: Math.max(140, ar.width) + 'px', height: (ar.height - 4) + 'px', fontSize: '12.5px' });
    box.appendChild(inp);
    inp.focus();
    try { inp.showPicker(); } catch (_) {}
    let done = false;
    const fin = (commit) => { if (done) return; done = true; const v = inp.value || null; inp.remove(); if (commit) C.setField(id, 'deadline', v, v ? 'Deadline' : 'Clear deadline'); OTT.focusStage(); };
    inp.addEventListener('change', () => fin(true));
    inp.addEventListener('blur', () => fin(true));
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') fin(true); if (e.key === 'Escape') fin(false); if (e.key === 'Delete') { inp.value = ''; fin(true); } });
  }

  // drag rows to move
  let drag = null, dropT = 0;
  box.addEventListener('pointerdown', (e) => {
    const r = e.target.closest('.orow');
    if (!r || e.button !== 0 || e.target.closest('button,[data-crit],[data-urg],[data-due],.stg,input')) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) return;
    drag = { id: r.dataset.id, sx: e.clientX, sy: e.clientY, moved: false, multi: OTT.isMulti(r.dataset.id) };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
    if (!C.canRemove(drag.id)) return;
    if (!drag.moved) { drag.moved = true; drag.ids = drag.multi ? OTT.topIds(S.multi) : [drag.id]; $('#dropghost').hidden = false; box.classList.add('dragging'); }
    const sr = $('#stage').getBoundingClientRect(), gh = $('#dropghost');
    gh.textContent = (e.ctrlKey ? '+ Copy: ' : '') + (drag.ids.length > 1 ? drag.ids.length + ' items' : OTT.title(S.ed.nodes[drag.id]));
    gh.style.left = (e.clientX - sr.left + 12) + 'px'; gh.style.top = (e.clientY - sr.top + 8) + 'px';
    drag.target = OTT.dropTarget(e.clientX, e.clientY, drag.id);
    OTT.markDrop(drag.target);
    // autoscroll near edges
    const br = box.getBoundingClientRect();
    if (e.clientY < br.top + 40) box.scrollTop -= 12; else if (e.clientY > br.bottom - 40) box.scrollTop += 12;
  });
  window.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    $('#dropghost').hidden = true; box.classList.remove('dragging'); OTT.markDrop(null);
    if (d.moved) dropT = Date.now();
    if (d.moved && d.target) OTT.dropItems(d, e.ctrlKey);
  });

  // files dropped on rows
  box.addEventListener('dragover', (e) => {
    e.preventDefault();
    const r = e.target.closest('.orow');
    $$('.orow.filedrop').forEach(x => x !== r && x.classList.remove('filedrop'));
    if (r) r.classList.add('filedrop');
  });
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    $$('.orow.filedrop').forEach(x => x.classList.remove('filedrop'));
    const r = e.target.closest('.orow');
    if (!r) return;
    C.select(r.dataset.id, { scroll: false });
    OTT.handleDrop(r.dataset.id, e);
  });

  box.addEventListener('focusin', () => { OTT.lensHadFocus = !!opt.lens; });
  return { render, scrollTo, navigate, editRect, toggle: (id) => { if (S.ed.nodes[id] && S.ed.nodes[id].children.length) setFold(id, !isFolded(id)); } };
  }

  OTT.views.outline = createOutline($('#outline'), { root: () => S.focus });
  OTT.views.lens = createOutline($('#lens'), { root: () => S.lens, lens: true });
})();
