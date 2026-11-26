/* Paste LaTeX (step 5): plain text that looks like LaTeX source becomes document content — sections, equations,
   citations, cross-references, lists, footnotes … (core/latexin.js). Ctrl+Shift+V pastes the plain text unchanged. */
import { Plugin } from 'prosemirror-state';
import { Slice, Fragment } from 'prosemirror-model';
import { latexToBlocks, looksLikeLatex } from '../../core/latexin.js';
import { libraryOf } from '../../core/references.js';
import { toast } from '../context.js';

let plainUntil = 0;           // Ctrl+Shift+V was pressed: this paste is plain text

/** The document content for a LaTeX text, as a Slice to insert at the selection; null when it cannot be used. */
export function latexSlice(state, text) {
  const ids = [];
  state.doc.descendants((n) => { if (n.attrs && n.attrs.id) ids.push(n.attrs.id); return true; });
  const { blocks, report } = latexToBlocks(text, { library: libraryOf(state.doc), existingIds: ids });
  if (!blocks.length) return null;
  const missingFiles = blocks.filter(b => b.missingFile).map(b => b.missingFile);
  let nodes;
  try { nodes = blocks.map(({ missingFile, ...b }) => state.schema.nodeFromJSON(b)); nodes.forEach(n => n.check()); } catch (e) { console.warn('latex paste', e); return null; }
  // a snippet pasted into a sentence keeps the spaces at its edges (the converter trims block ends)
  if (nodes.length === 1 && nodes[0].type.name === 'paragraph') {
    const lead = /^[ \t]/.test(text) ? [state.schema.text(' ')] : [], tail = /[ \t]$/.test(text) ? [state.schema.text(' ')] : [];
    if (lead.length || tail.length) nodes[0] = nodes[0].copy(Fragment.fromArray([...lead, ...nodes[0].content.content, ...tail]));
  }
  // one paragraph goes into the current one; otherwise the first and last paragraphs join the text around them
  const open = (n) => (n.type.name === 'paragraph' ? 1 : 0);
  const slice = new Slice(Fragment.fromArray(nodes), open(nodes[0]), open(nodes[nodes.length - 1]));
  return { slice, report: { ...report, missingFiles, blocks: blocks.length } };
}

function summary(r) {
  const parts = ['Pasted LaTeX as formatted text'];
  const notes = [];
  if (r.unknownKeys.length) notes.push('not in the reference library (left as text): ' + r.unknownKeys.join(', '));
  if (r.unknownRefs.length) notes.push('unknown labels: ' + r.unknownRefs.join(', '));
  if (r.missingFiles.length) notes.push('figures need their images (Insert → Figure or drop them in): ' + r.missingFiles.join(', '));
  return parts[0] + (notes.length ? ' — ' + notes.join('; ') : '') + '. Ctrl+Z, then Ctrl+Shift+V pastes the plain text.';
}

export const latexPastePlugin = new Plugin({
  props: {
    handleKeyDown(_view, e) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'V' || e.key === 'v')) plainUntil = Date.now() + 1500;
      return false;
    },
    handlePaste(view, e) {
      if (Date.now() < plainUntil) { plainUntil = 0; return false; }
      const cd = e.clipboardData;
      if (!cd) return false;
      const text = cd.getData('text/plain'), html = cd.getData('text/html');
      // formatted text from a web page or Word is pasted as such; LaTeX source arrives as plain text (Overleaf, editors)
      if (!text || !looksLikeLatex(text) || (html && /<(p|h[1-6]|table|li)\b/i.test(html))) return false;
      const r = latexSlice(view.state, text);
      if (!r) return false;
      view.dispatch(view.state.tr.replaceSelection(r.slice).scrollIntoView());
      toast(summary(r.report), r.report.unknownKeys.length || r.report.unknownRefs.length || r.report.missingFiles.length ? 'error' : undefined);
      return true;
    },
  },
});
