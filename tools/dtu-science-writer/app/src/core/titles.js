/* Consistent capitalisation of article titles in the reference list.
   Publishers register titles in their own style — APS in Title Case ("Scalable Tight-Binding Model for Graphene"),
   Nature and IOP in sentence case — so a list built from Crossref looks like two lists merged. Titles that are in
   Title Case are put into sentence case; acronyms, formulas and proper names keep their capitals.
   Applied at formatting time (references.js forFormatting); the stored title is not changed. */

/* Proper names (and adjectives from names) common in physics, chemistry and materials science: kept capitalised. */
const PROPER = new Set(`Dirac Hall Landau Anderson Kubo Bloch Fermi Coulomb Raman Josephson Klein Hofstadter Boltzmann
Schrödinger Schrodinger Hamiltonian Lagrangian Gaussian Lorentzian Brillouin Berry Chern Majorana Weyl Bose Einstein Mott
Hubbard Kondo Zeeman Stark Rashba Dresselhaus Aharonov Bohm Fabry Pérot Perot Peierls Kekulé Kekule Néel Neel Curie Ising
Heisenberg Kramers Wigner Casimir Auger Shubnikov Haas Drude Fourier Green Kelvin Maxwell Newton Poisson Schottky Seebeck
Peltier Andreev Cooper Bogoliubov Luttinger Tomonaga Fano Veselago Bernal Planck Landauer Büttiker Buttiker Kwant Clar
Bragg Debye Hückel Huckel Kohn Sham Hartree Fock Born Oppenheimer Monte Carlo Markov Bayes Bayesian Kerr Faraday Pauli
Hund Jahn Teller Lifshitz Kosterlitz Thouless Berezinskii Ginzburg Abrikosov Meissner London Bardeen Schrieffer Hooke
Young Navier Stokes Reynolds Knudsen Langmuir Arrhenius Gibbs Helmholtz Nernst Ohm Joule Volta Ampère Ampere Lorentz
Compton Bohr Rydberg Rabi Ramsey Bell Feynman Dyson Kelvin Rayleigh Mie Brewster Snell Fresnel Fraunhofer Abbe Airy Bessel
Legendre Hermite Laguerre Chebyshev Hilbert Banach Riemann Euler Lagrange Hamilton Jacobi Noether Lie Cartan Minkowski
Europe European America American Asia Asian Africa African Denmark Danish Germany German China Chinese Japan Japanese
Waals I Si Ge GaAs`.split(/\s+/));
const SMALL = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'nor', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'with', 'from', 'as', 'via', 'into', 'vs', 'per', 'its', 'is', 'are']);

const isAcronym = (w) => /^[A-Z0-9]{2,}s?$/.test(w) || /\d/.test(w) || /[a-z].*[A-Z]/.test(w.slice(1)) || /^[A-Z]\.$/.test(w);
const capitalised = (w) => /^[A-ZÀ-Þ][a-zà-ÿ]/.test(w);

/** Is this title in Title Case? (most of its longer words start with a capital) */
export function isTitleCase(title) {
  const words = String(title || '').split(/[\s\-–—/]+/).map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
  const long = words.slice(1).filter(w => w.length > 3 && !isAcronym(w) && !SMALL.has(w.toLowerCase()));
  if (long.length < 2) return false;
  return long.filter(capitalised).length / long.length >= 0.7;
}

/** Sentence case for a Title Case title; other titles are returned unchanged. */
export function sentenceCase(title) {
  const t = String(title || '');
  if (!isTitleCase(t)) return t;
  let first = true;
  return t.replace(/[\p{L}\p{N}][\p{L}\p{N}'’.]*/gu, (w, off) => {
    const wasFirst = first;
    first = false;
    const bare = w.replace(/[.'’]+$/, '').replace(/['’]s$/, '');
    if (wasFirst) return w;                                             // the first word keeps its capital
    if (/[.?!]$/.test(t.slice(0, off).trimEnd())) return w;             // … and so does the first word of a new sentence
    if (isAcronym(w) || PROPER.has(bare)) return w;
    if (!capitalised(w)) return w;
    // a single capital letter standing alone in running text (e.g. "Part A", "Vitamin D") is kept
    if (w.length === 1 && off > 0) return w;
    return w[0].toLowerCase() + w.slice(1);
  });
}
