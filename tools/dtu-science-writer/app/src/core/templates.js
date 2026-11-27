/* Built-in document templates for File → New (ui/templatedialog.js). A template is an ordinary document (JSON for the
   schema) plus, optionally, a partial document style (style.js fills in the rest). Article is the default and is the
   document a fresh start opens on. The user's own templates are .dtusw files in the settings folder (main/ipc.js). */

const t = (text) => (text ? [{ type: 'text', text }] : undefined);
const p = (text) => ({ type: 'paragraph', content: t(text) });
const h = (level, text, numbered = true, extra = {}) => ({ type: 'heading', attrs: { level, numbered, ...extra }, content: t(text) });
const title = { type: 'title' };
const authors = { type: 'authors', attrs: { list: [], affils: [] } };
const abstract = { type: 'abstract', content: [p()] };
const bullets = (n) => ({ type: 'bullet_list', content: Array.from({ length: n }, () => ({ type: 'list_item', content: [p()] })) });
const outline = (kind) => ({ type: 'outline', attrs: { kind } });
const pageBreak = { type: 'page_break' };
/** Numbered sections, each with an empty paragraph to write in. */
const sections = (...names) => names.flatMap(n => [h(1, n), p()]);
const doc = (content, style = null) => ({ type: 'doc', attrs: { style }, content });

const UNNUMBERED = { num: 'none' };

export const TEMPLATES = [
  { id: 'article', name: 'Article', desc: 'Title, authors, abstract, numbered sections',
    doc: doc([title, authors, abstract, h(1, 'Introduction'), p()]) },

  { id: 'lecture', name: 'Lecture notes', desc: 'Learning objectives, sections, summary and exercises',
    doc: doc([title, authors,
      h(1, 'Learning objectives', false), p('After this lecture you can'), bullets(3),
      ...sections('Introduction', 'Theory', 'Worked example', 'Summary', 'Exercises')],
    { figLabel: 'Figure', h1: { delta: 2, bold: true, italic: false, color: '#990000', num: '1' } }) },

  { id: 'thesis', name: 'Thesis', desc: 'Front matter, contents, chapters, appendix',
    doc: doc([title, authors, abstract,
      h(1, 'Resumé', false), p(),
      h(1, 'Preface', false), p(),
      h(1, 'Acknowledgements', false), p(),
      pageBreak, outline('contents'), outline('figures'), pageBreak,
      ...sections('Introduction', 'Background', 'Methods', 'Results', 'Discussion', 'Conclusion and outlook'),
      h(1, 'Additional data', true, { appendix: true }), p()],
    { size: 12, spacing: 1.5, titleAlign: 'center', figLabel: 'Figure', title: { delta: 10, bold: true, italic: false, color: '#000000' }, h1: { delta: 6, bold: true, italic: false, color: '#000000', num: '1' } }) },

  { id: 'report', name: 'Report', desc: 'Summary, contents and the usual sections',
    doc: doc([title, authors,
      h(1, 'Summary', false), p(),
      outline('contents'),
      ...sections('Introduction', 'Methods', 'Results', 'Discussion', 'Conclusion')],
    { figLabel: 'Figure' }) },

  { id: 'notes', name: 'Notes', desc: 'A title and free text, headings without numbers',
    doc: doc([title, authors, p()],
    { h1: UNNUMBERED, h2: UNNUMBERED, h3: UNNUMBERED, h4: UNNUMBERED }) },

  { id: 'proposal', name: 'Proposal', desc: 'Summary, objectives, work plan, impact',
    doc: doc([title, authors,
      h(1, 'Summary', false), p(),
      ...sections('Background and state of the art', 'Objectives'),
      h(1, 'Research plan and methods'), p(), h(2, 'Work package 1'), p(), h(2, 'Work package 2'), p(),
      ...sections('Milestones and time plan', 'Risks and mitigation', 'Impact', 'Team and collaborators')],
    { font: 'arial', figLabel: 'Figure' }) },

  { id: 'blank', name: 'Blank', desc: 'Nothing but an empty page',
    doc: doc([title, authors, p()]) },
];

export const DEFAULT_TEMPLATE = 'article';

/** A fresh copy of a built-in template's document (the editor may change what it is given). */
export function templateDoc(id) {
  const tpl = TEMPLATES.find(x => x.id === id) || TEMPLATES.find(x => x.id === DEFAULT_TEMPLATE);
  return JSON.parse(JSON.stringify(tpl.doc));
}
