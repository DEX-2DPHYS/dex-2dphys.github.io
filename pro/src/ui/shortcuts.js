// Hold K anywhere (Peter, 2026-10-01): a card with the keys and mouse gestures of the tab in use,
// shown while K is held down and gone when it is released. Keep this list in step with the
// handlers (layout/editor.js keydown, exposure/exposuretab.js, fab/, psf/).

const K = (...keys) => keys.map((k) => `<kbd>${k}</kbd>`).join('+');

const SHEETS = {
  layout: ['Pattern Studio', [
    ['Tools', [
      [`${K('1')} ${K('2')} ${K('3')} ${K('4')} ${K('5')}`, 'Select · Rectangle · Circle · Polygon · Device area'],
      [K('Esc'), 'back to Select; cancels what is being drawn'],
      [K('Enter') + ' · double-click', 'close a polygon drawn corner by corner'],
    ]],
    ['Select & edit', [
      ['click · ' + K('Shift') + '+click', 'select · add to / remove from the selection'],
      ['drag empty space (Select) · right-drag', 'rubber-band selection (any tool with right-drag)'],
      ['drag a shape · its edge in a drawing tool', 'move the selection (snap: its upper-left corner lands on the grid)'],
      ['corner handles · handle above', 'resize / reshape · rotate (' + K('Shift') + ' snaps 15°)'],
      ['double-click', 'exact size & rotation (shape) · properties (array)'],
      [`${K('Del')} · ${K('Ctrl', 'D')} · arrows`, 'delete · duplicate · nudge one grid step (' + K('Shift') + ' = ten)'],
      [`${K('Ctrl', 'A')} · ${K('Ctrl', 'Z')} · ${K('Ctrl', 'Y')}`, 'select all · undo · redo'],
      [`${K('Ctrl', 'C')} · ${K('Ctrl', 'X')} · ${K('Ctrl', 'V')}`, 'copy · cut · paste in place, onto the active layer (cut, pick a layer, paste = move to that layer)'],
      ['Array… → dose ramp', 'dose steps along x and/or y, linear or log (a dose test); click a step selects the ramp'],
    ]],
    ['View', [
      ['wheel · hold ' + K('Space') + ' + drag, ' + K('Alt') + '+drag, middle-drag', 'zoom at the pointer · pan'],
      [`${K('F')} · ${K('R')} · ${K('G')}`, 'fit view · reset view · snap to grid on/off'],
      ['Controls? button', 'the full list with explanations'],
    ]],
  ]],
  psf: ['PSF', [
    ['Plots', [
      ['hover the log–log plot', 'f(r) and the energy fraction within r'],
      ['Keep for comparison', 'overlay up to three PSFs'],
    ]],
    ['Monte Carlo', [
      ['Run · Stop', 'the result so far is kept on Stop'],
      ['Run settings and physics', 'electrons, tail error, cut-off, physics model, threads, seed'],
    ]],
  ]],
  exposure: ['Exposure', [
    ['Map', [
      ['hold ' + K('L') + ' + drag', 'draw a new cut-line (' + K('Shift') + ' snaps to 0/45/90°) — or ✎ Cut-line, then drag'],
      ['drag the round / square handles', 'move a cut-line end / the whole line'],
      ['drag · wheel', 'pan · zoom at the pointer'],
      ['hover', 'designed and delivered dose at the pointer'],
    ]],
    ['3D view', [
      ['left-drag · right- or ' + K('Shift') + '-drag · wheel', 'rotate · pan · zoom'],
      ['↻ on a greyed view', 'recalculate (nothing recomputes on its own unless "follow the map" is on)'],
    ]],
  ]],
  fab: ['Fab Studio', [
    ['Process flow', [
      ['click a step', 'load it into the form to edit (Apply edit replays the rest)'],
      ['hover a step: ▲ ▼ ＋ ✕', 'move · insert a new step after it · delete'],
      ['Expanded / Compact', 'cards with thumbnails and parameters · one line per step'],
      ['Ctrl+Z · Ctrl+Y', 'undo · redo the last step of the flow (also the buttons beside Run step and under the flow)'],
    ]],
    ['Views', [
      ['cross-section: wheel · drag · Fit width', 'zoom horizontally · pan · reset'],
      ['3D: drag · wheel · height ×', 'rotate · zoom · vertical exaggeration (scale bar shows it)'],
      ['↻ on a greyed view', 'rebuild and replay after the layout or PSF changed'],
    ]],
  ]],
};
const GLOBAL = ['Everywhere', [
  ['hold ' + K('K'), 'this card'],
  ['hover a ? marker', 'what a setting means'],
  ['Save · Open… · New · Demo', 'project file (layout, PSF, Monte Carlo result, Fab recipe) — autosaved in the browser too'],
]];

export function installShortcutCard(app) {
  const el = document.createElement('div');
  el.id = 'kbdCard';
  el.style.display = 'none';
  document.body.appendChild(el);
  const section = ([title, rows]) => `<h4>${title}</h4><table>${rows.map(([k, d]) => `<tr><td>${k}</td><td>${d}</td></tr>`).join('')}</table>`;
  let shown = false;
  const show = () => {
    const sheet = SHEETS[app.tab] || ['', []];
    el.innerHTML = `<div class="kbd-card"><div class="kbd-head"><b>${sheet[0]}</b> — shortcuts <span>release K to close</span></div>
      <div class="kbd-cols"><div>${sheet[1].map(section).join('')}</div><div>${section(GLOBAL)}</div></div></div>`;
    el.style.display = 'flex'; shown = true;
  };
  const hide = () => { if (shown) { el.style.display = 'none'; shown = false; } };
  const typing = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName || '') || e.target?.isContentEditable;
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'k' || e.key === 'K') && !typing(e) && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); if (!shown) show(); }
  });
  window.addEventListener('keyup', (e) => { if (e.key === 'k' || e.key === 'K') hide(); });
  window.addEventListener('blur', hide);
  return { show, hide };
}
