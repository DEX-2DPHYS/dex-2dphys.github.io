/* Help → Tutorial: a short paper to practise in. Each section explains one thing in a sentence and asks you to try it
   ("Try it: …"). It already holds what there is to look at: an equation, a figure, a table, a citation, a comment
   and two tracked changes by "A colleague", and a Supporting Information tab. Nothing is saved unless you save it. */
import { addImage, imageSize } from '../core/media.js';

async function plot() {
  const c = document.createElement('canvas');
  c.width = 900; c.height = 480;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 480);
  g.strokeStyle = '#222'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(90, 40); g.lineTo(90, 410); g.lineTo(860, 410); g.stroke();
  g.fillStyle = '#222'; g.font = '26px serif';
  g.fillText('time (s)', 760, 450);
  g.save(); g.translate(50, 150); g.rotate(-Math.PI / 2); g.fillText('signal', 0, 0); g.restore();
  for (const [col, ph] of [['#1f4e9c', 0], ['#b8312f', 1.3]]) {
    g.strokeStyle = col; g.lineWidth = 3; g.beginPath();
    for (let i = 0; i <= 400; i++) {
      const x = 90 + 770 * i / 400, y = 225 - 150 * Math.exp(-i / 260) * Math.sin(i / 22 + ph);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

const T = (text, ...marks) => ({ type: 'text', text, ...(marks.length ? { marks } : {}) });
const B = { type: 'bold' }, I = { type: 'italic' };
const P = (...c) => ({ type: 'paragraph', content: c });
const TRY = (...c) => P(T('Try it: ', B), ...c);
const H = (id, text, level = 1) => ({ type: 'heading', attrs: { level, numbered: true, id, appendix: false }, content: [T(text)] });
const M = (latex) => ({ type: 'math_inline', attrs: { latex } });
const X = (target) => ({ type: 'xref', attrs: { target } });
const CELL = (t, type = 'table_cell') => ({ type, attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null }, content: [P(T(t))] });

export async function buildTutorial() {
  const name = addImage('tutorial-plot.png', await plot());
  const size = await imageSize(name);
  const when = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const colleague = { id: 't-tut1', author: 'A colleague', initials: 'AC', time: when };
  const colleague2 = { id: 't-tut2', author: 'A colleague', initials: 'AC', time: when };
  const INS = (a) => ({ type: 'ins', attrs: a }), DEL = (a) => ({ type: 'del', attrs: a });
  const references = {
    novoselov2004: { id: 'novoselov2004', type: 'article-journal', title: 'Electric field effect in atomically thin carbon films', author: [{ family: 'Novoselov', given: 'K. S.' }, { family: 'Geim', given: 'A. K.' }, { family: 'Morozov', given: 'S. V.' }, { family: 'Jiang', given: 'D.' }, { family: 'Zhang', given: 'Y.' }, { family: 'Dubonos', given: 'S. V.' }, { family: 'Grigorieva', given: 'I. V.' }, { family: 'Firsov', given: 'A. A.' }], 'container-title': 'Science', volume: '306', page: '666-669', issued: { 'date-parts': [[2004]] }, DOI: '10.1126/science.1102896' },
  };
  const comments = { 'c-tut1': { id: 'c-tut1', author: 'A colleague', initials: 'AC', time: when, text: 'This is a comment. Reply to it, or press ✓ Resolve on this card.', resolved: false, replies: [] } };
  return {
    type: 'doc', attrs: { references, comments, tracking: false },
    content: [
      { type: 'title', content: [T('A ten-minute tour of DTU Science Writer')] },
      { type: 'authors', attrs: { list: [{ name: 'Your Name', affils: ['af-t1'], corresponding: true, email: 'you@example.org' }], affils: [{ id: 'af-t1', dept: 'Your department', inst: 'Your university', street: '', postcode: '', city: 'City', country: 'Country' }] } },
      { type: 'abstract', content: [P(T('This is a paper to practise in. Each section explains one thing in a sentence and asks you to try it. The pages on the right are the exact PDF. Nothing here is saved unless you save it, so try everything. The guide (F1) lists all of it by topic.'))] },

      H('tut-1', 'Writing'),
      P(T('Type as in any text program. The box at the left of the toolbar sets the kind of line: body text or a heading. Sections number themselves.')),
      TRY(T('click the author line above and put in your own name. Then put the cursor in this paragraph, press '), T('End', I), T(' and '), T('Enter', I), T(', and choose “Heading 2” in the style box.')),

      H('tut-2', 'Equations'),
      P(T('An equation in the text, such as '), M('E = mc^2'), T(', is made with Ctrl+M (or by typing dollar signs around it). One on its own line, with a number, is made with Ctrl+Shift+M:')),
      { type: 'equation', attrs: { id: 'tut-eq1', latex: 'x(t) = A\\,e^{-t/\\tau}\\sin(\\omega t + \\varphi)', numbered: true, comments: [] } },
      TRY(T('double-click the equation above and change '), M('\\tau'), T(' to '), M('\\tau_0'), T(' — type an underscore for the subscript, then press Enter. Then make a new equation of your own with Ctrl+Shift+M and type '), T('a^2+b^2=c^2', I), T('.')),

      H('tut-3', 'Figures, tables and references to them'),
      P(T('A figure is inserted with the Figure button, or by pasting or dropping an image. '), X('tut-fig1'), T(' shows a damped oscillation as described by '), X('tut-eq1'), T('; the numbers in this sentence are references and follow when things move.')),
      { type: 'figure', attrs: { id: 'tut-fig1', placement: 'here', pos: 'top', side: 'right', width: 0.6, comments: [], annotations: [] }, content: [{ type: 'image', attrs: { src: name, w: size.w, h: size.h } }, { type: 'caption', content: [T('Two damped oscillations with different phase. Click the figure: the row under the toolbar sets its place and width.')] }] },
      TRY(T('drag a corner of the figure to make it smaller. Then press Ctrl+R here, type “fig” and press Enter to insert a reference to it.')),
      { type: 'table_figure', attrs: { id: 'tut-tab1', placement: 'here', pos: 'top' }, content: [{ type: 'caption', content: [T('The parameters of the two curves. Tab moves between cells; Tab in the last cell adds a row.')] }, { type: 'table', content: [
        { type: 'table_row', content: [CELL('Curve', 'table_header'), CELL('Amplitude', 'table_header'), CELL('Phase', 'table_header')] },
        { type: 'table_row', content: [CELL('blue'), CELL('1.0'), CELL('0')] },
        { type: 'table_row', content: [CELL('red'), CELL('1.0'), CELL('1.3')] },
      ] }] },

      H('tut-4', 'Citing papers'),
      P(T('A citation looks like this '), { type: 'citation', attrs: { items: [{ id: 'novoselov2004' }], mode: 'normal' } }, T(' and the reference list at the end is made from the citations. The style follows the journal you choose.')),
      TRY(T('press Ctrl+Alt+C here and paste a DOI, for example '), T('10.1103/PhysRevLett.100.136804', I), T(', then Enter. Then open Format → Journal style… and pick a journal: the citations and the list change with it.')),

      H('tut-5', 'Comments and tracked changes'),
      P(T('Colleagues comment on a '), T('piece of text', { type: 'comment', attrs: { id: 'c-tut1' } }), T(' and suggest changes. A suggestion shows what would be '), T('removed', DEL(colleague)), T('added', INS(colleague)), T(' in the colour of its author, with a card beside the page. This sentence has a second one: it is'), T(' really', INS(colleague2)), T(' simple.')),
      TRY(T('press ✓ Accept on one card and ✗ Reject on the other. Then press the Track button and edit this sentence: your own changes are now suggestions too. Press Track again to switch it off.')),

      H('tut-6', 'For co-authors and for the journal'),
      P(T('The PDF button writes the paper as the preview shows it. The Word button writes a real Word file — equations, numbered captions, references, comments and tracked changes included — and File → Import Word document… brings a co-author’s version back. File → Export LaTeX makes a project for Overleaf.')),
      P(T('The second tab above the page is the Supporting Information of this paper: its figures and sections are numbered S1, S2, … and it is exported as a file of its own. A reference to it from here, such as '), X('tut-sfig'), T(', stays right when it changes.')),
      TRY(T('click the “Supporting Information” tab, look, and come back. Then press F1 for the guide.')),
      { type: 'bibliography', attrs: { title: 'References' } },
      { type: 'supplement', attrs: { title: 'Supporting Information' }, content: [
        H('tut-s1', 'Additional data'),
        P(T('This is the Supporting Information. It is part of the same file, so references between the two parts stay right; it prints as its own document.')),
        { type: 'figure', attrs: { id: 'tut-sfig', placement: 'here', pos: 'top', side: 'right', width: 0.45, comments: [], annotations: [] }, content: [{ type: 'image', attrs: { src: name, w: size.w, h: size.h } }, { type: 'caption', content: [T('The same data again, as a figure of the Supporting Information.')] }] },
        P(T('Back to the manuscript: the first tab.')),
      ] },
    ],
  };
}
