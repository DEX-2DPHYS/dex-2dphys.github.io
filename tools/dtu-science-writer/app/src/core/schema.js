/* DTU Science Writer — document model (ProseMirror schema). See DESIGN.md §6.
   The model stores what things are, never how they look. Every node here has a mapping
   in typst.js and docx.js; do not add a node without adding both. */
import { Schema } from 'prosemirror-model';
import { colorFor } from './track.js';
import { tableNodes } from 'prosemirror-tables';
import { mediaUrl } from './media.js';

const idAttr = { default: null };

/* Track changes (track.js): the flag on a block — the paragraph boundary in front of a text block was inserted or
   deleted, or a whole unit (equation, figure, table, …) was. Text carries the marks ins / del instead. */
const trackAttr = { default: null };
const trackDom = (tag, cls) => (m) => [tag, { class: 'tc ' + cls, 'data-tc': m.attrs.id, 'data-author': m.attrs.author, title: (cls === 'tc-ins' ? 'Inserted by ' : 'Deleted by ') + (m.attrs.author || 'unknown'), style: '--tc:' + colorFor(m.attrs.author) }, 0];
const trackMark = (tag, cls) => ({ attrs: { id: {}, author: { default: '' }, initials: { default: '' }, time: { default: '' } }, inclusive: false, toDOM: trackDom(tag, cls) });

export const nodes = {
  // attrs.style: document style (fonts, sizes, heading formatting) — see style.js
  // attrs.comments: comment threads { [id]: thread } — see comments.js; anchors are `comment` marks and equation.comments
  // part: 'main', or 'si' for the Supplementary Information exported on its own (parts.js); the editor's document holds
  // both, the SI as the optional last node 'supplement'
  doc: { content: 'title authors abstract? block+ supplement?', attrs: { style: { default: null }, comments: { default: {} }, references: { default: {} }, part: { default: 'main' }, tracking: { default: false }, partLabel: { default: '' }, partAuthors: { default: null } } },   // partLabel / partAuthors: the header of a supplementary document (parts.js)   // tracking: track changes is on (track.js)   // references: key -> CSL item (references.js)

  title: {
    content: 'inline*', marks: 'italic sub sup ins del', defining: true,
    parseDOM: [{ tag: 'h1.title' }],
    toDOM: () => ['h1', { class: 'title' }, 0],
  },
  /* Authors and affiliations (structured, edited in a dialog; see authors.js):
     list:   [{ name, affils: [affiliation id], corresponding, email }]
     affils: [{ id, dept, inst, street, postcode, city, country }] */
  authors: {
    atom: true, selectable: true, draggable: false,
    attrs: { list: { default: [] }, affils: { default: [] } },
    parseDOM: [{ tag: 'div.authors', getAttrs: (d) => { try { return JSON.parse(d.getAttribute('data-authors') || '{}'); } catch (_) { return {}; } } }],
    toDOM: (n) => ['div', { class: 'authors', 'data-authors': JSON.stringify({ list: n.attrs.list, affils: n.attrs.affils }) }],
  },
  abstract: {
    content: 'paragraph+', defining: true,
    parseDOM: [{ tag: 'section.abstract' }],
    toDOM: () => ['section', { class: 'abstract' }, 0],
  },

  /* Supplementary Information: the second part of the paper (its own tab in the editor, its own PDF / Word file).
     Figures, tables, equations and sections in it are numbered S1, S2, … (numbering.js). */
  supplement: {
    content: 'block+', defining: true, isolating: true,
    // title: the name of the part. lock: its header is the paper's own title and authors (the standard); not locked:
    // freeTitle / freeAuthors are typed for it (an empty one is left out)
    attrs: { title: { default: 'Supplementary Information' }, lock: { default: true }, freeTitle: { default: '' }, freeAuthors: { default: '' } },
    parseDOM: [{ tag: 'section.supplement', getAttrs: (d) => ({ title: d.getAttribute('data-title') || 'Supplementary Information' }) }],
    toDOM: (n) => ['section', { class: 'supplement', 'data-title': n.attrs.title }, 0],
  },

  /* The reference list (formatted by citeproc); placed where the author wants it. */
  bibliography: {
    group: 'block', atom: true, selectable: true,
    attrs: { title: { default: 'References' }, track: trackAttr },
    parseDOM: [{ tag: 'section.bibliography', getAttrs: (d) => ({ title: d.getAttribute('data-title') || 'References' }) }],
    toDOM: (n) => ['section', { class: 'bibliography', 'data-title': n.attrs.title }],
  },
  paragraph: {
    group: 'block', content: 'inline*', attrs: { track: trackAttr },
    parseDOM: [{ tag: 'p' }],
    toDOM: () => ['p', 0],
  },
  heading: {
    group: 'block', content: 'inline*', defining: true,
    // appendix: on a level-1 heading, the appendix starts here — top-level sections after it are A, B, … (numbering.js)
    attrs: { level: { default: 1 }, numbered: { default: true }, id: idAttr, appendix: { default: false }, track: trackAttr },
    parseDOM: [1, 2, 3, 4].map(level => ({ tag: 'h' + (level + 1), getAttrs: (d) => ({ level, numbered: !d.classList.contains('unnumbered'), id: d.getAttribute('data-id'), appendix: d.classList.contains('appendix-start') }) })),
    toDOM: (n) => ['h' + (n.attrs.level + 1), { 'data-id': n.attrs.id, class: [n.attrs.numbered ? '' : 'unnumbered', n.attrs.appendix ? 'appendix-start' : ''].join(' ').trim() || null }, 0],
  },

  /* Table of contents, list of figures or list of tables (kind), kept up to date from the document. */
  outline: {
    group: 'block', atom: true, selectable: true,
    attrs: { kind: { default: 'contents' }, title: { default: null }, track: trackAttr },
    parseDOM: [{ tag: 'div.outline', getAttrs: (d) => ({ kind: d.getAttribute('data-kind') || 'contents', title: d.getAttribute('data-title') || null }) }],
    toDOM: (n) => ['div', { class: 'outline', 'data-kind': n.attrs.kind, 'data-title': n.attrs.title }],
  },
  /* A forced page break (Ctrl+Enter). */
  page_break: {
    group: 'block', atom: true, selectable: true, attrs: { track: trackAttr },
    parseDOM: [{ tag: 'hr.page-break' }], toDOM: () => ['hr', { class: 'page-break' }],
  },

  bullet_list: {
    group: 'block', content: 'list_item+',
    parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0],
  },
  ordered_list: {
    group: 'block', content: 'list_item+', attrs: { order: { default: 1 } },
    parseDOM: [{ tag: 'ol', getAttrs: (d) => ({ order: +(d.getAttribute('start') || 1) }) }],
    toDOM: (n) => ['ol', n.attrs.order === 1 ? {} : { start: n.attrs.order }, 0],
  },
  list_item: {
    content: 'paragraph (paragraph | bullet_list | ordered_list)*', defining: true,
    parseDOM: [{ tag: 'li' }], toDOM: () => ['li', 0],
  },

  /* Display equation. latex = MathLive LaTeX. Rendered by a node view (mathview.js). */
  equation: {
    group: 'block', atom: true, selectable: true, draggable: false,
    attrs: { latex: { default: '' }, numbered: { default: true }, id: idAttr, comments: { default: [] }, track: trackAttr },   // comments: thread ids on the whole equation
    parseDOM: [{ tag: 'div.equation', getAttrs: (d) => ({ latex: d.getAttribute('data-latex') || '', numbered: d.getAttribute('data-numbered') !== 'false', id: d.getAttribute('data-id') }) }],
    toDOM: (n) => ['div', { class: 'equation', 'data-latex': n.attrs.latex, 'data-numbered': String(n.attrs.numbered), 'data-id': n.attrs.id }],
  },

  /* Figure: one image + caption. placement: float | here | wrap.
     float uses pos (top | bottom); wrap uses side (left | right). width = fraction of text width. */
  figure: {
    group: 'block', content: 'image caption', defining: true, isolating: true, draggable: true,
    // comments: thread ids anchored to the figure as a whole (comment boxes); annotations: review marks drawn on the
    // image (core/annotations.js) — neither is printed in the PDF
    attrs: { placement: { default: 'float' }, pos: { default: 'top' }, side: { default: 'right' }, width: { default: 0.8 }, id: idAttr, track: trackAttr, comments: { default: [] }, annotations: { default: [] } },
    parseDOM: [{ tag: 'figure', getAttrs: (d) => ({ placement: d.getAttribute('data-placement') || 'float', pos: d.getAttribute('data-pos') || 'top', side: d.getAttribute('data-side') || 'right', width: +(d.getAttribute('data-width') || 0.8), id: d.getAttribute('data-id') }) }],
    toDOM: (n) => ['figure', {
      class: 'fig fig-' + n.attrs.placement + (n.attrs.placement === 'wrap' ? ' wrap-' + n.attrs.side : ''),
      'data-placement': n.attrs.placement, 'data-pos': n.attrs.pos, 'data-side': n.attrs.side,
      'data-width': String(n.attrs.width), 'data-id': n.attrs.id,
      style: '--w:' + Math.round(n.attrs.width * 100) + '%',
    }, 0],
  },
  image: {
    atom: true, selectable: true, draggable: false,
    attrs: { src: { default: '' }, w: { default: 0 }, h: { default: 0 } },
    parseDOM: [{ tag: 'img', getAttrs: (d) => ({ src: d.getAttribute('data-src') || '', w: +(d.getAttribute('data-w') || 0), h: +(d.getAttribute('data-h') || 0) }) }],
    toDOM: (n) => ['div', { class: 'figimg' }, ['img', { src: mediaUrl(n.attrs.src), 'data-src': n.attrs.src, 'data-w': n.attrs.w, 'data-h': n.attrs.h, draggable: 'false' }]],
  },
  caption: {
    content: 'inline*', defining: true,
    parseDOM: [{ tag: 'figcaption' }],
    toDOM: () => ['figcaption', 0],
  },

  /* Numbered table: caption above, then the table. placement: float (pos top|bottom) | here. */
  table_figure: {
    group: 'block', content: 'caption table', defining: true, isolating: true,
    attrs: { placement: { default: 'here' }, pos: { default: 'top' }, id: idAttr, track: trackAttr },
    parseDOM: [{ tag: 'div.tablefig', getAttrs: (d) => ({ placement: d.getAttribute('data-placement') || 'here', pos: d.getAttribute('data-pos') || 'top', id: d.getAttribute('data-id') }) }],
    toDOM: (n) => ['div', { class: 'tablefig tablefig-' + n.attrs.placement, 'data-placement': n.attrs.placement, 'data-pos': n.attrs.pos, 'data-id': n.attrs.id }, 0],
  },
  ...tableNodes({
    tableGroup: '',          // tables live inside table_figure only (pasted tables are wrapped, see tables.js)
    cellContent: 'paragraph+',
    cellAttributes: {
      align: {
        default: null,
        getFromDOM: (d) => (['left', 'center', 'right'].includes(d.style.textAlign) ? d.style.textAlign : null),
        setDOMAttr: (v, attrs) => { if (v) attrs.style = (attrs.style || '') + 'text-align:' + v + ';'; },
      },
    },
  }),

  text: { group: 'inline' },

  math_inline: {
    group: 'inline', inline: true, atom: true, selectable: true,
    attrs: { latex: { default: '' } },
    parseDOM: [{ tag: 'span.math-inline', getAttrs: (d) => ({ latex: d.getAttribute('data-latex') || '' }) }],
    toDOM: (n) => ['span', { class: 'math-inline', 'data-latex': n.attrs.latex }],
  },
  /* Cross-reference to a heading, figure or equation id. Its text ("Fig. 3") is drawn by numbering decorations. */
  xref: {
    group: 'inline', inline: true, atom: true, selectable: true,
    attrs: { target: { default: '' } },
    parseDOM: [{ tag: 'span.xref', getAttrs: (d) => ({ target: d.getAttribute('data-target') || '' }) }],
    toDOM: (n) => ['span', { class: 'xref', 'data-target': n.attrs.target }],
  },
  /* Citation of one or more library items: items [{ id, locator }], mode 'normal' | 'suppress-author'.
     Its text comes from citeproc (references.js), drawn by a node view. */
  citation: {
    group: 'inline', inline: true, atom: true, selectable: true,
    attrs: { items: { default: [] }, mode: { default: 'normal' } },
    parseDOM: [{ tag: 'span.citation', getAttrs: (d) => { try { return { items: JSON.parse(d.getAttribute('data-items') || '[]'), mode: d.getAttribute('data-mode') || 'normal' }; } catch (_) { return false; } } }],
    toDOM: (n) => ['span', { class: 'citation', 'data-items': JSON.stringify(n.attrs.items), 'data-mode': n.attrs.mode }],
  },
  /* A footnote: its text lives inside the node (edited in a small pop-up editor); numbered automatically. */
  footnote: {
    group: 'inline', inline: true, atom: true, selectable: true, draggable: false,
    content: '(text | math_inline | citation | xref | hard_break)*',
    parseDOM: [{ tag: 'span.footnote' }],
    toDOM: () => ['span', { class: 'footnote' }, 0],
  },
  hard_break: {
    group: 'inline', inline: true, selectable: false,
    parseDOM: [{ tag: 'br' }], toDOM: () => ['br'],
  },
};

export const marks = {
  bold: {
    parseDOM: [{ tag: 'strong' }, { tag: 'b', getAttrs: (d) => d.style.fontWeight !== 'normal' && null }, { style: 'font-weight', getAttrs: (v) => /^(bold(er)?|[6-9]\d{2})$/.test(v) && null }],
    toDOM: () => ['strong', 0],
  },
  italic: {
    parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
    toDOM: () => ['em', 0],
  },
  underline: {
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration', getAttrs: (v) => /underline/.test(v) && null }],
    toDOM: () => ['u', 0],
  },
  /* Highlight (color: one of Word's highlighter names, HIGHLIGHT) and text colour (color: 'RRGGBB'). They come in from
     Word — a revised manuscript or a response letter marks its changes so — and go out to PDF, Word and LaTeX. */
  highlight: {
    attrs: { color: { default: 'yellow' } },
    parseDOM: [{ tag: 'mark', getAttrs: (d) => ({ color: HIGHLIGHT[d.getAttribute('data-color')] ? d.getAttribute('data-color') : 'yellow' }) }],
    toDOM: (m) => ['mark', { class: 'hl', 'data-color': m.attrs.color, style: 'background:#' + highlightHex(m.attrs.color) }, 0],
  },
  color: {
    attrs: { color: { default: 'C00000' } },
    parseDOM: [{ tag: 'span.fgc', getAttrs: (d) => ({ color: /^[0-9A-F]{6}$/i.test(d.getAttribute('data-color') || '') ? d.getAttribute('data-color').toUpperCase() : 'C00000' }) }],
    toDOM: (m) => ['span', { class: 'fgc', 'data-color': m.attrs.color, style: 'color:#' + m.attrs.color }, 0],
  },
  sup: { excludes: 'sub', parseDOM: [{ tag: 'sup' }], toDOM: () => ['sup', 0] },
  sub: { excludes: 'sup', parseDOM: [{ tag: 'sub' }], toDOM: () => ['sub', 0] },
  /* Anchor of a comment thread (comments.js). Several may overlap; typing next to one does not extend it. */
  comment: {
    attrs: { id: {} }, inclusive: false, excludes: '',
    parseDOM: [{ tag: 'span.cmt', getAttrs: (d) => ({ id: d.getAttribute('data-cmt') }) }],
    toDOM: (m) => ['span', { class: 'cmt', 'data-cmt': m.attrs.id }, 0],
  },
  /* Tracked insertion / deletion (track.js). No parseDOM: pasted or copied text is ordinary text again. */
  ins: trackMark('ins', 'tc-ins'),
  del: trackMark('del', 'tc-del'),
};

export const schema = new Schema({ nodes, marks });

/** Word's highlighter colours (w:highlight values) and their RGB. */
export const HIGHLIGHT = { yellow: 'FFFF00', green: '00FF00', cyan: '00FFFF', magenta: 'FF00FF', blue: '0000FF', red: 'FF0000',
  darkBlue: '000080', darkCyan: '008080', darkGreen: '008000', darkMagenta: '800080', darkRed: '800000', darkYellow: '808000',
  darkGray: '808080', lightGray: 'C0C0C0', black: '000000', white: 'FFFFFF' };
export function highlightHex(name) { return HIGHLIGHT[name] || HIGHLIGHT.yellow; }

/** Node types that carry a referenceable id. */
export const LABELLED = new Set(['heading', 'figure', 'equation', 'table_figure']);
