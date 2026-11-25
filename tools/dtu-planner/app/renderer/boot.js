/* One Todo Tree — top bar, status bar, boot. */
(function () {
  'use strict';
  const S = OTT.S, C = OTT.cmd, D = () => OTT.dialogs;

  // ---------- top bar ----------
  const VIEWS = [['map', 'map', 'Map'], ['tree', 'tree', 'Tree'], ['outline', 'outline', 'Outline'], ['matrix', 'matrix', 'Matrix'], ['calendar', 'cal', 'Calendar']];
  function setupTopbar() {
    $$('#views button').forEach(b => { const v = VIEWS.find(x => x[0] === b.dataset.view); b.innerHTML = ICON(v[1]) + '<span>' + v[2] + '</span>'; });
    $('#views').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) OTT.setView(b.dataset.view); });
    $('#searchIc').innerHTML = ICON('search');
    const s = $('#search');
    let t = null;
    s.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => OTT.runSearch(s.value), 120); });
    s.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (S.search !== s.value) OTT.runSearch(s.value); else OTT.nextHit(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { s.value = ''; OTT.runSearch(''); OTT.focusStage(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); OTT.nextHit(1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); OTT.nextHit(-1); }
    });
    const tools = [
      ['undo', 'undo', 'Undo (Ctrl+Z)', () => OTT.undo()],
      ['redo', 'redo', 'Redo (Ctrl+Y)', () => OTT.redoCmd()],
      ['sep'],
      ['links', 'link', 'Show links between related tasks', () => { S.showLinks = !S.showLinks; S.ui.links = S.showLinks; OTT.saveUiSoon(); OTT.render(); }],
      ['people', 'users', 'People', () => D().people()],
      ['sep'],
      ['history', 'history', 'History & restore', () => D().history()],
      ['trash', 'trash', 'Trash', () => D().trash()],
      ['settings', 'gear', 'Settings', () => D().settings()],
      ['theme', 'sun', 'Light / dark', cycleTheme],
      ['help', 'help', 'Keys & gestures', () => D().help()],
    ];
    $('#tools').innerHTML = tools.map(t => t[0] === 'sep' ? '<span class="tsep"></span>' : `<button class="tool" data-t="${t[0]}" title="${E(t[2])}">${ICON(t[1])}</button>`).join('');
    $('#tools').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) tools.find(t => t[0] === b.dataset.t)[3](); });
    $('#edsel').addEventListener('click', (e) => {
      const it = e.target.closest('[data-ed]');
      if (it) { $('#edsel').classList.remove('open'); if (it.dataset.ed === '+new') return D().newEdition(); if (it.dataset.ed === '+tpl') return D().saveTemplate(); if (it.dataset.ed === '+export') return D().exportBackup(); if (it.dataset.ed === '+import') return D().importBackup(); if (it.dataset.ed !== S.ed.id) OTT.loadEdition(it.dataset.ed); return; }
      if (e.target.closest('.edbtn')) $('#edsel').classList.toggle('open');
    });
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#edsel')) $('#edsel').classList.remove('open'); });
    $('#banner').addEventListener('click', (e) => { if (e.target.closest('[data-newest]')) OTT.loadEdition(S.editions[0].id); });
  }

  OTT.renderTopbar = () => {
    $$('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
    const newest = OTT.isNewest();
    const sig = JSON.stringify([S.ed.id, S.ed.title, S.editions.map(e => e.id + e.title)]);
    const el = $('#edsel');
    if (el.dataset.sig !== sig) {
      el.dataset.sig = sig;
      el.innerHTML = `<button class="edbtn" title="Switch edition"><span class="edt">${E(S.ed.title)}</span>${newest ? '' : '<span class="old">older</span>'}${ICON('chev', 'down')}</button>
        <div class="edmenu">${S.editions.map((e, i) => `<button data-ed="${E(e.id)}" class="${e.id === S.ed.id ? 'cur' : ''}"><span>${E(e.title)}</span><small>${i === 0 ? 'newest · ' : ''}${e.count} items</small></button>`).join('')}<hr><button data-ed="+new" class="new">${ICON('plus')} New edition…</button><button data-ed="+tpl" class="new">${ICON('tree')} Save structure as template…</button><hr><button data-ed="+export" class="new">${ICON('copy')} Export backup…</button><button data-ed="+import" class="new">${ICON('history')} Import backup…</button></div>`;
    }
    const ban = $('#banner');
    if (!newest) { ban.hidden = false; ban.innerHTML = `${ICON('history')} You are editing an older edition: <b>${E(S.ed.title)}</b>. Changes are saved to it. <button data-newest>Go to newest (${E(S.editions[0].title)})</button>`; }
    else ban.hidden = true;
    const tl = $('[data-t="links"]'); if (tl) tl.classList.toggle('on', S.showLinks);
    const tu = $('[data-t="undo"]'); if (tu) tu.disabled = !S.undo.length;
    const tr = $('[data-t="redo"]'); if (tr) tr.disabled = !S.redo.length;
    const tt = $('[data-t="trash"]'); if (tt) tt.dataset.count = S.ed.trash.length || '';
    const th = $('[data-t="theme"]'); if (th) { const m = S.ui.theme || 'system'; th.innerHTML = ICON(m === 'dark' ? 'moon' : 'sun') + (m === 'system' ? '<i class="auto">A</i>' : ''); th.title = 'Theme: ' + m + ' (click to change)'; }
  };

  async function cycleTheme() {
    const order = ['system', 'light', 'dark'];
    const cur = S.ui.theme || 'system';
    const next = order[(order.indexOf(cur) + 1) % 3];
    S.ui.theme = next; OTT.saveUiSoon();
    await ott.setTheme(next);
    OTT.toast('Theme: ' + next);
    OTT.render();
  }

  // ---------- status bar ----------
  OTT.renderStatus = () => {
    let open = 0, over = 0, week = 0, hot = 0, tasks = 0;
    for (const [id, d] of S.der) {
      if (!d.leaf) continue;
      tasks++;
      if (d.done) continue;
      open++;
      if (d.overdue) over++; else if (d.days != null && d.days <= 7) week++;
      if ((d.crit || 0) >= 3 && (d.urg || 0) >= 3) hot++;
    }
    const sb = $('#statusbar');
    sb.innerHTML = `<span><b>${open}</b> open of ${tasks}</span>` +
      (over ? `<button class="st bad" data-st="over"><b>${over}</b> overdue</button>` : '') +
      (week ? `<button class="st warn" data-st="week"><b>${week}</b> due ≤ 7 days</button>` : '') +
      (hot ? `<button class="st hot" data-st="hot"><b>${hot}</b> urgent &amp; critical</button>` : '') +
      `<span class="grow"></span><span class="legend"><i class="lg-ring"></i>progress ` +
      (S.settings && S.settings.nodeColors === 'frame'
        ? `<span class="lgt">critical</span><i class="lg-cf1"></i><i class="lg-cf2"></i><i class="lg-cf3"></i> <span class="lgt">urgent</span><i class="lg-uf1"></i><i class="lg-uf2"></i><i class="lg-uf3"></i> `
        : `<i class="lg-crit"></i>critical <i class="lg-u2"></i>urgent <i class="lg-u3"></i>very urgent `) +
      `<i class="lg-rel"></i>related</span>` +
      (S.linkFrom ? '<span class="linkhint">Linking: click a task…</span>' : '') +
      (S.pickTo ? `<span class="linkhint">${S.pickTo.copy ? 'Copy' : 'Move'} ${S.pickTo.ids.length} item${S.pickTo.ids.length > 1 ? 's' : ''}: click where they go… (Esc cancels)</span>` : '') +
      (S.multi.length > 1 && !S.pickTo ? `<span class="mselchip" title="Shift/Ctrl+click adds or removes items · Ctrl+C / Ctrl+X, select the target, Ctrl+V · drag to move, hold Ctrl to copy · right-click for Move to… / Copy to…"><b>${OTT.topIds(S.multi).length}</b> selected · Ctrl+C/X → Ctrl+V · drag (Ctrl = copy)<button class="st" data-st="mclear" title="Clear selection (Esc)">${ICON('x')}</button></span>` : '') +
      `<button class="st" data-st="pdf" title="Phone view (PDF in the data folder, read it in the Dropbox app)">${ICON('phone')}</button>`;
  };
  $('#statusbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-st]'); if (!b) return;
    const k = b.dataset.st;
    if (k === 'pdf') return ott.pdfOpen();
    if (k === 'mclear') return OTT.cmd.clearMulti();
    // jump to the first matching task
    const list = [];
    for (const [id, d] of S.der) {
      if (!d.leaf || d.done) continue;
      if (k === 'over' && d.overdue) list.push([id, d.days]);
      if (k === 'week' && !d.overdue && d.days != null && d.days <= 7) list.push([id, d.days]);
      if (k === 'hot' && (d.crit || 0) >= 3 && (d.urg || 0) >= 3) list.push([id, d.days == null ? 999 : d.days]);
    }
    list.sort((a, b) => a[1] - b[1]);
    if (!list.length) return;
    S.hits = list.map(x => x[0]); S.search = ' '; S.hitIdx = 0;
    $('#search').value = '';
    $('#searchCount').textContent = '1/' + list.length + ' (F3 next)';
    C.select(list[0][0], { reveal: true });
  });

  // hover / click on 📎 and 📝 symbols opens the pop-up in every view
  for (const sel of ['#mapwrap', '#outline', '#lens', '#matrix']) OTT.pop.wire($(sel));

  // ---------- side panel resize ----------
  (function lensGrip() {
    const grip = $('#lensgrip');
    let st = null;
    grip.addEventListener('pointerdown', (e) => { st = { x: e.clientX, w: $('#lens').getBoundingClientRect().width }; grip.setPointerCapture(e.pointerId); });
    grip.addEventListener('pointermove', (e) => {
      if (!st) return;
      const w = Math.max(380, st.w - (e.clientX - st.x));
      document.body.style.setProperty('--lensw', w + 'px');
    });
    grip.addEventListener('pointerup', () => { if (!st) return; st = null; S.ui.lensW = getComputedStyle(document.body).getPropertyValue('--lensw'); OTT.saveUiSoon(); OTT.views.map.fitSoon(); });
  })();

  // ---------- main-process events ----------
  ott.on('app:flush', async () => { try { await OTT.saveNow(); } finally { ott.flushed(); } });
  ott.on('app:select', async ({ edition, node }) => {
    if (edition && S.ed.id !== edition) await OTT.loadEdition(edition);
    if (S.ed.nodes[node]) C.select(node, { reveal: true });
  });
  ott.on('app:theme', () => OTT.render());
  ott.on('app:update', (info) => {
    // info: none = newer source (running from source); {version} = installer downloaded; {version, download} = portable copy
    const ub = $('#updatebar'), go = $('#upgo');
    if (ub.firstChild && ub.firstChild.nodeType === 3) ub.firstChild.nodeValue = info && info.version
      ? (info.download ? M.getAppName() + ' ' + info.version + ' is out. ' : M.getAppName() + ' ' + info.version + ' is ready to install. ')
      : 'A newer version of ' + M.getAppName() + ' is ready. ';
    go.textContent = info && info.download ? 'Download' : 'Restart now';
    go.dataset.download = (info && info.download) || '';
    ub.hidden = false;
  });
  $('#upgo').addEventListener('click', async () => {
    if ($('#upgo').dataset.download) { window.open($('#upgo').dataset.download); $('#updatebar').hidden = true; return; }
    $('#upgo').disabled = true; await OTT.saveNow(); ott.restart();
  });
  $('#uplater').addEventListener('click', () => { $('#updatebar').hidden = true; });

  // reload when another PC changed the edition and we have nothing unsaved
  let checking = false;
  window.addEventListener('focus', async () => {
    if (!S.ed || checking || S.dirtyEd || S.saveState === 'saving') return;
    checking = true;
    try {
      const r = await ott.checkEdition(S.ed.id);
      if (r && r.changed && !S.dirtyEd) {
        const sel = S.sel;
        await OTT.loadEdition(S.ed.id);
        if (S.ed.nodes[sel]) S.sel = sel;
        OTT.toast('Updated with changes made on another computer', 'info', 4000);
      }
      S.editions = await ott.listEditions();
      OTT.render();
    } finally { checking = false; }
  });
  window.addEventListener('blur', () => { OTT.saveNow(); });
  window.addEventListener('beforeunload', () => { OTT.saveNow(); });

  // ---------- boot ----------
  (async function boot() {
    setupTopbar();
    const b = await ott.boot();
    if (b.error) { document.body.innerHTML = '<p style="padding:40px">Could not start: ' + E(b.error) + '</p>'; return; }
    S.boot = b; S.settings = b.settings; S.people = b.people; S.editions = b.editions;
    if (b.appName && b.appName !== M.getAppName()) {   // flavour build, e.g. "DTU Planner"
      M.setAppName(b.appName);
      document.title = b.appName;
      const brand = document.querySelector('#titlebar .brand span'); if (brand) brand.textContent = b.appName;
      const ub = document.getElementById('updatebar'); if (ub && ub.firstChild && ub.firstChild.nodeType === 3) ub.firstChild.nodeValue = 'A newer version of ' + b.appName + ' is ready. ';
    }
    S.ui = b.ui || {};
    S.view = S.ui.view || 'map';
    S.inspectorOpen = S.ui.inspector !== false;
    S.showLinks = S.ui.links !== false;
    if (S.ui.lensW) document.body.style.setProperty('--lensw', S.ui.lensW);
    document.body.classList.toggle('test', !!b.test);
    const id = b.lastEdition && b.editions.some(e => e.id === b.lastEdition) ? b.lastEdition : b.editions[0].id;
    await OTT.loadEdition(id);
    OTT.setSaveState('saved');
    try {   // coming back from an import (the window was reloaded)
      const imp = JSON.parse(sessionStorage.getItem('ott-imported') || 'null');
      if (imp) { sessionStorage.removeItem('ott-imported'); OTT.toast('Imported ' + imp.n + ' edition' + (imp.n === 1 ? '' : 's') + (imp.people ? ', people' : '') + (imp.settings ? ', settings' : '') + '. The state before the import is in ' + imp.safety, 'info', 9000); }
    } catch (_) {}
    if (b.conflicts && b.conflicts.length) OTT.toast('Dropbox made conflicted copies in editions/: ' + b.conflicts.join(', ') + ' — nothing was lost; open the data folder to compare.', 'warn', 10000);
    OTT.focusStage();
  })();
})();
