/* One Todo Tree — Urgent × Critical matrix of open tasks (leaves), across all categories. */
(function () {
  'use strict';
  const S = OTT.S, C = OTT.cmd;
  const box = $('#matrix');
  const LABEL = { '3-3': 'Do now', '3-2': 'Schedule soon', '3-1': 'Plan', '2-3': 'Do soon', '2-2': 'Keep moving', '2-1': 'When there is time', '1-3': 'Quick / delegate', '1-2': 'Delegate', '1-1': 'Later / drop?' };
  let showUnrated = true;

  function collect() {
    const out = [];
    for (const [id, d] of S.der) {
      const n = S.ed.nodes[id];
      if (!d.leaf || d.done || n.kind) continue;
      if (S.catFilter && !S.catFilter.includes(d.cat)) continue;
      if (S.focus !== 'root' && !M.isAncestor(S.ed, S.focus, id)) continue;
      out.push({ id, n, d, rated: d.crit != null || d.urg != null });
    }
    out.sort((a, b) => (b.d.overdue - a.d.overdue) || ((a.d.days == null ? 1e9 : a.d.days) - (b.d.days == null ? 1e9 : b.d.days)) || ((b.d.crit || 0) - (a.d.crit || 0)) || a.n.title.localeCompare(b.n.title));
    return out;
  }

  function card(it) {
    const { id, n, d } = it;
    const color = OTT.catColor(d.cat);
    const path = M.pathTitles(S.ed, id).slice(0, -1);
    const segs = [1, 2, 3].map(i => `<i class="${n.stage >= i ? 'on' : ''}" style="${n.stage >= i ? 'background:' + color : ''}"></i>`).join('');
    const due = d.deadline ? `<span class="due ${d.overdue ? 'o' : d.urg >= 3 ? 'u3' : d.urg >= 2 ? 'u2' : ''} ${d.deadlineOwn ? '' : 'inh'}">${E(OTT.dueLabel(d))}</span>` : '';
    const who = n.owner && OTT.person(n.owner) ? `<span class="oav sm" title="${E(OTT.person(n.owner).name)}">${E(OTT.initials(OTT.person(n.owner).name))}</span>` : '';
    return `<div class="mcard ${id === S.sel ? 'sel' : ''} ${S.search && S.hits.includes(id) ? 'hit' : ''}" data-id="${id}" style="--c:${color}">
      <div class="mt">${E(OTT.title(n))}</div>
      <div class="mp">${E(path.slice(-2).join(' › '))}</div>
      <div class="mf"><span class="stg" data-wheel="1" title="${M.STAGES[n.stage]} — scroll to change"><span class="segs">${segs}</span></span>${n.attachments.length ? `<span class="obadge" data-attbadge="1">${ICON('clip')}${n.attachments.length > 1 ? n.attachments.length : ''}</span>` : ''}${n.notes && n.notes.trim() ? `<span class="obadge" data-notebadge="1">${ICON('note')}</span>` : ''}${who}${due}</div></div>`;
  }

  function render() {
    const items = collect();
    const cells = {};
    const unrated = [];
    for (const it of items) {
      if (!it.rated) { unrated.push(it); continue; }
      const key = (it.d.crit || 1) + '-' + (it.d.urg || 1);
      (cells[key] = cells[key] || []).push(it);
    }
    const chips = S.settings.categories.filter(c => !c.archived).map(c => `<button class="chip ${!S.catFilter || S.catFilter.includes(c.key) ? 'on' : ''}" data-cat="${c.key}" style="--c:${c.color}"><i></i>${E(c.name)}</button>`).join('');
    let grid = '';
    for (const cr of [3, 2, 1]) {
      grid += `<div class="mylab">${['', 'Low', 'Medium', 'High'][cr]}</div>`;
      for (const ur of [1, 2, 3]) {
        const key = cr + '-' + ur;
        const arr = cells[key] || [];
        grid += `<div class="mcell q${cr}${ur}" data-crit="${cr}" data-urg="${ur}"><div class="mlab">${LABEL[key]} <span>${arr.length || ''}</span></div><div class="mlist">${arr.map(card).join('')}</div></div>`;
      }
    }
    grid += `<div></div><div class="mxlab">Not urgent</div><div class="mxlab">Soon</div><div class="mxlab">Urgent</div>`;
    const st = {};
    box.querySelectorAll('.mlist').forEach((l, i) => { st[i] = l.scrollTop; });
    box.innerHTML = `<div class="mtop"><div class="chips"><button class="chip all ${!S.catFilter ? 'on' : ''}" data-cat="*">All</button>${chips}</div>
      <div class="mhint">Open tasks without subtasks${S.focus !== 'root' ? ' in “' + E(OTT.title(S.ed.nodes[S.focus])) + '”' : ''}. Drag a card to re-rate it; a deadline can lift urgency automatically.</div></div>
      <div class="mwrap"><div class="maxis"><span>Critical →</span></div><div class="mgrid">${grid}</div></div>
      <div class="munrated ${showUnrated ? 'open' : ''}"><button class="mtoggle">${ICON('chev')} Not rated yet <span>${unrated.length}</span></button><div class="mlist row">${showUnrated ? unrated.map(card).join('') : ''}</div></div>`;
    box.querySelectorAll('.mlist').forEach((l, i) => { if (st[i]) l.scrollTop = st[i]; });
  }

  box.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) {
      const k = chip.dataset.cat;
      if (k === '*') S.catFilter = null;
      else {
        const all = S.settings.categories.filter(c => !c.archived).map(c => c.key);
        let f = S.catFilter ? S.catFilter.slice() : [];
        if (e.ctrlKey || S.catFilter) { f = f.includes(k) ? f.filter(x => x !== k) : f.concat(k); }
        else f = [k];
        S.catFilter = f.length && f.length < all.length ? f : null;
      }
      return OTT.render();
    }
    if (e.target.closest('.mtoggle')) { showUnrated = !showUnrated; return OTT.render(); }
    const c = e.target.closest('.mcard');
    if (!c) return;
    if (e.target.closest('.stg')) { const n = S.ed.nodes[c.dataset.id]; C.select(c.dataset.id, { scroll: false }); C.setStage(c.dataset.id, (n.stage + 1) % (M.STAGE_MAX + 1)); return; }
    C.select(c.dataset.id, { scroll: false });
  });
  box.addEventListener('dblclick', (e) => {
    const c = e.target.closest('.mcard');
    if (c) { C.reveal(c.dataset.id); OTT.setView('map'); C.select(c.dataset.id); }
  });
  box.addEventListener('contextmenu', (e) => { const c = e.target.closest('.mcard'); if (c) { e.preventDefault(); OTT.contextMenu(e.clientX, e.clientY, c.dataset.id); } });

  let wAcc = 0, wT = 0;
  box.addEventListener('wheel', (e) => {
    const st = e.target.closest('[data-wheel]');
    if (!st) return;
    e.preventDefault();
    const id = st.closest('.mcard').dataset.id;
    if (Date.now() - wT > 300) wAcc = 0;
    wT = Date.now(); wAcc += e.deltaY;
    if (Math.abs(wAcc) >= 50) {
      const n = S.ed.nodes[id];
      C.setStage(id, n.stage + (wAcc < 0 ? 1 : -1)); wAcc = 0;
      OTT.showWheelTip(e.clientX, e.clientY, n.stage, OTT.catColor(OTT.d(id).cat));
    }
  }, { passive: false });

  // drag cards between cells
  let drag = null;
  box.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('.mcard');
    if (!c || e.button !== 0 || e.target.closest('.stg')) return;
    drag = { id: c.dataset.id, sx: e.clientX, sy: e.clientY, moved: false, el: c };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag || S.view !== 'matrix') return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
    if (!drag.moved) { drag.moved = true; const gh = $('#dropghost'); gh.textContent = OTT.title(S.ed.nodes[drag.id]); gh.hidden = false; drag.el.classList.add('dragsrc'); }
    const sr = $('#stage').getBoundingClientRect(), gh = $('#dropghost');
    gh.style.left = (e.clientX - sr.left + 12) + 'px'; gh.style.top = (e.clientY - sr.top + 8) + 'px';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el && el.closest('.mcell');
    $$('.mcell.over').forEach(x => x !== cell && x.classList.remove('over'));
    if (cell) cell.classList.add('over');
    drag.cell = cell;
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag; drag = null;
    $('#dropghost').hidden = true;
    $$('.mcell.over').forEach(x => x.classList.remove('over'));
    if (d.el) d.el.classList.remove('dragsrc');
    if (!d.moved || !d.cell) return;
    const cr = +d.cell.dataset.crit, ur = +d.cell.dataset.urg;
    C.select(d.id, { scroll: false });
    OTT.tx('Re-rate', (c) => { const n = c.touch(d.id); n.crit = cr; n.urg = ur; });
    const dd = OTT.d(d.id);
    if (dd.urg > ur) OTT.toast('The deadline keeps this at urgency ' + dd.urg + ' (' + OTT.dueLabel(dd) + ').', 'info', 3500);
  });

  function scrollTo(id) { const c = box.querySelector(`.mcard[data-id="${CSS.escape(id)}"]`); if (c) c.scrollIntoView({ block: 'nearest' }); }
  function navigate(key) {
    const cards = $$('.mcard', box).map(c => c.dataset.id);
    if (!cards.length) return;
    const i = cards.indexOf(S.sel);
    if (key === 'ArrowDown' || key === 'ArrowRight') C.select(cards[Math.min(cards.length - 1, i + 1)]);
    else if (key === 'ArrowUp' || key === 'ArrowLeft') C.select(cards[Math.max(0, i - 1)]);
  }
  OTT.views.matrix = { render, scrollTo, navigate };
})();
