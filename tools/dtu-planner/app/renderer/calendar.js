/* One Todo Tree — Calendar view: one column per month, one row per day (planner style), with periods,
   deadlines and timeline steps overlaid. Danish holidays / special days, week numbers, DTU periods.
   The same markup (percent-based) renders on screen and into the print PDF. */
(function () {
  'use strict';
  const S = OTT.S, C = OTT.cmd;
  const box = $('#calendar');
  const MON = ['Januar', 'Februar', 'Marts', 'April', 'Maj', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'December'];
  const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];
  const WD = ['S', 'M', 'T', 'O', 'T', 'F', 'L'];   // søn, man, tirs, ons, tors, fre, lør
  const pad = (x) => String(x).padStart(2, '0');

  function cfg() {
    const c = S.ui.cal || (S.ui.cal = {});
    if (!/^\d{4}-\d{2}$/.test(c.start || '')) c.start = M.todayStr().slice(0, 7);
    if (!(c.months >= 1 && c.months <= 24)) c.months = 12;
    if (c.steps == null) c.steps = true;
    if (c.done == null) c.done = false;
    if (c.sem == null) c.sem = true;
    return c;
  }
  const save = () => OTT.saveUiSoon();
  function months(c) {
    const [y0, m0] = c.start.split('-').map(Number);
    const out = [];
    for (let i = 0; i < c.months; i++) {
      const dt = new Date(y0, m0 - 1 + i, 1);
      const y = dt.getFullYear(), m = dt.getMonth() + 1;
      const days = new Date(y, m, 0).getDate();
      out.push({ y, m, days, first: y + '-' + pad(m) + '-01', last: y + '-' + pad(m) + '-' + pad(days) });
    }
    return out;
  }
  function shiftStart(c, k) { const [y, m] = c.start.split('-').map(Number); const dt = new Date(y, m - 1 + k, 1); c.start = dt.getFullYear() + '-' + pad(dt.getMonth() + 1); }
  /** readable text on a colour */
  function fgOn(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#fff';
    const v = parseInt(m[1], 16), r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 165 ? '#1c2127' : '#fff';
  }

  // ---------- what goes on the calendar ----------
  function collect(c, first, last) {
    const today = M.todayStr(), items = [];
    for (const [id, d] of S.der) {
      const n = S.ed.nodes[id];
      if (!n || n.kind === 'root' || n.kind === 'category' || n.kind === 'info') continue;
      if (S.focus !== 'root' && !M.isAncestor(S.ed, S.focus, id)) continue;
      if (c.cats && !c.cats.includes(d.cat)) continue;
      const color = n.color || OTT.catColor(d.cat);
      if (n.deadline && (c.done || !d.done)) {
        const s = n.deadline, e = d.end || n.deadline;
        if (e >= first && s <= last) items.push({ id, kind: d.end ? 'range' : 'dl', s, e, title: OTT.title(n), color, done: d.done, over: d.overdue, now: d.now });
      }
      if (c.steps && n.timeline && (c.done || !d.done)) {
        for (const st of n.timeline) {
          if ((st.done && !c.done) || st.date < first || st.date > last) continue;
          items.push({ id, sid: st.id, kind: 'step', s: st.date, e: st.date, title: M.stepTitle(st), parent: OTT.title(n), color, done: st.done, over: !st.done && st.date < today });
        }
      }
    }
    return items;
  }
  /** Side-by-side lanes for overlapping items within one month (clusters share the width). */
  function lanes(list) {
    const order = { range: 0, dl: 1, step: 2 };
    list.sort((p, q) => p.a - q.a || (q.b - q.a) - (p.b - p.a) || order[p.kind] - order[q.kind] || p.title.localeCompare(q.title));
    let cluster = [], cEnd = -1, ends = [];
    const flush = () => { for (const it of cluster) it.n = ends.length; cluster = []; ends = []; };
    for (const it of list) {
      if (it.a > cEnd && cluster.length) flush();
      let lane = ends.findIndex(e => e < it.a);
      if (lane < 0) { lane = ends.length; ends.push(it.b); } else ends[lane] = it.b;
      it.lane = lane; cluster.push(it); cEnd = Math.max(cEnd, it.b);
    }
    flush();
    return list;
  }

  // ---------- markup (shared by screen and print) ----------
  function grid(c, opt) {
    opt = opt || {};
    const ms = months(c);
    const first = ms[0].first, last = ms[ms.length - 1].last, today = M.todayStr();
    const items = collect(c, first, last);
    const sems = c.sem ? (S.settings.semesters || []).filter(p => p && p.start && p.end && p.end >= first && p.start <= last) : [];
    let h = '';
    for (const mo of ms) {
      let rows = '';
      for (let day = 1; day <= 31; day++) {
        if (day > mo.days) { rows += '<div class="cday none"></div>'; continue; }
        const iso = mo.y + '-' + pad(mo.m) + '-' + pad(day);
        const dow = new Date(mo.y, mo.m - 1, day).getDay();
        const dk = M.dkDay(iso);
        const cls = ['cday', 'wd' + dow, dk ? dk.kind : '', !opt.print && iso === today ? 'today' : ''].join(' ');
        rows += `<div class="${cls}" data-date="${iso}"><span class="cwl">${WD[dow]}</span><span class="cdn">${day}</span>${dk ? `<span class="chn">${E(dk.name)}</span>` : ''}${dow === 1 ? `<span class="cwk">${M.isoWeek(iso)}</span>` : ''}</div>`;
      }
      // DTU periods: a faint strip at the right edge
      let sem = '';
      for (const p of sems) {
        if (p.end < mo.first || p.start > mo.last) continue;
        const a = (p.start < mo.first ? 1 : +p.start.slice(8)) - 1, b = (p.end > mo.last ? mo.days : +p.end.slice(8)) - 1;
        sem += `<div class="csem k-${p.kind === 'exam' ? 'exam' : 'teach'}" style="top:${(a / 31 * 100).toFixed(3)}%;height:${((b - a + 1) / 31 * 100).toFixed(3)}%" title="${E(p.label)}: ${E(OTT.fmtRange(p.start, p.end))}"></div>`;
      }
      // items clipped to this month
      const mine = [];
      for (const it of items) {
        if (it.e < mo.first || it.s > mo.last) continue;
        mine.push(Object.assign({}, it, { a: (it.s < mo.first ? 1 : +it.s.slice(8)) - 1, b: (it.e > mo.last ? mo.days : +it.e.slice(8)) - 1, ct: it.s < mo.first, cb: it.e > mo.last }));
      }
      let ev = '';
      for (const it of lanes(mine)) {
        const top = it.a / 31 * 100, ht = (it.b - it.a + 1) / 31 * 100, left = it.lane / it.n * 100, w = 100 / it.n;
        const sel = !opt.print && it.id === S.sel && (!it.sid || it.sid === selStep) ? 'sel' : '';
        const hit = !opt.print && S.search && S.hits.includes(it.id) ? 'hit' : '';
        const label = it.kind === 'dl' ? '⚑ ' + it.title : it.title;
        const tip = it.kind === 'step' ? `${it.title} — step of “${it.parent}” · ${OTT.fmtDate(it.s)}` : `${it.title} · ${it.kind === 'range' ? OTT.fmtRange(it.s, it.e) : 'deadline ' + OTT.fmtDate(it.s)}`;
        const short = it.b - it.a < 2 ? 'short' : '';
        ev += `<div class="cev k-${it.kind} ${short} ${it.done ? 'done' : ''} ${it.over ? 'over' : ''} ${it.now ? 'now' : ''} ${it.ct ? 'ct' : ''} ${it.cb ? 'cb' : ''} ${sel} ${hit}" data-id="${it.id}"${it.sid ? ` data-sid="${it.sid}"` : ''} style="top:calc(${top.toFixed(3)}% + 1px);height:calc(${ht.toFixed(3)}% - 2px);left:calc(${left.toFixed(3)}% + 1px);width:calc(${w.toFixed(3)}% - 2px);--c:${it.color};--fg:${fgOn(it.color)}" title="${E(tip)}"><span>${E(label)}</span></div>`;
      }
      h += `<div class="cmon"><div class="cmh">${MON[mo.m - 1]} <small>${mo.y}</small></div><div class="cbody"><div class="cdays">${rows}</div>${sem ? `<div class="csems">${sem}</div>` : ''}<div class="cevs">${ev}</div></div></div>`;
    }
    return { html: `<div class="cgrid" style="--n:${ms.length}">${h}</div>`, ms, items, sems };
  }
  function rangeLabel(ms) { const a = ms[0], b = ms[ms.length - 1]; return ms.length === 1 ? MON[a.m - 1] + ' ' + a.y : MON3[a.m - 1] + ' ' + a.y + ' – ' + MON3[b.m - 1] + ' ' + b.y; }

  // ---------- screen ----------
  let selStep = null;
  function render() {
    const c = cfg();
    const g = grid(c);
    const cats = S.settings.categories.filter(x => !x.archived);
    const chips = cats.map(x => `<button class="chip ${!c.cats || c.cats.includes(x.key) ? 'on' : ''}" data-ccat="${x.key}" style="--c:${x.color}"><i></i>${E(x.name)}</button>`).join('');
    const scroll = box.querySelector('.cgwrap') ? [box.querySelector('.cgwrap').scrollLeft, box.querySelector('.cgwrap').scrollTop] : null;
    box.innerHTML = `<div class="ctop">
        <div class="cnav"><button data-cnav="-1" title="Earlier month">${ICON('chev')}</button><button data-cnav="0" title="Start from this month">Today</button><button data-cnav="1" title="Later month">${ICON('chev')}</button><b>${E(rangeLabel(g.ms))}</b></div>
        <select data-cset="months" title="Number of months">${[1, 2, 3, 4, 6, 9, 12, 18, 24].map(k => `<option value="${k}" ${k === c.months ? 'selected' : ''}>${k} month${k > 1 ? 's' : ''}</option>`).join('')}</select>
        <select data-cset="preset" title="Jump to"><option value="">Jump to…</option><option value="ay">Academic year (Aug–Jul)</option><option value="cy">Calendar year (Jan–Dec)</option><option value="now">From this month</option></select>
        <label class="ctg"><input type="checkbox" data-cset="steps" ${c.steps ? 'checked' : ''}> Steps</label>
        <label class="ctg"><input type="checkbox" data-cset="done" ${c.done ? 'checked' : ''}> Done</label>
        <label class="ctg"><input type="checkbox" data-cset="sem" ${c.sem ? 'checked' : ''}> DTU periods</label>
        <span class="tb-spacer"></span>
        <button class="cprint" data-cprint="1">${ICON('pdf')} Print / PDF…</button>
      </div>
      <div class="cchips"><button class="chip all ${!c.cats ? 'on' : ''}" data-ccat="*">All</button>${chips}<span class="chint">Drag down over days to add a period · double-click a day for a deadline · click an item for its status</span></div>
      <div class="cgwrap">${g.html}</div>`;
    if (scroll) { const w = box.querySelector('.cgwrap'); w.scrollLeft = scroll[0]; w.scrollTop = scroll[1]; }
    if (card && card.it) refreshCard();
  }

  // ---------- status card ----------
  let card = null;
  function ensureCard() {
    if (card) return card;
    const el = document.createElement('div');
    el.id = 'calcard'; el.hidden = true;
    document.body.appendChild(el);
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', onCardClick);
    card = { el, it: null };
    return card;
  }
  function hideCard() { if (card) { card.el.hidden = true; card.it = null; } }
  function showCard(it, rect) { ensureCard(); card.it = it; card.rect = rect; refreshCard(); }
  function refreshCard() {
    const it = card.it, n = S.ed.nodes[it.id];
    if (!n) return hideCard();
    const d = OTT.d(it.id), color = n.color || OTT.catColor(d.cat);
    const path = M.pathTitles(S.ed, it.id).slice(0, -1);
    const st = it.sid && (n.timeline || []).find(x => x.id === it.sid);
    let h = `<div class="cc-path"><i style="background:${color}"></i>${E(path.join(' › ') || OTT.catOf(d.cat).name)}</div>`;
    h += `<div class="cc-title">${E(OTT.title(n))}</div>`;
    if (st) h += `<div class="cc-step ${st.done ? 'done' : ''}"><b>Step:</b> ${E(M.stepTitle(st))} · ${E(OTT.fmtDate(st.date))}${st.done ? ' · done' : ' · ' + E(OTT.stepDays(M.daysUntil(st.date)))}</div>`;
    if (n.deadline) h += `<div class="cc-date">${ICON('cal')} ${d.end ? E(OTT.fmtRange(n.deadline, d.end)) + ' <span>(' + (M.daysUntil(d.end, n.deadline) + 1) + ' days)</span>' : 'Deadline ' + E(OTT.fmtDate(n.deadline))} <em class="${d.overdue ? 'bad' : ''}">${E(OTT.dueLabel(d))}</em></div>`;
    if (d.leaf) h += `<div class="cc-stages">${M.STAGES.map((s, i) => `<button data-ccst="${i}" class="${n.stage === i ? 'on' : ''}" style="--c:${color}">${s}</button>`).join('')}</div>`;
    else if (d.progress != null) h += `<div class="pbar"><span><i style="width:${(d.progress * 100).toFixed(1)}%;background:${color}"></i></span><b>${Math.round(d.progress * 100)}%</b></div>`;
    const LV = ['', 'low', 'medium', 'high'];
    const facts = [];
    if (d.crit) facts.push('Critical: ' + LV[d.crit]);
    if (d.urg) facts.push('Urgent: ' + LV[d.urg]);
    if (n.owner && OTT.person(n.owner)) facts.push('Owner: ' + OTT.person(n.owner).name);
    if (d.tl) facts.push('Steps ' + d.tl.done + '/' + d.tl.n + (d.tl.next ? ' · next: ' + d.tl.next.title + ' ' + OTT.fmtDate(d.tl.next.date) : ''));
    if (facts.length) h += `<div class="cc-facts">${facts.map(E).join('<br>')}</div>`;
    h += `<div class="cc-btns"><button data-cc="tree" class="primary">${ICON('map')} Show in tree</button>${st ? `<button data-cc="step">${ICON('check')} ${st.done ? 'Reopen step' : 'Step done'}</button>` : ''}<button data-cc="details">Details</button></div>`;
    card.el.innerHTML = h;
    card.el.hidden = false;
    const r = card.el.getBoundingClientRect(), a = card.rect;
    let x = a.right + 8, y = a.top;
    if (x + r.width > innerWidth - 8) x = a.left - r.width - 8;
    if (x < 8) x = Math.min(innerWidth - r.width - 8, a.left);
    if (y + r.height > innerHeight - 8) y = innerHeight - r.height - 8;
    card.el.style.left = Math.max(8, x) + 'px'; card.el.style.top = Math.max(8, y) + 'px';
  }
  function onCardClick(e) {
    const b = e.target.closest('button'); if (!b || !card.it) return;
    const it = card.it;
    if (b.dataset.ccst != null) { C.setStage(it.id, +b.dataset.ccst); OTT.renderNow(); return; }
    if (b.dataset.cc === 'tree') { hideCard(); C.reveal(it.id); OTT.setView('map'); C.select(it.id); return; }
    if (b.dataset.cc === 'step') { C.toggleStep(it.id, it.sid); OTT.renderNow(); return; }
    if (b.dataset.cc === 'details') {
      hideCard();
      if (!S.inspectorOpen) { S.inspectorOpen = true; S.ui.inspector = true; save(); OTT.inspector.invalidate(); }
      C.select(it.id); OTT.renderNow();
      return;
    }
  }
  document.addEventListener('pointerdown', (e) => { if (card && !card.el.hidden && !e.target.closest('#calcard') && !e.target.closest('.cev')) hideCard(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && card && !card.el.hidden) { hideCard(); e.stopImmediatePropagation(); } }, true);

  // ---------- toolbar ----------
  box.addEventListener('click', (e) => {
    const c = cfg();
    const nav = e.target.closest('[data-cnav]');
    if (nav) { if (nav.dataset.cnav === '0') c.start = M.todayStr().slice(0, 7); else shiftStart(c, +nav.dataset.cnav); save(); return render(); }
    const chip = e.target.closest('[data-ccat]');
    if (chip) {
      const k = chip.dataset.ccat, all = S.settings.categories.filter(x => !x.archived).map(x => x.key);
      if (k === '*') c.cats = null;
      else {
        let f = c.cats ? c.cats.slice() : [];
        if (e.ctrlKey || c.cats) f = f.includes(k) ? f.filter(x => x !== k) : f.concat(k); else f = [k];
        c.cats = f.length && f.length < all.length ? f : null;
      }
      save(); return render();
    }
    if (e.target.closest('[data-cprint]')) return printDialog();
    const ev = e.target.closest('.cev');
    if (ev) {
      selStep = ev.dataset.sid || null;
      C.select(ev.dataset.id, { scroll: false });
      const it = { id: ev.dataset.id, sid: ev.dataset.sid || null };
      OTT.renderNow();
      const el = box.querySelector(`.cev[data-id="${CSS.escape(it.id)}"]${it.sid ? `[data-sid="${CSS.escape(it.sid)}"]` : ':not([data-sid])'}`) || ev;
      showCard(it, el.getBoundingClientRect());
    }
  });
  box.addEventListener('change', (e) => {
    const t = e.target, c = cfg(), k = t.dataset.cset;
    if (!k) return;
    if (k === 'months') c.months = +t.value;
    else if (k === 'preset') {
      const [y, m] = M.todayStr().split('-').map(Number);
      if (t.value === 'ay') { c.start = (m >= 8 ? y : y - 1) + '-08'; c.months = 12; }
      else if (t.value === 'cy') { c.start = y + '-01'; c.months = 12; }
      else if (t.value === 'now') c.start = M.todayStr().slice(0, 7);
    } else c[k] = t.checked;
    save(); render();
  });
  box.addEventListener('dblclick', (e) => {
    const ev = e.target.closest('.cev');
    if (ev) { hideCard(); C.reveal(ev.dataset.id); OTT.setView('map'); C.select(ev.dataset.id); return; }
    const day = e.target.closest('.cday[data-date]');
    if (day) newItem(day.dataset.date, day.dataset.date);
  });
  box.addEventListener('contextmenu', (e) => { const ev = e.target.closest('.cev'); if (ev) { e.preventDefault(); OTT.contextMenu(e.clientX, e.clientY, ev.dataset.id); } });

  // ---------- drag over days = new period ----------
  let pick = null;
  box.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.cev')) return;
    const day = e.target.closest('.cday[data-date]');
    if (!day) return;
    pick = { a: day.dataset.date, b: day.dataset.date, moved: false };
  });
  window.addEventListener('pointermove', (e) => {
    if (!pick || S.view !== 'calendar') return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const day = el && el.closest && el.closest('#calendar .cday[data-date]');
    if (!day || day.dataset.date === pick.b) return;
    pick.b = day.dataset.date; pick.moved = true;
    const [lo, hi] = pick.a < pick.b ? [pick.a, pick.b] : [pick.b, pick.a];
    for (const r of box.querySelectorAll('.cday[data-date]')) r.classList.toggle('csel', r.dataset.date >= lo && r.dataset.date <= hi);
  });
  window.addEventListener('pointerup', () => {
    if (!pick) return;
    const p = pick; pick = null;
    if (!p.moved || p.a === p.b) { box.querySelectorAll('.csel').forEach(r => r.classList.remove('csel')); return; }
    const [lo, hi] = p.a < p.b ? [p.a, p.b] : [p.b, p.a];
    newItem(lo, hi);
  });

  function newItem(a, b) {
    const cats = S.settings.categories.filter(x => !x.archived && 'cat-' + x.key !== M.PEOPLE_CAT && S.ed.nodes['cat-' + x.key]);
    if (!cats.length) return;
    const def = cats.find(x => x.key === S.ui.calCat) ? S.ui.calCat : cats[0].key;
    const isRange = a !== b;
    const dlg = OTT.dialogs.open(`<header><h2>${isRange ? 'New period' : 'New deadline'}</h2><p>${E(isRange ? OTT.fmtRange(a, b) + ' (' + (M.daysUntil(b, a) + 1) + ' days)' : OTT.fmtDate(a))}</p><button class="dx" data-close>${ICON('x')}</button></header>
      <div class="dbody"><label class="fl">Title<input id="cvt" autofocus spellcheck="true" placeholder="${isRange ? 'e.g. Conference, Ferie, Travel to Lund…' : 'e.g. Report due'}"></label>
      <label class="fl">Category<select id="cvc">${cats.map(x => `<option value="${x.key}" ${x.key === def ? 'selected' : ''}>${E(x.name)}</option>`).join('')}</select></label>
      <p class="hint">It becomes a task in that category, so it also shows in the map, with reminders.</p></div>
      <footer><button data-close>Cancel</button><button class="primary" id="cvok">Add</button></footer>`, 'small', () => box.querySelectorAll('.csel').forEach(r => r.classList.remove('csel')));
    const ok = () => {
      const title = $('#cvt', dlg).value.trim();
      if (!title) { $('#cvt', dlg).focus(); return; }
      const key = $('#cvc', dlg).value, pid = 'cat-' + key;
      let nid = null;
      OTT.tx(isRange ? 'Add period' : 'Add deadline', (cx) => {
        const par = cx.touch(pid);
        const node = M.newNode({ parent: pid, title, deadline: a });
        if (isRange) node.end = b;
        cx.add(node); par.children.push(node.id); nid = node.id;
      });
      S.ui.calCat = key; save();
      OTT.dialogs.close();
      selStep = null;
      C.select(nid, { scroll: false });
      OTT.toast('Added “' + title + '” to ' + OTT.catOf(key).name);
    };
    $('#cvok', dlg).onclick = ok;
    $('#cvt', dlg).addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
  }

  // ---------- print ----------
  function printDialog() {
    const c = cfg();
    const dlg = OTT.dialogs.open(`<header><h2>Print calendar</h2><p>${E(rangeLabel(months(c)))} · one landscape page</p><button class="dx" data-close>${ICON('x')}</button></header>
      <div class="dbody"><div class="irow"><label class="ctg"><input type="radio" name="cps" value="A3" ${c.months > 6 ? 'checked' : ''}> A3</label><label class="ctg"><input type="radio" name="cps" value="A4" ${c.months <= 6 ? 'checked' : ''}> A4</label></div>
      <p class="hint">Uses the months, filters and toggles shown now. The PDF is saved in the data folder (calendar\\) and opens so you can print it.</p></div>
      <footer><button data-close>Cancel</button><button class="primary" id="cpok">${ICON('pdf')} Make PDF</button></footer>`, 'small');
    $('#cpok', dlg).onclick = async () => {
      const size = ($('input[name="cps"]:checked', dlg) || {}).value || 'A3';
      OTT.dialogs.close();
      const r = await ott.calendarPdf(printHtml(size), { size, name: 'Calendar ' + c.start + ' (' + c.months + ' months) ' + size + '.pdf' });
      OTT.toast(r && r.ok ? 'Calendar PDF saved and opened' : 'PDF failed: ' + ((r && r.error) || '?'), r && r.ok ? '' : 'error', 5000);
    };
  }
  function printHtml(size) {
    const c = cfg();
    const g = grid(c, { print: true });
    const W = size === 'A4' ? 297 : 420, H = size === 'A4' ? 210 : 297, MG = 7;
    const fs = size === 'A4' ? (c.months > 8 ? 5.2 : 6.2) : (c.months > 8 ? 7 : 8.2);
    const usedCats = [...new Set(g.items.map(i => OTT.d(i.id).cat))].map(k => OTT.catOf(k));
    const legend = usedCats.map(x => `<span><i style="background:${x.color}"></i>${E(x.name)}</span>`).join('') +
      (g.sems.length ? '<span><i class="lteach"></i>DTU teaching</span><span><i class="lexam"></i>DTU exams</span>' : '') +
      '<span><i class="lhol"></i>Helligdag</span><span>⚑ deadline</span>' + (c.steps ? '<span><i class="lstep"></i>step</span>' : '');
    const now = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
      @page { size: ${size} landscape; margin: ${MG}mm; }
      * { box-sizing: border-box; }
      html, body { margin: 0; }
      body { width: ${W - 2 * MG}mm; height: ${H - 2 * MG}mm; font: ${fs}pt/1.15 "Segoe UI", sans-serif; color: #1d2228; display: flex; flex-direction: column; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .phead { display: flex; align-items: baseline; gap: 3mm; margin-bottom: 1.5mm; }
      .phead h1 { font-size: ${fs * 1.9}pt; margin: 0; } .phead span { color: #6b7380; }
      .plegend { display: flex; flex-wrap: wrap; gap: 1mm 4mm; margin-top: 1.5mm; color: #4a525c; }
      .plegend span { display: inline-flex; align-items: center; gap: 1mm; }
      .plegend i { display: inline-block; width: 3mm; height: 2.4mm; border-radius: .6mm; }
      .plegend .lteach { background: #cfe0ff; } .plegend .lexam { background: #e3d3ff; } .plegend .lhol { background: #fde2e2; border: .2mm solid #e5484d; } .plegend .lstep { border: .25mm dashed #6b7380; }
      ${PRINT_CSS}
    </style></head><body>
      <div class="phead"><h1>${E(rangeLabel(g.ms))}</h1><span>${E(M.getAppName())} · ${E(S.ed.title || '')} · printed ${E(now)}</span></div>
      ${g.html}
      <div class="plegend">${legend}</div>
    </body></html>`;
  }
  // print styles: a light, self-contained copy of the calendar CSS
  const PRINT_CSS = `
    .cgrid { flex: 1; display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); border: .3mm solid #9aa3ad; min-height: 0; }
    .cmon { display: flex; flex-direction: column; border-left: .2mm solid #9aa3ad; min-width: 0; }
    .cmon:first-child { border-left: 0; }
    .cmh { text-align: center; font-weight: 700; font-size: 1.5em; padding: .6mm 0; background: #e9ecf0; border-bottom: .3mm solid #9aa3ad; }
    .cmh small { font-weight: 400; font-size: .6em; color: #6b7380; }
    .cbody { position: relative; flex: 1; }
    .cdays { position: absolute; inset: 0; display: flex; flex-direction: column; }
    .cday { flex: 1; position: relative; display: flex; align-items: center; gap: .6mm; padding: 0 .8mm; border-bottom: .1mm solid #d5dae0; min-height: 0; overflow: hidden; }
    .cday.none { background: repeating-linear-gradient(135deg, #f3f4f6 0 1mm, #fff 1mm 2mm); }
    .cday.wd0, .cday.wd6 { background: #eceef1; }
    .cday.holiday { background: #fde8e8; } .cday.holiday .cwl, .cday.holiday .cdn { color: #c4161c; font-weight: 700; }
    .cday.off { background: #fdf0f0; } .cday.off .cdn { color: #c4161c; }
    .cwl { width: 1.1em; color: #6b7380; } .cdn { width: 1.3em; text-align: right; font-weight: 600; }
    .chn { position: absolute; left: 5.4em; right: 1.6mm; font-size: .72em; color: #7a828c; white-space: nowrap; overflow: hidden; }
    .cwk { position: absolute; right: .6mm; top: 0; font-size: .62em; color: #8a929c; }
    .csems { position: absolute; top: 0; bottom: 0; right: 0; width: .9mm; }
    .csem { position: absolute; left: 0; right: 0; background: #9dbdff; } .csem.k-exam { background: #b897f5; }
    .cevs { position: absolute; top: 0; bottom: 0; left: 3.1em; right: 1.2mm; }
    .cev { position: absolute; border-radius: .8mm; overflow: hidden; display: flex; align-items: center; justify-content: center; text-align: center; padding: 0 .5mm; line-height: 1.05; }
    .cev span { overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 6; overflow-wrap: break-word; hyphens: auto; }
    .cev.k-range { background: var(--c); color: var(--fg); font-weight: 700; }
    .cev.k-dl { background: color-mix(in srgb, var(--c) 22%, #fff); border-left: .7mm solid var(--c); justify-content: flex-start; text-align: left; font-weight: 600; }
    .cev.k-dl span, .cev.k-step span, .cev.short span { -webkit-line-clamp: 1; white-space: nowrap; text-overflow: ellipsis; display: block; }
    .cev.k-step { background: #fff; border: .2mm dashed var(--c); justify-content: flex-start; font-size: .85em; color: #4a525c; }
    .cev.over { color: #c4161c; }
    .cev.done { opacity: .45; } .cev.done span { text-decoration: line-through; }
    .cev.ct { border-top-left-radius: 0; border-top-right-radius: 0; } .cev.cb { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
  `;

  function scrollTo(id) { const el = box.querySelector(`.cev[data-id="${CSS.escape(id || '')}"]`); if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  function navigate(key) {
    const evs = [...box.querySelectorAll('.cev')];
    if (!evs.length) return;
    const i = evs.findIndex(x => x.dataset.id === S.sel);
    const j = key === 'ArrowDown' || key === 'ArrowRight' ? Math.min(evs.length - 1, i + 1) : Math.max(0, i - 1);
    selStep = evs[j].dataset.sid || null;
    C.select(evs[j].dataset.id);
  }
  OTT.views.calendar = { render, scrollTo, navigate, printHtml, hideCard };
})();
