/* Equation tools: while an equation (or math in the text) is being edited, two expanded palettes stand left and
   right of the page — structures on the left, symbols on the right. A click inserts into the open MathLive
   editor (#0 = the current selection, #? = a placeholder) without taking the focus away.
   Settings: "Hide the page preview while editing an equation" (on by default) makes room for them. */
import { mathState, mathEvents, MATH_MODES, toggleMathMode, mathModeOn } from '../editor/mathview.js';
import { app, $ } from '../context.js';
import { preview, togglePreview } from '../doc/preview.js';

const B = (latex, label, title) => ({ latex, label: label || latex, title: title || latex });

const LEFT = [
  ['Structures', [
    B('\\frac{#0}{#?}', 'a⁄b', 'Fraction'), B('#0^{#?}', 'xⁿ', 'Superscript'), B('#0_{#?}', 'xₙ', 'Subscript'), B('#0_{#?}^{#?}', 'xₙᵐ', 'Sub- and superscript'),
    B('\\sqrt{#0}', '√x', 'Square root'), B('\\sqrt[#?]{#0}', 'ⁿ√x', 'n-th root'), B('\\sum_{#?}^{#?}', '∑', 'Sum with limits'), B('\\prod_{#?}^{#?}', '∏', 'Product'),
    B('\\int_{#?}^{#?}', '∫ₐᵇ', 'Integral with limits'), B('\\int', '∫', 'Integral'), B('\\iint', '∬', 'Double integral'), B('\\oint', '∮', 'Contour integral'),
    B('\\lim_{#?\\to #?}', 'lim', 'Limit'), B('\\frac{\\mathrm{d}#0}{\\mathrm{d}#?}', 'd/dx', 'Derivative'), B('\\frac{\\partial #0}{\\partial #?}', '∂/∂x', 'Partial derivative'), B('\\binom{#?}{#?}', '(ⁿₖ)', 'Binomial'),
  ]],
  ['Brackets', [
    B('\\left(#0\\right)', '( )', 'Parentheses (stretch)'), B('\\left[#0\\right]', '[ ]', 'Square brackets'), B('\\left\\{#0\\right\\}', '{ }', 'Braces'), B('\\left|#0\\right|', '|x|', 'Absolute value'),
    B('\\left\\|#0\\right\\|', '‖x‖', 'Norm'), B('\\left\\langle #0\\right\\rangle', '⟨x⟩', 'Angle brackets'), B('\\left\\lfloor #0\\right\\rfloor', '⌊x⌋', 'Floor'), B('\\left\\lceil #0\\right\\rceil', '⌈x⌉', 'Ceiling'),
  ]],
  ['Matrices and cases', [
    B('\\begin{pmatrix}#? & #?\\\\ #? & #?\\end{pmatrix}', '(⋮⋮)', '2×2 matrix'), B('\\begin{bmatrix}#? & #?\\\\ #? & #?\\end{bmatrix}', '[⋮⋮]', '2×2 matrix, square brackets'),
    B('\\begin{vmatrix}#? & #?\\\\ #? & #?\\end{vmatrix}', '|⋮⋮|', 'Determinant'), B('\\begin{pmatrix}#?\\\\ #?\\end{pmatrix}', '(⋮)', 'Column vector'),
    B('\\begin{cases}#? & #?\\\\ #? & #?\\end{cases}', '{⋮', 'Cases'),
  ]],
  ['Accents', [
    B('\\hat{#0}', 'x̂', 'Hat (operator)'), B('\\vec{#0}', 'x⃗', 'Vector arrow'), B('\\mathbf{#0}', '𝐱', 'Bold (vector)'), B('\\dot{#0}', 'ẋ', 'Time derivative'),
    B('\\ddot{#0}', 'ẍ', 'Second time derivative'), B('\\bar{#0}', 'x̄', 'Bar / mean'), B('\\overline{#0}', 'x̅', 'Overline'), B('\\tilde{#0}', 'x̃', 'Tilde'),
    B('#0^{\\dagger}', 'x†', 'Dagger'), B('#0^{*}', 'x*', 'Complex conjugate'), B("#0'", "x′", 'Prime'), B('\\mathrm{#0}', 'rm', 'Upright text (units, labels)'),
  ]],
  ['Functions', ['sin', 'cos', 'tan', 'exp', 'ln', 'log', 'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan', 'det', 'max', 'min', 'Re', 'Im']
    .map(f => (f === 'Re' || f === 'Im' ? B('\\operatorname{' + f + '}', f) : B('\\' + f, f)))],
];

const greek = 'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi varphi chi psi omega'.split(' ');
const GREEK_CH = 'αβγδϵεζηθϑικλμνξπρστυϕφχψω';
const Greek = 'Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega'.split(' ');
const Greek_CH = 'ΓΔΘΛΞΠΣΦΨΩ';

const RIGHT = [
  ['Greek', greek.map((g, i) => B('\\' + g, GREEK_CH[i], g)).concat(Greek.map((g, i) => B('\\' + g, Greek_CH[i], g)))],
  ['Operators', [
    B('+'), B('-', '−'), B('\\pm', '±'), B('\\mp', '∓'), B('\\times', '×'), B('\\cdot', '·'), B('\\div', '÷'), B('/', '/'),
    B('\\nabla', '∇'), B('\\partial', '∂'), B('\\otimes', '⊗'), B('\\oplus', '⊕'), B('\\circ', '∘'), B('\\ast', '∗'), B('\\sqrt{#0}', '√'), B('\\infty', '∞'),
  ]],
  ['Relations', [
    B('='), B('\\neq', '≠'), B('\\approx', '≈'), B('\\sim', '∼'), B('\\simeq', '≃'), B('\\equiv', '≡'), B('\\propto', '∝'), B('\\cong', '≅'),
    B('<'), B('>'), B('\\leq', '≤'), B('\\geq', '≥'), B('\\ll', '≪'), B('\\gg', '≫'), B('\\in', '∈'), B('\\notin', '∉'),
    B('\\subset', '⊂'), B('\\subseteq', '⊆'), B('\\cup', '∪'), B('\\cap', '∩'), B('\\forall', '∀'), B('\\exists', '∃'), B('\\perp', '⊥'), B('\\parallel', '∥'),
  ]],
  ['Arrows', [
    B('\\to', '→'), B('\\leftarrow', '←'), B('\\leftrightarrow', '↔'), B('\\Rightarrow', '⇒'), B('\\Leftarrow', '⇐'), B('\\Leftrightarrow', '⇔'), B('\\mapsto', '↦'), B('\\uparrow', '↑'),
    B('\\downarrow', '↓'), B('\\rightleftharpoons', '⇌'), B('\\longrightarrow', '⟶'), B('\\xrightarrow{#?}', '→ˣ', 'Arrow with label'),
  ]],
  ['Physics', [
    B('\\hbar', 'ℏ'), B('k_{\\mathrm{B}}', 'k_B', 'Boltzmann constant'), B('\\varepsilon_0', 'ε₀', 'Vacuum permittivity'), B('\\mu_0', 'μ₀', 'Vacuum permeability'),
    B('\\left|#0\\right\\rangle', '|ψ⟩', 'Ket'), B('\\left\\langle #0\\right|', '⟨ψ|', 'Bra'), B('\\left\\langle #?\\middle|#?\\right\\rangle', '⟨φ|ψ⟩', 'Bracket'), B('\\left\\langle #?\\middle|#?\\middle|#?\\right\\rangle', '⟨φ|A|ψ⟩', 'Matrix element'),
    B('\\mathrm{i}', 'i', 'Imaginary unit (upright)'), B('\\mathrm{e}', 'e', 'Euler’s number (upright)'), B('\\mathrm{d}', 'd', 'Differential d (upright)'), B('^{\\circ}', '°', 'Degree'),
    B('\\,\\mathrm{#?}', 'unit', 'Unit after a number (thin space, upright)'), B('\\times 10^{#?}', '×10ⁿ', 'Times ten to the'), B('\\langle #0\\rangle', '⟨x⟩', 'Expectation value'), B('\\dagger', '†'),
  ]],
];

function column(side, groups) {
  const col = document.createElement('aside');
  col.className = 'eqtools eqtools-' + side;
  if (side === 'left') {
    // writing modes: toggles, lit while on
    const g = document.createElement('section');
    const h = document.createElement('h4'); h.textContent = 'Modes'; g.appendChild(h);
    const row = document.createElement('div'); row.className = 'eqmodes';
    for (const [m, d] of Object.entries(MATH_MODES)) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.dataset.mode = m; btn.title = d.title;
      btn.innerHTML = m === 'bold' ? '<b>𝐁 Bold</b>' : m === 'up' ? 'Upright' : 'Text';
      row.appendChild(btn);
    }
    g.appendChild(row);
    col.appendChild(g);
  }
  for (const [title, buttons] of groups) {
    const g = document.createElement('section');
    const h = document.createElement('h4'); h.textContent = title; g.appendChild(h);
    const grid = document.createElement('div'); grid.className = 'eqgrid';
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b.label;
      btn.title = b.title + (b.title !== b.latex ? '   ' + b.latex.replace(/#[0?@]/g, '□') : '');
      btn.dataset.latex = b.latex;
      if (b.label.length > 3) btn.className = 'wide';
      grid.appendChild(btn);
    }
    g.appendChild(grid);
    col.appendChild(g);
  }
  // keep the focus (and selection) in the equation editor
  col.addEventListener('mousedown', (e) => e.preventDefault());
  col.addEventListener('click', (e) => {
    const f = mathState.open && mathState.open.field;
    const mode = e.target.closest('button[data-mode]');
    if (mode && f) { toggleMathMode(f, mode.dataset.mode); return; }
    const btn = e.target.closest('button[data-latex]');
    if (!btn || !f) return;
    f.insert(btn.dataset.latex, { selectionMode: 'placeholder', focus: true });
  });
  return col;
}

let left = null, right = null, hidTimer = null, hidPreview = false;

function ensure() {
  if (left) return;
  left = column('left', LEFT);
  right = column('right', RIGHT);
  $('#editor-scroll').parentElement.append(left, right);
}

function show() {
  ensure();
  clearTimeout(hidTimer);
  // make room: the page preview goes away while editing an equation (Settings), and comes back afterwards
  if (app.settings.eqHidePreview !== false && preview.visible && !hidPreview) { hidPreview = true; togglePreview(false, false); }
  document.body.classList.add('eq-editing');
}

function hide() {
  document.body.classList.remove('eq-editing');
  // moving from one equation straight to the next: do not flash the preview in between
  clearTimeout(hidTimer);
  hidTimer = setTimeout(() => { if (!mathState.open && hidPreview) { hidPreview = false; togglePreview(true, false); } }, 250);
}

/** Light the mode buttons that are on at the cursor. */
function showModes() {
  const f = mathState.open && mathState.open.field;
  if (!left) return;
  left.querySelectorAll('button[data-mode]').forEach(b => b.classList.toggle('on', !!f && mathModeOn(f, b.dataset.mode)));
}

mathEvents.addEventListener('open', show);
mathEvents.addEventListener('mode', showModes);
mathEvents.addEventListener('close', hide);
