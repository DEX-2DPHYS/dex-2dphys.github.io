/* Cross-reference picker (Ctrl+R): lists every section, figure, table and numbered equation; type to filter. */
import { numberingKey } from '../editor/plugins.js';
import { app, $ } from '../context.js';

const TYPE = { heading: 'Section', figure: 'Figure', equation: 'Equation', table_figure: 'Table' };

export function openRefPicker() {
  const view = app.view;
  const { nums } = numberingKey.getState(view.state);
  const items = [...nums.byId.entries()].map(([id, info]) => ({ id, ...info })).sort((a, b) => a.pos - b.pos);
  const dlg = $('#refpick'), list = $('#refpick-list'), input = $('#refpick-filter');
  let shown = [], active = 0;
  const render = () => {
    const q = input.value.trim().toLowerCase();
    shown = items.filter(it => !q || (it.ref + ' ' + it.snippet + ' ' + TYPE[it.type]).toLowerCase().includes(q));
    active = Math.min(active, Math.max(0, shown.length - 1));
    list.innerHTML = '';
    shown.forEach((it, i) => {
      const li = document.createElement('li');
      li.className = (i === active ? 'active ' : '') + 'rt-' + it.type;
      const a = document.createElement('b'); a.textContent = it.ref;
      const s = document.createElement('span'); s.textContent = it.type === 'equation' ? it.snippet : it.snippet || '(no caption yet)';
      li.append(a, s);
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });
      list.appendChild(li);
    });
    if (!shown.length) list.innerHTML = '<li class="none">Nothing to refer to yet — add a section, figure or numbered equation first.</li>';
  };
  const close = () => { dlg.hidden = true; input.onkeydown = null; input.oninput = null; dlg.onmousedown = null; dlg.onkeydown = null; view.focus(); };
  // a click outside the box, the Close button, or Esc wherever the focus is: closed without inserting anything
  dlg.onmousedown = (e) => { if (e.target === dlg) { e.preventDefault(); close(); } };
  dlg.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  $('#refpick-close').onclick = close;
  const choose = (i) => {
    const it = shown[i];
    close();
    if (!it) return;
    view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodes.xref.create({ target: it.id }), false).scrollIntoView());
  };
  input.value = '';
  input.oninput = () => { active = 0; render(); };
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, shown.length - 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { choose(active); e.preventDefault(); }
    else if (e.key === 'Escape') { close(); e.preventDefault(); }
  };
  dlg.hidden = false;
  render();
  input.focus();
}

export const isRefPickerOpen = () => !$('#refpick').hidden;
