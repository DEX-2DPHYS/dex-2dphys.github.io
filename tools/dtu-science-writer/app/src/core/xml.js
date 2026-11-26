/* A small XML reader for Office files (no DOM needed, runs in Node and the renderer).
   Element names keep their prefix ("w:p", "m:r"); text is kept exactly (spaces matter inside w:t / m:t).
   Nodes: { name, attrs, children } or { text }. */

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
export const decodeXml = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m));

export function parseXml(src) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.children.push({ text: m[1] });
    else if (m[2]) { if (stack.length > 1) stack.pop(); }
    else if (m[3]) {
      const attrs = {};
      for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decodeXml(a[2] ?? a[3]);
      const el = { name: m[3], attrs, children: [] };
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] !== undefined) top.children.push({ text: decodeXml(m[6]) });
  }
  return root;
}

export const kids = (el, name) => (el ? el.children.filter(c => c.name && (!name || c.name === name)) : []);
export const kid = (el, name) => (el ? el.children.find(c => c.name === name) : undefined) || null;
/** First descendant with that name (depth first). */
export function find(el, name) {
  if (!el || !el.children) return null;
  for (const c of el.children) { if (c.name === name) return c; const d = find(c, name); if (d) return d; }
  return null;
}
export function findAll(el, name, out = []) {
  if (!el || !el.children) return out;
  for (const c of el.children) { if (c.name === name) out.push(c); findAll(c, name, out); }
  return out;
}
export const textOf = (el) => (el.text !== undefined ? el.text : (el.children || []).map(textOf).join(''));
/** w:val of a child element, e.g. val(pPr, 'w:pStyle'). */
export const val = (el, name, attr) => { const c = kid(el, name); return c ? c.attrs[attr || (name.split(':')[0] + ':val')] ?? '' : null; };
/** On/off property (w:b, w:i): present and not val="0"/"false". */
export const on = (el, name) => { const c = kid(el, name); if (!c) return false; const v = c.attrs['w:val'] ?? c.attrs['m:val']; return !(v === '0' || v === 'false' || v === 'off'); };
