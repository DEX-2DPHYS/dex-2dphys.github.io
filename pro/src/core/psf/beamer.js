// BEAMER PSF import (GenISys .lpsf, written by TRACER / BEAMER's internal mcTrace simulation).
//
// The file is zlib-compressed XML (boost::serialization, class LPSF_2012):
//   m_Comments          free text: the stack, energy, mesh and statistics of the simulation
//   m_PSFDataOriginal   <item><m_x>r / nm</m_x><m_y>f</m_y></item> …  energy per unit area, not
//                       normalised; the first point is r = 0 and the tail ends in zeros
//   m_lBeam_Energy_kV, m_dZ_Position (µm: the depth in the resist the PSF was taken at),
//   m_lElectrons, m_sSimulator, m_Stack (<first>material</first><second>thickness nm</second>)
//
// The values are per area (they fall from r = 0 on), so the table goes through tableToPSF in
// 'per-area' mode, which drops the r = 0 point and normalises. An uncompressed XML file (some
// BEAMER versions write .psf as plain XML) is read the same way.

import { tableToPSF } from './table.js';

const isZlib = (b) => b.length > 2 && b[0] === 0x78 && ((b[0] << 8) | b[1]) % 31 === 0;

// zlib → bytes, with the platform's own DecompressionStream (browsers and Node 18+)
async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

// The XML text of a BEAMER PSF file, whether it arrives compressed or not.
export async function beamerPsfText(input) {
  if (typeof input === 'string') return input;
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const raw = isZlib(b) ? await inflate(b) : b;
  return new TextDecoder('utf-8').decode(raw);
}

export const looksLikeBeamerPsf = (bytes) => {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (isZlib(b)) return true;
  const head = new TextDecoder('latin1').decode(b.subarray(0, 400));
  return /LPSF_\d+|m_PSFDataOriginal/.test(head);
};

const tag = (xml, name) => { const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml); return m ? m[1].trim() : null; };
const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// XML text → { r, f, meta }: the raw table (nm, per area) and what the file says about itself
export function parseBeamerPsfXml(xml) {
  if (!/LPSF_\d+/.test(xml) || !/m_PSFDataOriginal/.test(xml)) throw new Error('not a BEAMER PSF file (no LPSF / m_PSFDataOriginal section)');
  const block = xml.slice(xml.indexOf('<m_PSFDataOriginal'), xml.indexOf('</m_PSFDataOriginal>'));
  const r = [], f = [];
  for (const m of block.matchAll(/<m_x>([^<]+)<\/m_x>\s*<m_y>([^<]+)<\/m_y>/g)) { r.push(+m[1]); f.push(+m[2]); }
  if (r.length < 3) throw new Error('the BEAMER PSF has fewer than three data points');
  if (r.some((x) => !Number.isFinite(x)) || f.some((x) => !Number.isFinite(x))) throw new Error('the BEAMER PSF contains values that are not numbers');

  const stack = [];
  const sBlock = xml.indexOf('<m_Stack') >= 0 ? xml.slice(xml.indexOf('<m_Stack'), xml.indexOf('</m_Stack>')) : '';
  for (const m of sBlock.matchAll(/<first>([^<]*)<\/first>\s*<second>([^<]*)<\/second>/g)) stack.push({ material: unescape(m[1].trim()), thicknessNm: +m[2] });
  const comments = [];
  const cBlock = xml.indexOf('<m_Comments') >= 0 ? xml.slice(xml.indexOf('<m_Comments'), xml.indexOf('</m_Comments>')) : '';
  for (const m of cBlock.matchAll(/<item>([^<]*)<\/item>/g)) comments.push(unescape(m[1]).replace(/\s+$/, ''));
  const kV = +tag(xml, 'm_lBeam_Energy_kV');
  const zUm = +tag(xml, 'm_dZ_Position');
  const electrons = +tag(xml, 'm_lElectrons');
  const fromComments = (re) => { for (const c of comments) { const m = re.exec(c); if (m) return m[1]; } return null; };
  const meta = {
    format: 'BEAMER .lpsf',
    energyKeV: Number.isFinite(kV) && kV > 0 ? kV : +(fromComments(/Injection Energy\/eV:\s*([\d.e+]+)/) || 0) / 1000 || null,
    depthNm: Number.isFinite(zUm) ? zUm * 1000 : null,
    electrons: Number.isFinite(electrons) && electrons > 0 ? electrons : null,
    simulator: tag(xml, 'm_sSimulator') || fromComments(/^\s*(mcTrace[^#]*)$/) || null,
    stack,
    resist: stack[0]?.material || null,
    resistNm: stack[0]?.thicknessNm ?? null,
    substrate: stack.length ? stack[stack.length - 1].material : null,
    comments,
  };
  return { r, f, meta };
}

// File (bytes or text) → PSF object, ready for the PSF tab
export async function importBeamerPsf(input, { name = 'BEAMER PSF' } = {}) {
  const xml = await beamerPsfText(input);
  const { r, f, meta } = parseBeamerPsfXml(xml);
  const psf = tableToPSF(r, f, { rUnit: 'nm', valueMode: 'per-area', meta: { ...meta, file: name } });
  psf.meta.source = 'BEAMER';                          // the PSF label says where the table came from
  // the r = 0 point is always there in these files: not worth a warning
  psf.warnings = psf.warnings.filter((w) => !/r ≤ 0 dropped/.test(w));
  const zeros = f.filter((v) => v === 0).length;
  if (zeros) psf.notes = [`${zeros} trailing zero value${zeros > 1 ? 's' : ''} (beyond the simulated range) kept as zero`];
  return { psf, xml };
}

// One line for the PSF tab: what the file is
export function beamerPsfLabel(meta) {
  const st = (meta.stack || []).map((l) => `${l.material} ${l.thicknessNm >= 10000 ? (l.thicknessNm / 1000).toFixed(0) + ' µm' : l.thicknessNm + ' nm'}`).join(' / ');
  return `BEAMER PSF: ${meta.energyKeV ?? '?'} kV, ${st || 'stack not given'}${meta.depthNm != null ? `, taken at ${meta.depthNm.toFixed(0)} nm depth` : ''}${meta.electrons ? `, ${meta.electrons.toExponential(0)} electrons` : ''}${meta.simulator ? ` (${meta.simulator})` : ''}`;
}
