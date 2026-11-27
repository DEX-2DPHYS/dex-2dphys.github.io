/* Editor setup: state, keymaps, commands. */
import { EditorState, TextSelection, NodeSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { history, undo, redo } from 'prosemirror-history';
import { baseKeymap, toggleMark, setBlockType, chainCommands, exitCode } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { splitListItem, liftListItem, sinkListItem, wrapInList } from 'prosemirror-schema-list';
import { schema } from '../../core/schema.js';
import { idPlugin, numberingPlugin, trailingParagraph, buildInputRules } from './plugins.js';
import { missingIds } from '../../core/numbering.js';
import { mathNodeViews, insertMath } from './mathview.js';
import { figureBarPlugin, imageDropPlugin, imageNodeView, figureAnnotationsPlugin } from './figures.js';
import { tablePlugins, tableKeymap } from './tables.js';
import { commentsPlugin } from './comments.js';
import { authorsNodeView } from './authorsview.js';
import { citationsPlugin, citationNodeViews } from './citations.js';
import { structureNodeViews, insertPageBreak } from './structure.js';
import { latexPastePlugin } from './latexpaste.js';
import { trackPlugin, trackDispatch } from './track.js';
import { pageViewPlugin } from './pageview.js';
import { siHeaderPlugin } from './siheader.js';
import { migrateAuthorsJson } from '../../core/authors.js';
import { templateDoc, DEFAULT_TEMPLATE } from '../../core/templates.js';

export { schema };

// the Article template (core/templates.js): what a fresh start opens on
export const NEW_DOC = templateDoc(DEFAULT_TEMPLATE);

const M = schema.marks, N = schema.nodes;

export const cmd = {
  bold: toggleMark(M.bold), italic: toggleMark(M.italic), underline: toggleMark(M.underline),
  sup: toggleMark(M.sup), sub: toggleMark(M.sub),
  highlight: toggleMark(M.highlight, { color: 'yellow' }),
  colorRed: textColor('C00000'), colorBlue: textColor('1F5FBF'), colorGreen: textColor('2E7D32'), colorNone: textColor(null),
  removeHighlight: (state, dispatch) => { const { from, to, empty } = state.selection; if (empty) return false; if (dispatch) dispatch(state.tr.removeMark(from, to, M.highlight)); return true; },
  paragraph: setBlockType(N.paragraph),
  h1: setBlockType(N.heading, { level: 1 }), h2: setBlockType(N.heading, { level: 2 }), h3: setBlockType(N.heading, { level: 3 }), h4: setBlockType(N.heading, { level: 4 }),
  bullets: wrapInList(N.bullet_list), numbers: wrapInList(N.ordered_list),
  inlineMath: insertMath(false), equation: insertMath(true),
  undo, redo,
};

/** Text colour of the selection (hex 'RRGGBB'), or automatic (null). */
function textColor(hex) {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty) return false;
    if (dispatch) { let tr = state.tr.removeMark(from, to, M.color); if (hex) tr = tr.addMark(from, to, M.color.create({ color: hex })); dispatch(tr); }
    return true;
  };
}

/** Toggle numbering of the heading or equation at the selection. */
export function toggleNumbered(state, dispatch) {
  const sel = state.selection;
  let pos = null, node = null;
  if (sel instanceof NodeSelection && sel.node.type === N.equation) { pos = sel.from; node = sel.node; }
  else if (sel.$from.parent.type === N.heading) { pos = sel.$from.before(sel.$from.depth); node = sel.$from.parent; }
  if (!node) return false;
  if (dispatch) dispatch(state.tr.setNodeMarkup(pos, null, { ...node.attrs, numbered: !node.attrs.numbered }));
  return true;
}

/** Enter in a caption leaves it: figure caption -> paragraph after the figure (created if needed),
    table caption -> first cell of the table. A caption cannot be split, so Enter would otherwise do nothing. */
function exitCaption(state, dispatch) {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type !== N.caption || $from.depth < 2) return false;
  const holder = $from.node($from.depth - 1);
  if (!dispatch) return true;
  let tr = state.tr;
  if (holder.type.name === 'table_figure') {
    const tableStart = $from.after($from.depth);              // after the caption = start of the table
    tr.setSelection(TextSelection.near(tr.doc.resolve(tableStart + 4)));
  } else {
    const after = $from.after($from.depth - 1);
    const next = tr.doc.resolve(after).nodeAfter;
    if (!next || next.type !== N.paragraph) tr = tr.insert(after, N.paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
  }
  dispatch(tr.scrollIntoView());
  return true;
}

function keys() {
  return {
    'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo,
    'Mod-b': cmd.bold, 'Mod-i': cmd.italic, 'Mod-u': cmd.underline, 'Mod-Shift-h': cmd.highlight,
    'Mod-Shift-=': cmd.sup, 'Mod-Shift-+': cmd.sup, 'Mod-=': cmd.sub,
    'Mod-m': cmd.inlineMath, 'Mod-Shift-m': cmd.equation, 'Mod-Shift-M': cmd.equation,
    'Mod-Alt-0': cmd.paragraph, 'Mod-Alt-1': cmd.h1, 'Mod-Alt-2': cmd.h2, 'Mod-Alt-3': cmd.h3, 'Mod-Alt-4': cmd.h4,
    'Shift-Enter': chainCommands(exitCode, (state, dispatch) => { if (dispatch) dispatch(state.tr.replaceSelectionWith(N.hard_break.create()).scrollIntoView()); return true; }),
    Enter: chainCommands(exitCaption, splitListItem(N.list_item)),
    'Mod-Enter': insertPageBreak,                                   // as in Word
    Tab: sinkListItem(N.list_item), 'Shift-Tab': liftListItem(N.list_item),
  };
}

export function createState(json) {
  json = json || NEW_DOC;
  // documents from before 2026-11-26 kept the author line as text
  if (json.content) json = { ...json, content: json.content.map(migrateAuthorsJson) };
  const doc = schema.nodeFromJSON(json);
  doc.check();
  let state = EditorState.create({
    doc,
    plugins: [
      buildInputRules(schema),
      tableKeymap, keymap(keys()), keymap(baseKeymap),
      history(), dropCursor({ color: '#1f6feb' }), gapCursor(),
      idPlugin, trailingParagraph, numberingPlugin, figureBarPlugin(), figureAnnotationsPlugin, imageDropPlugin(), latexPastePlugin, ...tablePlugins(), commentsPlugin, citationsPlugin, trackPlugin, pageViewPlugin, siHeaderPlugin,
    ],
  });
  const fixes = missingIds(state.doc);
  if (fixes.length) {
    const tr = state.tr;
    for (const f of fixes) tr.setNodeAttribute(f.pos, 'id', f.id);
    state = state.apply(tr.setMeta('addToHistory', false));
  }
  return state;
}

/** editable(): false while the document is read-only (someone else has it open). */
export function createView(mount, state, onChange, editable = () => true, user = () => null) {
  const view = new EditorView(mount, {
    state,
    editable: () => editable(),
    nodeViews: { ...mathNodeViews, ...imageNodeView, ...authorsNodeView, ...citationNodeViews, ...structureNodeViews },
    dispatchTransaction(tr) {
      // read-only: every change passes here (typing, toolbar, dialogs), so this one check covers them all
      // (shared comments are the exception: core/commentops.js, doc/sharedcomments.js)
      if (tr.docChanged && !editable() && !tr.getMeta('commentOnly')) return;
      // track changes: with tracking on, the edit becomes a suggestion (editor/track.js)
      tr = trackDispatch(tr, view.state, user());
      const ns = view.state.apply(tr);
      view.updateState(ns);
      onChange(tr, ns);
    },
    attributes: { spellcheck: 'true', class: 'doc' },
  });
  return view;
}

export function placeCursorAtEnd(view) {
  const tr = view.state.tr.setSelection(TextSelection.atEnd(view.state.doc));
  view.dispatch(tr);
}
