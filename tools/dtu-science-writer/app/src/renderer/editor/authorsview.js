/* Author block in the editor: shows the formatted authors and affiliations; a click opens the
   Authors and affiliations dialog (command "authors", ui/authorsdialog.js). */
import { formatAuthors } from '../../core/authors.js';
import { styleOf } from '../../core/style.js';
import { runCommand } from '../context.js';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

class AuthorsView {
  constructor(node, view) {
    this.node = node; this.view = view;
    this.dom = document.createElement('div');
    this.dom.className = 'authors-block';
    this.dom.addEventListener('mousedown', (e) => { if (e.button === 0) { e.preventDefault(); runCommand('authors'); } });
    this.paint();
  }
  paint() {
    const fa = formatAuthors(this.node.attrs, styleOf(this.view.state.doc).affil);
    if (!fa.authors.length) {
      this.dom.innerHTML = '<span class="au-empty">Authors and affiliations</span><button class="au-edit" title="Edit authors and affiliations">👤 ✎</button>';
      return;
    }
    const names = fa.authors.map(a => esc(a.name) + (a.marks || a.corresponding ? '<sup>' + esc(a.marks + (a.corresponding ? (a.marks ? ',' : '') + '*' : '')) + '</sup>' : '')).join(', ');
    const affils = fa.affils.map(a => '<div class="au-affil"><sup>' + esc(a.mark) + '</sup>' + esc(a.text) + '</div>').join('')
      + fa.corresponding.filter(c => c.email).map(c => '<div class="au-affil"><sup>*</sup>Corresponding author: ' + esc(c.email) + '</div>').join('');
    this.dom.innerHTML = '<div class="au-names">' + names + '<button class="au-edit" title="Edit authors and affiliations">👤 ✎</button></div>' + affils;
  }
  update(node) { if (node.type !== this.node.type) return false; this.node = node; this.paint(); return true; }
  stopEvent() { return true; }
  ignoreMutation() { return true; }
}

export const authorsNodeView = { authors: (node, view) => new AuthorsView(node, view) };

/** Position and node of the author block. */
export function findAuthors(state) {
  let pos = null, node = null;
  state.doc.forEach((n, off) => { if (n.type.name === 'authors' && pos === null) { pos = off; node = n; } });
  return pos === null ? null : { pos, node };
}
