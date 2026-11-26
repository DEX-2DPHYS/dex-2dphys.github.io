/* Math node views: equations are shown typeset; selecting one opens a MathLive editor in place.
   The LaTeX is written back to the document when the editor closes (one undo step per edit). */
import { MathfieldElement, convertLatexToMarkup } from 'mathlive';
import { LATEX_ALIASES, expandAliases } from '../../core/mathconv.js';
import { NodeSelection, TextSelection } from 'prosemirror-state';

MathfieldElement.fontsDirectory = './mathlive/fonts';
MathfieldElement.soundsDirectory = null;

export const mathState = { open: null };   // the MathView currently editing (for the toolbar's keyboard toggle)
/** 'open' / 'close' when an equation editor opens or closes (ui/eqtools.js shows its palettes). */
export const mathEvents = new EventTarget();

/* Writing modes inside an equation (as in Word's equation editor): bold (vectors, \mathbf), upright
   (italic off: units, labels, d, e, i — \mathrm) and text (words with spaces — \text). With a selection
   they change it; without, they apply to what is typed next. */
export const MATH_MODES = {
  bold: { label: 'Bold', key: 'b', title: 'Bold, for vectors and matrices (Ctrl+B)' },
  up: { label: 'Upright', key: 'i', title: 'Italic off: upright letters for units, labels, d, e, i (Ctrl+I)' },
  text: { label: 'Text', key: 't', title: 'Plain text with spaces, e.g. “for all”, “if” (Ctrl+T)' },
};
export function mathModeOn(f, mode) {
  try {
    if (mode === 'text') return f.mode === 'text';
    return f.queryStyle({ variantStyle: mode === 'bold' ? 'bold' : 'up' }) === 'all';
  } catch (_) { return false; }
}
export function toggleMathMode(f, mode) {
  if (mode === 'text') f.executeCommand(['switchMode', f.mode === 'text' ? 'math' : 'text']);
  else f.applyStyle({ variantStyle: mode === 'bold' ? 'bold' : 'up' }, { operation: 'toggle' });
  f.focus();
  mathEvents.dispatchEvent(new Event('mode'));
}

function staticMarkup(latex, display) {
  if (!latex.trim()) return '<span class="math-empty">' + (display ? 'empty equation' : '▫') + '</span>';
  try { return convertLatexToMarkup(expandAliases(latex), { defaultMode: display ? 'math' : 'inline-math' }); } catch (e) { return '<span class="math-error">' + latex.replace(/</g, '&lt;') + '</span>'; }
}

class MathView {
  constructor(node, view, getPos, display, decorations) {
    this.node = node; this.view = view; this.getPos = getPos; this.display = display;
    this.dom = document.createElement(display ? 'div' : 'span');
    this.dom.className = display ? 'equation' : 'math-inline';
    this.render = document.createElement(display ? 'div' : 'span');
    this.render.className = 'math-render';
    this.dom.appendChild(this.render);
    if (display) { this.numEl = document.createElement('span'); this.numEl.className = 'eq-num'; this.dom.appendChild(this.numEl); }
    this.field = null;
    this.paint();
    this.update(node, decorations);
  }

  paint() { this.render.innerHTML = staticMarkup(this.node.attrs.latex, this.display); }

  update(node, decorations) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (!this.field) this.paint();
    if (this.numEl) {
      const d = decorations && decorations.find(x => x.spec && x.spec.eqNum !== undefined);
      this.setNumber(d ? d.spec.eqNum : null);
    }
    return true;
  }

  setNumber(n) { if (this.numEl) this.numEl.textContent = n ? '(' + n + ')' : ''; }

  selectNode() { this.dom.classList.add('selected'); this.open(); }
  deselectNode() { this.dom.classList.remove('selected'); this.close(false); }

  open() {
    if (this.field) return;
    const f = new MathfieldElement();
    f.value = this.node.attrs.latex;
    f.mathVirtualKeyboardPolicy = 'manual';
    f.smartFence = true;
    f.smartSuperscript = true;
    f.mathModeSpace = '\\,';
    f.className = 'math-field';
    f.defaultMode = this.display ? 'math' : 'inline-math';
    f.addEventListener('change', () => this.leave('after'));
    f.addEventListener('move-out', (e) => { e.preventDefault(); const d = e.detail && e.detail.direction; this.leave(d === 'backward' || d === 'upward' ? 'before' : 'after'); });
    f.addEventListener('selection-change', () => mathEvents.dispatchEvent(new Event('mode')));
    f.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.leave('after'); }
      const mode = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && Object.keys(MATH_MODES).find(m => MATH_MODES[m].key === e.key.toLowerCase());
      if (mode) { e.preventDefault(); e.stopPropagation(); toggleMathMode(f, mode); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'y')) e.stopPropagation();
    }, true);
    f.addEventListener('focusout', () => { setTimeout(() => { if (this.field && !this.field.hasFocus()) this.close(true); }, 0); });
    this.field = f;
    this.render.style.display = 'none';
    this.dom.insertBefore(f, this.render);
    // \dots etc. (amsmath; core/mathconv.js LATEX_ALIASES). MathLive's macros can only be read once the field is in the
    // page; the value is set again so it is parsed with them
    try { f.macros = { ...f.macros, ...LATEX_ALIASES }; f.value = this.node.attrs.latex; } catch (e) { console.warn('math macros', e); }
    mathState.open = this;
    mathEvents.dispatchEvent(new Event('open'));
    // cursor at the end (not everything selected), so typing or a palette button adds to the equation
    setTimeout(() => { f.focus(); try { f.executeCommand('moveToMathfieldEnd'); } catch (_) {} }, 0);
  }

  /** Close the editor and write the LaTeX back. where: 'before' | 'after' | null (keep selection). */
  close(commit, where) {
    const f = this.field;
    if (!f) return;
    this.field = null;
    if (mathState.open === this) { mathState.open = null; mathEvents.dispatchEvent(new Event('close')); }
    const latex = f.value;
    f.remove();
    if (window.mathVirtualKeyboard && window.mathVirtualKeyboard.visible) window.mathVirtualKeyboard.hide();
    this.render.style.display = '';
    if (!commit) { this.paint(); return; }
    const pos = this.getPos();
    if (pos == null) return;
    const view = this.view;
    let tr = view.state.tr;
    if (!latex.trim()) {
      tr = tr.delete(pos, pos + this.node.nodeSize);
      const $p = tr.doc.resolve(Math.min(pos, tr.doc.content.size));
      tr.setSelection(TextSelection.findFrom($p, -1, true) || TextSelection.findFrom($p, 1, true) || TextSelection.near($p));
    } else {
      if (latex !== this.node.attrs.latex) tr = tr.setNodeMarkup(pos, null, { ...this.node.attrs, latex });
      if (where) {
        let p = where === 'before' ? pos : pos + this.node.nodeSize;
        // a display equation with no text after it: add an empty paragraph, otherwise the cursor has nowhere
        // to go and the equation stays selected (the next keystroke would replace it)
        if (this.display && where === 'after') {
          const next = tr.doc.resolve(p).nodeAfter;
          if (!next || !next.isTextblock) { tr = tr.insert(p, view.state.schema.nodes.paragraph.create()); p += 1; }
        }
        const sel = TextSelection.findFrom(tr.doc.resolve(p), where === 'before' ? -1 : 1, true) || TextSelection.near(tr.doc.resolve(p));
        tr.setSelection(sel);
      }
    }
    if (tr.docChanged || where) view.dispatch(tr.scrollIntoView());
    this.paint();
  }

  leave(where) { this.close(true, where); this.view.focus(); }

  stopEvent(e) { return !!(this.field && (e.target === this.field || this.field.contains(e.target))); }
  ignoreMutation() { return true; }
  destroy() { if (this.field) { this.field.remove(); this.field = null; } if (mathState.open === this) { mathState.open = null; mathEvents.dispatchEvent(new Event('close')); } }
}

export const mathNodeViews = {
  math_inline: (node, view, getPos, decos) => new MathView(node, view, getPos, false, decos),
  equation: (node, view, getPos, decos) => new MathView(node, view, getPos, true, decos),
};

const HEADER = new Set(['title', 'authors', 'abstract']);

/** The depth at which the blocks of the part around $pos sit: 1 in the manuscript, 2 in the Supporting Information. */
export function blockDepth($pos) {
  return $pos.depth >= 1 && $pos.node(1).type.name === 'supplement' ? 2 : 1;
}

/** Where a new top-level block goes for the current cursor: between the halves of a split paragraph,
    before an empty-start paragraph, else after the current top-level block (never inside the title block).
    split(pos) is called when the paragraph must be split; the returned position is valid after it. */
export function blockInsertPos(state, split) {
  const { $from } = state.selection;
  const doc = state.doc;
  if ($from.depth === 0) return $from.pos;
  // inside the Supporting Information the blocks are one level down: the same rules, one level deeper
  const d = blockDepth($from);
  if (d === 2) {
    const blk = $from.node(2);
    if ($from.depth === 2 && blk.type.name === 'paragraph' && state.selection.empty) {
      if ($from.parentOffset > 0 && $from.parentOffset < blk.content.size) { split($from.pos); return $from.pos + 1; }
      if ($from.parentOffset === 0 && blk.content.size) return $from.before(2);
    }
    return $from.depth >= 2 ? $from.after(2) : $from.pos;
  }
  const top = $from.node(1);
  if (HEADER.has(top.type.name)) {
    let pos = 0;
    for (let i = 0; i < doc.childCount; i++) { const c = doc.child(i); if (!HEADER.has(c.type.name)) return pos; pos += c.nodeSize; }
    return pos;
  }
  if ($from.depth === 1 && top.type.name === 'paragraph' && state.selection.empty) {
    if ($from.parentOffset > 0 && $from.parentOffset < top.content.size) { split($from.pos); return $from.pos + 1; }
    if ($from.parentOffset === 0 && top.content.size) return $from.before(1);
  }
  return $from.after(1);
}

/** Insert inline math (or display equation) at the cursor and open its editor. */
export function insertMath(display, latex = '') {
  return (state, dispatch) => {
    const type = display ? state.schema.nodes.equation : state.schema.nodes.math_inline;
    if (!dispatch) return true;
    const node = type.create({ latex });
    let tr = state.tr;
    if (display) {
      const at = blockInsertPos(state, (p) => { tr = tr.split(p); });
      tr = tr.insert(at, node);
      tr.setSelection(NodeSelection.create(tr.doc, at));
    } else {
      tr = tr.replaceSelectionWith(node, false);
      const pos = tr.selection.from - node.nodeSize;
      tr.setSelection(NodeSelection.create(tr.doc, pos));
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}
