/* Sample paper (Help → Open sample paper, and the phase-1 test): ~4 pages, 10 display equations,
   inline math, 3 figures (top-of-page float, here, wrapped), cross-references. Demonstration text only. */
import { addImage, imageSize } from '../core/media.js';

async function canvasPng(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  draw(g, w, h);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

function axes(g, x0, y0, w, h, xl, yl) {
  g.strokeStyle = '#222'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(x0, y0 - h); g.lineTo(x0, y0); g.lineTo(x0 + w, y0); g.stroke();
  g.fillStyle = '#222'; g.font = '26px serif';
  g.fillText(xl, x0 + w - 40, y0 + 36);
  g.save(); g.translate(x0 - 30, y0 - h + 50); g.rotate(-Math.PI / 2); g.fillText(yl, 0, 0); g.restore();
}

const PLOTS = {
  // resistance vs gate voltage: Dirac peak at several temperatures
  dirac: (g, w, h) => {
    axes(g, 90, h - 70, w - 130, h - 110, 'Vg (V)', 'R (kΩ)');
    const cols = ['#1f4e9c', '#2a8a5a', '#c7741c', '#b8312f'];
    cols.forEach((c, k) => {
      g.strokeStyle = c; g.lineWidth = 3; g.beginPath();
      for (let i = 0; i <= 400; i++) {
        const v = -40 + 80 * i / 400, n2 = (v - 3) ** 2 + (6 + 5 * k) ** 2;
        const R = 1 / Math.sqrt(n2) * 55 + 0.4;
        const X = 90 + (w - 130) * i / 400, Y = h - 70 - (h - 130) * Math.min(R / 9.5, 1);
        i ? g.lineTo(X, Y) : g.moveTo(X, Y);
      }
      g.stroke();
    });
  },
  // colour map: conductance vs two gates
  map: (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = (x / w - 0.5) * 6, v = (y / h - 0.5) * 6;
      const s = 0.5 + 0.5 * Math.cos(2.2 * Math.hypot(u - 0.4 * v, v) + 0.6 * u) * Math.exp(-0.08 * (u * u + v * v));
      const i = 4 * (y * w + x);
      img.data[i] = 255 * Math.min(1, 1.6 * s); img.data[i + 1] = 255 * s * s; img.data[i + 2] = 255 * (0.35 + 0.65 * (1 - s)); img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  },
  // device schematic
  device: (g, w, h) => {
    g.fillStyle = '#d9d4c7'; g.fillRect(40, h - 120, w - 80, 70);
    g.fillStyle = '#7f8fa6'; g.fillRect(40, h - 150, w - 80, 30);
    g.fillStyle = '#222'; g.fillRect(w / 2 - 170, h - 160, 340, 10);
    g.fillStyle = '#d4a017'; g.fillRect(w / 2 - 230, h - 200, 90, 50); g.fillRect(w / 2 + 140, h - 200, 90, 50);
    g.fillStyle = '#9aa7b8'; g.fillRect(w / 2 - 150, h - 230, 300, 40);
    g.fillStyle = '#d4a017'; g.fillRect(w / 2 - 70, h - 280, 140, 50);
    g.fillStyle = '#222'; g.font = '24px sans-serif';
    g.fillText('source', w / 2 - 230, h - 210); g.fillText('drain', w / 2 + 150, h - 210);
    g.fillText('top gate', w / 2 - 45, h - 290); g.fillText('graphene', w / 2 + 180, h - 145);
    g.fillText('SiO₂ / Si back gate', 60, h - 70);
  },
};

const T = (text, marks) => (marks ? { type: 'text', text, marks: marks.map(m => ({ type: m })) } : { type: 'text', text });
const P = (...c) => ({ type: 'paragraph', content: c });
const H = (level, text, id) => ({ type: 'heading', attrs: { level, numbered: true, id }, content: [T(text)] });
const EQ = (latex, id, numbered = true) => ({ type: 'equation', attrs: { latex, numbered, id } });
const MI = (latex) => ({ type: 'math_inline', attrs: { latex } });
const R = (target) => ({ type: 'xref', attrs: { target } });
const FIG = (attrs, src, w, h, cap) => ({ type: 'figure', attrs, content: [{ type: 'image', attrs: { src, w, h } }, { type: 'caption', content: cap }] });
const CELL = (type, content, attrs = {}) => ({ type, attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null, ...attrs }, content: [{ type: 'paragraph', content: typeof content === 'string' ? (content ? [T(content)] : []) : content }] });
const TH = (c, a) => CELL('table_header', c, a);
const TD = (c, a) => CELL('table_cell', c, a);
const ROW = (...cells) => ({ type: 'table_row', content: cells });
const NUM = { align: 'right' };
const PARAMS = {
  type: 'table_figure', attrs: { placement: 'here', id: 'tab-params' }, content: [
    { type: 'caption', content: [T('Parameters used in the estimates of '), R('sec-gating'), T(' and '), R('sec-temp'), T('. Typical literature values, for demonstration only.')] },
    { type: 'table', content: [
      ROW(TH('Group'), TH('Quantity'), TH('Symbol'), TH('Value', NUM), TH('Unit')),
      ROW(TD('Electronic', { rowspan: 2 }), TD('Fermi velocity'), TD([MI('v_F')]), TD([MI('1.0\\times10^{6}')], NUM), TD([MI('\\mathrm{m\\,s^{-1}}')])),
      ROW(TD('Residual density'), TD([MI('n^*')]), TD([MI('2\\times10^{10}')], NUM), TD([MI('\\mathrm{cm^{-2}}')])),
      ROW(TD('Gates', { rowspan: 2 }), TD('Back-gate capacitance'), TD([MI('C_{bg}')]), TD('11.5', NUM), TD([MI('\\mathrm{nF\\,cm^{-2}}')])),
      ROW(TD('Top-gate capacitance'), TD([MI('C_{tg}')]), TD('120', NUM), TD([MI('\\mathrm{nF\\,cm^{-2}}')])),
      ROW(TD('Phonons', { rowspan: 2 }), TD('Deformation potential'), TD([MI('D_a')]), TD('18', NUM), TD('eV')),
      ROW(TD('Sound velocity'), TD([MI('v_s')]), TD([MI('2.1\\times10^{4}')], NUM), TD([MI('\\mathrm{m\\,s^{-1}}')])),
    ] },
  ],
};
const LOREM ='The measurements were repeated on several devices from the same growth run, and the scatter between devices is included in the error bars quoted below. ';

export async function buildSample() {
  const img = {};
  for (const [k, size] of Object.entries({ dirac: [900, 600], map: [600, 520], device: [900, 420] })) {
    const name = addImage(k + '.png', await canvasPng(size[0], size[1], PLOTS[k]));
    img[k] = { name, ...(await imageSize(name)) };
  }
  const doc = {
    type: 'doc', content: [
      { type: 'title', content: [T('Charge transport in encapsulated graphene: a sample manuscript')] },
      { type: 'authors', attrs: {
        list: [
          { name: 'A. Author', affils: ['af-1'], corresponding: false, email: '' },
          { name: 'B. Author', affils: ['af-1', 'af-2'], corresponding: true, email: 'b.author@example.org' },
        ],
        affils: [
          { id: 'af-1', dept: 'Department of Physics', inst: 'Example University', street: 'Main Street 1', postcode: '1000', city: 'Example City', country: 'Denmark' },
          { id: 'af-2', dept: 'Centre for 2D Materials', inst: 'Example Institute', street: '', postcode: '', city: 'Example Town', country: 'Sweden' },
        ],
      } },
      { type: 'abstract', content: [P(T('This sample document shows what DTU Science Writer does: numbered sections, display equations, inline math such as '), MI('\\sigma=ne\\mu'), T(', figures fixed to the page, placed in the text or wrapped by it, and cross-references that update themselves. The physics is textbook material used only as demonstration content.'))] },
      H(1, 'Introduction', 'sec-intro'),
      P(T('Graphene is a single layer of carbon atoms. Near the charge neutrality point its low-energy electrons obey a linear dispersion relation, '), R('eq-disp'), T(', so the carriers behave as massless Dirac fermions with Fermi velocity '), MI('v_F\\approx 10^6\\,\\mathrm{m/s}'), T('. A typical device is sketched in '), R('fig-device'), T('.')),
      EQ('E_{\\pm}(\\mathbf{k}) = \\pm\\hbar v_F |\\mathbf{k}|', 'eq-disp'),
      P(T('Counting states in two dimensions with spin and valley degeneracy '), MI('g_s=g_v=2'), T(' gives a density of states that vanishes linearly at zero energy:')),
      EQ('D(E) = \\frac{g_s g_v |E|}{2\\pi \\hbar^2 v_F^2}', 'eq-dos'),
      FIG({ placement: 'float', pos: 'top', width: 0.9, id: 'fig-device' }, img.device.name, img.device.w, img.device.h,
        [T('Schematic cross-section of a dual-gated graphene field-effect device. The carrier density is set by the back gate through '), R('eq-density'), T(' and tuned locally by the top gate.')]),
      P(T(LOREM + 'Integrating '), R('eq-dos'), T(' up to the Fermi energy relates the carrier density to the Fermi wave vector, '), MI('n = k_F^2/\\pi'), T('.')),
      H(1, 'Electrostatic gating', 'sec-gating'),
      P(T('A gate voltage '), MI('V_g'), T(' across a dielectric of thickness '), MI('d'), T(' and permittivity '), MI('\\varepsilon_r\\varepsilon_0'), T(' induces the sheet density')),
      EQ('n = \\frac{C_g\\,(V_g - V_D)}{e}, \\qquad C_g = \\frac{\\varepsilon_r \\varepsilon_0}{d}', 'eq-density'),
      P(T('where '), MI('V_D'), T(' is the gate voltage at the Dirac point. At low density the geometric capacitance is in series with the quantum capacitance')),
      EQ('C_q = e^2 D(E_F) = \\frac{2e^2}{\\hbar v_F}\\sqrt{\\frac{|n|}{\\pi}}', 'eq-cq'),
      P(T(LOREM + LOREM)),
      H(2, 'Conductivity and mobility', 'sec-mobility'),
      FIG({ placement: 'wrap', side: 'right', width: 0.42, id: 'fig-map' }, img.map.name, img.map.w, img.map.h,
        [T('Conductance map versus the two gate voltages; the diagonal ridge follows the condition in '), R('eq-twogate'), T('.')]),
      P(T('In the diffusive regime the conductivity follows the Drude form, and the field-effect mobility is extracted from the slope of the conductivity with gate voltage, '), R('eq-mu'), T('. With both gates active, the total density is a weighted sum of the two gate voltages, which produces the diagonal structure in '), R('fig-map'), T('. ' + LOREM + LOREM)),
      P(T('Charged impurities give a conductivity that grows linearly with density, while short-range scatterers give a constant contribution; the two add as resistivities (Matthiessen’s rule). ' + LOREM)),
      EQ('\\sigma = n e \\mu', 'eq-drude'),
      EQ('\\mu_{\\mathrm{FE}} = \\frac{1}{C_g}\\,\\frac{\\partial \\sigma}{\\partial V_g}', 'eq-mu'),
      EQ('n_{\\mathrm{tot}} = \\frac{C_{bg}(V_{bg}-V_{bg}^0) + C_{tg}(V_{tg}-V_{tg}^0)}{e}', 'eq-twogate'),
      P(T('Near the Dirac point the density never reaches zero because of electron–hole puddles; the residual density '), MI('n^*'), T(' is commonly modelled by')),
      EQ('n_{\\mathrm{eff}} = \\sqrt{n^2 + n^{*2}}', 'eq-puddle'),
      H(1, 'Temperature dependence', 'sec-temp'),
      P(T('The measured resistance as a function of gate voltage is shown in '), R('fig-dirac'), T(' for four temperatures. The peak resistance decreases as thermally excited carriers add to the residual density.')),
      FIG({ placement: 'here', width: 0.75, id: 'fig-dirac' }, img.dirac.name, img.dirac.w, img.dirac.h,
        [T('Resistance versus gate voltage at four temperatures. The width of the Dirac peak sets the residual density '), MI('n^*'), T(' in '), R('eq-puddle'), T('.')]),
      P(T('The thermally activated density at the Dirac point follows from integrating '), R('eq-dos'), T(' with the Fermi–Dirac distribution:')),
      EQ('n_{\\mathrm{th}} = \\frac{\\pi}{6}\\left(\\frac{k_B T}{\\hbar v_F}\\right)^2', 'eq-nth'),
      P(T('At high temperature, scattering by acoustic phonons adds a resistivity that is linear in temperature and independent of density,')),
      EQ('\\rho_{\\mathrm{ph}}(T) = \\frac{\\pi D_a^2 k_B T}{4 e^2 \\hbar \\rho_m v_s^2 v_F^2}', 'eq-phonon'),
      P(T('with deformation potential '), MI('D_a'), T(', mass density '), MI('\\rho_m'), T(' and sound velocity '), MI('v_s'), T('. The values used here are collected in '), R('tab-params'), T('.')),
      PARAMS,
      H(1, 'Ballistic limit', 'sec-ballistic'),
      P(T('When the channel is shorter than the mean free path, the conductance is given by the Landauer formula, summing the transmission of all transverse modes (unnumbered here, for comparison with '), R('eq-drude'), T('):')),
      EQ('G = \\frac{4e^2}{h}\\sum_{n=1}^{N} T_n', 'eq-landauer', false),
      P(T('For a channel of width '), MI('W'), T(' the number of modes is '), MI('N = \\lfloor k_F W/\\pi \\rfloor'), T(', so the ballistic conductance grows as '), MI('\\sqrt{n}'), T('. The results of '), R('sec-gating'), T(' and '), R('sec-temp'), T(' together set the conditions for reaching this regime. ' + LOREM)),
      H(1, 'Conclusion', 'sec-conclusion'),
      P(T('The sample covers the features of the first prototype: '), T('bold', ['bold']), T(', '), T('italic', ['italic']), T(', '), T('underlined', ['underline']), T(' text, super'), T('script', ['sup']), T(' and sub'), T('script', ['sub']), T(', ten display equations, three figure placements and automatic cross-references.')),
    ],
  };
  return doc;
}
