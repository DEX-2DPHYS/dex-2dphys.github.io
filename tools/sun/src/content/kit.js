// Shared by the content files: the small maths kit (laid out by the CSS in template.html:
// .eq / .mi / .frac), the opening tag of the chapter diagrams, and glossary terms.
export const mi = (s) => `<span class="mi">${s}</span>`;
export const frac = (n, d) => `<span class="frac"><span class="fr-n">${n}</span><span class="fr-d">${d}</span></span>`;

export const svgOpen = (h = 150) =>
  `<svg viewBox="0 0 320 ${h}" width="100%" role="img" class="dia">`;

// a glossary term: hover (or tap) shows its definition from GLOSSARY[key]
export const gl = (key, text) => `<span class="gl" data-gl="${key}" tabindex="0">${text || key}</span>`;
