/* Tables: insert picker, table bar, keyboard, paste (Excel/Word tables, tab-separated text).
   Editing engine: prosemirror-tables (cell selection, merge/split, column resizing, normalisation). */
import { Plugin, TextSelection } from 'prosemirror-state';
import { ctxHost, refreshHint } from '../ui/ctxbar.js';
import { Slice, Fragment } from 'prosemirror-model';
import { keymap } from 'prosemirror-keymap';
import {
  tableEditing, columnResizing, goToNextCell, addRowAfter, addRowBefore, addColumnAfter, addColumnBefore,
  deleteRow, deleteColumn, mergeCells, splitCell, toggleHeaderRow, toggleHeaderColumn, isInTable, selectedRect,
  moveTableRow, moveTableColumn,
} from 'prosemirror-tables';
import { blockInsertPos } from './mathview.js';

/* ---------- helpers ---------- */
export function tableFigureAt(state) {
  const $f = state.selection.$from;
  for (let d = $f.depth; d > 0; d--) if ($f.node(d).type.name === 'table_figure') return { pos: $f.before(d), node: $f.node(d), depth: d };
  return null;
}

function makeTable(schema, rows, cols, header = true, data = null) {
  const N = schema.nodes;
  const cell = (type, text) => type.create(null, N.paragraph.create(null, text ? schema.text(text) : null));
  const out = [];
  for (let r = 0; r < rows; r++) {
    const cells = [];
    for (let c = 0; c < cols; c++) {
      const text = data && data[r] ? (data[r][c] || '').trim() : '';
      cells.push(cell(header && r === 0 ? N.table_header : N.table_cell, text));
    }
    out.push(N.table_row.create(null, cells));
  }
  return N.table.create(null, out);
}

export function tableFigure(schema, table) {
  return schema.nodes.table_figure.create({ placement: 'here' }, [schema.nodes.caption.create(), table]);
}

/** Insert a rows × cols table (first row = header) and put the cursor in its first cell. */
export function insertTable(view, rows, cols, data) {
  const { schema } = view.state;
  const tf = tableFigure(schema, makeTable(schema, rows, cols, true, data));
  let tr = view.state.tr;
  const at = blockInsertPos(view.state, (p) => { tr = tr.split(p); });
  tr = tr.insert(at, tf);
  // at → table_figure(+1) → caption → table(+1) → row(+1) → cell(+1) → paragraph(+1)
  const firstCell = at + 1 + tf.firstChild.nodeSize + 4;
  tr.setSelection(TextSelection.create(tr.doc, firstCell));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** Set the alignment of every cell in the selected columns. */
export function alignColumns(align) {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    if (dispatch) {
      const rect = selectedRect(state);
      const tr = state.tr;
      const done = new Set();
      for (let r = 0; r < rect.map.height; r++) {
        for (let c = rect.left; c < rect.right; c++) {
          const off = rect.map.map[r * rect.map.width + c];
          if (done.has(off)) continue;
          done.add(off);
          const cell = rect.table.nodeAt(off);
          if (cell.attrs.align !== align) tr.setNodeMarkup(rect.tableStart + off, null, { ...cell.attrs, align });
        }
      }
      dispatch(tr);
    }
    return true;
  };
}

export function deleteTableFigure(state, dispatch) {
  const tf = tableFigureAt(state);
  if (!tf) return false;
  if (dispatch) {
    const tr = state.tr.delete(tf.pos, tf.pos + tf.node.nodeSize);
    const $p = tr.doc.resolve(Math.min(tf.pos, tr.doc.content.size));
    tr.setSelection(TextSelection.findFrom($p, -1, true) || TextSelection.near($p));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

function setPlacement(attrs) {
  return (state, dispatch) => {
    const tf = tableFigureAt(state);
    if (!tf) return false;
    if (dispatch) dispatch(state.tr.setNodeMarkup(tf.pos, null, { ...tf.node.attrs, ...attrs }));
    return true;
  };
}

/** Move the selected row/column one step (prosemirror-tables' move commands take explicit indices). */
function move(kind, dir) {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    const rect = selectedRect(state);
    if (kind === 'row') {
      const from = rect.top, to = dir < 0 ? rect.top - 1 : rect.bottom;
      if (to < 0 || to >= rect.map.height) return false;
      return moveTableRow({ from, to })(state, dispatch);
    }
    const from = rect.left, to = dir < 0 ? rect.left - 1 : rect.right;
    if (to < 0 || to >= rect.map.width) return false;
    return moveTableColumn({ from, to })(state, dispatch);
  };
}

export const tableCmd = {
  rowAbove: addRowBefore, rowBelow: addRowAfter, colLeft: addColumnBefore, colRight: addColumnAfter,
  delRow: deleteRow, delCol: deleteColumn, merge: mergeCells, split: splitCell,
  headerRow: toggleHeaderRow, headerCol: toggleHeaderColumn,
  alignLeft: alignColumns('left'), alignCenter: alignColumns('center'), alignRight: alignColumns('right'),
  rowUp: move('row', -1), rowDown: move('row', 1), colLeftMove: move('col', -1), colRightMove: move('col', 1),
  here: setPlacement({ placement: 'here' }), top: setPlacement({ placement: 'float', pos: 'top' }), bottom: setPlacement({ placement: 'float', pos: 'bottom' }),
  deleteTable: deleteTableFigure,
};

/* ---------- keyboard: Tab / Shift-Tab between cells, Tab in the last cell adds a row ---------- */
export const tableKeymap = keymap({
  Tab: (state, dispatch, view) => {
    if (!isInTable(state)) return false;
    if (goToNextCell(1)(state, dispatch)) return true;
    if (!dispatch || !view) return true;
    addRowAfter(state, dispatch);                          // last cell: add a row and move into it
    goToNextCell(1)(view.state, view.dispatch);
    return true;
  },
  'Shift-Tab': (state, dispatch) => (isInTable(state) ? (goToNextCell(-1)(state, dispatch), true) : false),
});

/* ---------- paste ---------- */
function wrapPastedTables(slice, view) {
  if (isInTable(view.state)) return slice;            // pasting cells into a table: prosemirror-tables handles it
  let changed = false;
  const kids = [];
  slice.content.forEach((n) => {
    if (n.type.name === 'table') { kids.push(tableFigure(view.state.schema, n)); changed = true; } else kids.push(n);
  });
  return changed ? new Slice(Fragment.from(kids), 0, 0) : slice;
}

function pasteTabSeparated(view, e) {
  const cd = e.clipboardData;
  if (!cd || isInTable(view.state)) return false;
  const html = cd.getData('text/html');
  if (html && /<table/i.test(html)) return false;      // a real table: parsed by the schema
  const text = cd.getData('text/plain');
  if (!text || !text.includes('\t')) return false;
  const lines = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n');
  if (lines.length < 2 && lines[0].split('\t').length < 2) return false;
  const data = lines.map(l => l.split('\t'));
  const cols = Math.max(...data.map(r => r.length));
  insertTable(view, data.length, cols, data);
  return true;
}

/* ---------- insert picker (grid under the toolbar button) ---------- */
export function openTablePicker(view, anchor) {
  let pop = document.querySelector('#tablepick');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'tablepick';
    document.body.appendChild(pop);
  }
  const R = 10, C = 8;
  pop.innerHTML = '<div class="tp-grid"></div><div class="tp-label">Insert table</div>';
  const grid = pop.querySelector('.tp-grid'), lab = pop.querySelector('.tp-label');
  for (let r = 1; r <= R; r++) for (let c = 1; c <= C; c++) {
    const d = document.createElement('div');
    d.dataset.r = r; d.dataset.c = c;
    grid.appendChild(d);
  }
  const mark = (r, c) => {
    for (const d of grid.children) d.classList.toggle('on', +d.dataset.r <= r && +d.dataset.c <= c);
    lab.textContent = r && c ? r + ' × ' + c + ' (first row = header)' : 'Insert table';
  };
  grid.addEventListener('mouseover', (e) => { const d = e.target; if (d.dataset.r) mark(+d.dataset.r, +d.dataset.c); });
  grid.addEventListener('mousedown', (e) => e.preventDefault());
  grid.addEventListener('click', (e) => { const d = e.target; if (!d.dataset.r) return; close(); insertTable(view, +d.dataset.r, +d.dataset.c); });
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, r.left) + 'px';
  pop.style.top = (r.bottom + 4) + 'px';
  pop.hidden = false;
  const close = () => { pop.hidden = true; document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', esc, true); };
  const outside = (e) => { if (!pop.contains(e.target) && e.target !== anchor) close(); };
  const esc = (e) => { if (e.key === 'Escape') { close(); view.focus(); } };
  setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', esc, true); }, 0);
}

/* ---------- table bar ---------- */
const BAR = [
  ['Rows', [['rowAbove', '+ above', 'Insert a row above'], ['rowBelow', '+ below', 'Insert a row below'], ['delRow', '✕', 'Delete row(s)'], ['rowUp', '↑', 'Move row up'], ['rowDown', '↓', 'Move row down']]],
  ['Columns', [['colLeft', '+ left', 'Insert a column to the left'], ['colRight', '+ right', 'Insert a column to the right'], ['delCol', '✕', 'Delete column(s)'], ['colLeftMove', '←', 'Move column left'], ['colRightMove', '→', 'Move column right']]],
  ['Cells', [['merge', 'Merge', 'Merge the selected cells (drag across cells to select)'], ['split', 'Split', 'Split a merged cell'], ['headerRow', 'Header row', 'First row as header (bold, rule below, repeats on new pages)'], ['headerCol', 'Header col', 'First column as header']]],
  ['Align', [['alignLeft', '⯇', 'Align column(s) left'], ['alignCenter', '≡', 'Centre column(s)'], ['alignRight', '⯈', 'Align column(s) right']]],
  ['Place', [['here', 'Here', 'Here in the text'], ['top', 'Top', 'Top of page'], ['bottom', 'Bottom', 'Bottom of page']]],
  ['', [['deleteTable', 'Delete table', 'Delete the whole table with its caption']]],
];

export function tableBarPlugin() {
  return new Plugin({
    view(editorView) {
      const bar = document.createElement('div');
      bar.className = 'tablebar';
      bar.style.display = 'none';
      bar.classList.add('ctx-panel');
      bar.addEventListener('mousedown', (e) => e.preventDefault());
      const buttons = [];
      for (const [title, items] of BAR) {
        const g = document.createElement('div');
        g.className = 'tb-group';
        if (title) { const t = document.createElement('span'); t.className = 'tb-title'; t.textContent = title; g.appendChild(t); }
        for (const [key, label, tip] of items) {
          const b = document.createElement('button');
          b.textContent = label; b.title = tip; b.dataset.cmd = key;
          if (key === 'deleteTable') b.className = 'danger';
          b.addEventListener('click', () => { tableCmd[key](editorView.state, editorView.dispatch); editorView.focus(); });
          g.appendChild(b);
          buttons.push(b);
        }
        bar.appendChild(g);
      }
      ctxHost().appendChild(bar);   // context row under the toolbar: never covers the text
      const update = (view) => {
        setTimeout(refreshHint, 0);
        const tf = tableFigureAt(view.state);
        if (!tf || !view.editable) { bar.style.display = 'none'; return; }
        const dom = view.nodeDOM(tf.pos);
        if (!dom || !dom.getBoundingClientRect) { bar.style.display = 'none'; return; }
        bar.style.display = '';
        const inTable = isInTable(view.state);
        for (const b of buttons) {
          const k = b.dataset.cmd;
          const placementKey = k === 'here' || k === 'top' || k === 'bottom' || k === 'deleteTable';
          b.disabled = !placementKey && (!inTable || !tableCmd[k](view.state));
          if (placementKey && k !== 'deleteTable') {
            const a = tf.node.attrs;
            b.classList.toggle('on', k === 'here' ? a.placement === 'here' : a.placement === 'float' && a.pos === k);
          }
        }
      };
      update(editorView);
      return { update, destroy: () => bar.remove() };
    },
  });
}

export function tablePlugins() {
  return [
    // small default minimum: columns size to their content, like the printed (Typst) table
    columnResizing({ cellMinWidth: 36, defaultCellMinWidth: 36, handleWidth: 5 }),
    tableEditing(),
    tableBarPlugin(),
    new Plugin({ props: { transformPasted: wrapPastedTables, handlePaste: pasteTabSeparated } }),
  ];
}
