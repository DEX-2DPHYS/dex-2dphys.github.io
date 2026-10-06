// GDSII stream records: the binary layer only, no geometry.
//
// A record is [length u16][type u8][data type u8][payload], big-endian, length including the
// 4-byte header and always even. Payload types: 0 none, 1 bit array (u16), 2 int16, 3 int32,
// 5 real8 (GDS excess-64 base-16 floating point, NOT IEEE), 6 ASCII (padded to even with NUL).

export const RT = {
  HEADER: 0x00, BGNLIB: 0x01, LIBNAME: 0x02, UNITS: 0x03, ENDLIB: 0x04, BGNSTR: 0x05, STRNAME: 0x06,
  ENDSTR: 0x07, BOUNDARY: 0x08, PATH: 0x09, SREF: 0x0a, AREF: 0x0b, TEXT: 0x0c, LAYER: 0x0d,
  DATATYPE: 0x0e, WIDTH: 0x0f, XY: 0x10, ENDEL: 0x11, SNAME: 0x12, COLROW: 0x13, NODE: 0x15,
  TEXTTYPE: 0x16, PRESENTATION: 0x17, STRING: 0x19, STRANS: 0x1a, MAG: 0x1b, ANGLE: 0x1c,
  REFLIBS: 0x1f, FONTS: 0x20, PATHTYPE: 0x21, GENERATIONS: 0x22, ATTRTABLE: 0x23, ELFLAGS: 0x26,
  NODETYPE: 0x2a, PROPATTR: 0x2b, PROPVALUE: 0x2c, BOX: 0x2d, BOXTYPE: 0x2e, PLEX: 0x2f,
  BGNEXTN: 0x30, ENDEXTN: 0x31, FORMAT: 0x36,
};
export const RT_NAME = Object.fromEntries(Object.entries(RT).map(([k, v]) => [v, k]));
export const DT = { NONE: 0, BITS: 1, INT16: 2, INT32: 3, REAL4: 4, REAL8: 5, ASCII: 6 };

// ---------------------------------------------------------------- real8 (excess-64, base 16)
// value = (-1)^s · mantissa/2^56 · 16^(e−64), mantissa a 56-bit integer with 1/16 ≤ m/2^56 < 1.
export function real8Decode(view, off) {
  const b0 = view.getUint8(off);
  const sign = b0 & 0x80 ? -1 : 1, exp = (b0 & 0x7f) - 64;
  let mant = 0;
  // 56 mantissa bits exceed a double's 53, so the last three round away: harmless for unit
  // scales, angles and magnifications.
  for (let i = 1; i < 8; i++) mant = mant * 256 + view.getUint8(off + i);
  return sign * (mant / 2 ** 56) * 16 ** exp;
}
export function real8Encode(x) {
  const out = new Uint8Array(8);
  if (x === 0 || !Number.isFinite(x)) return out;
  let sign = 0;
  if (x < 0) { sign = 0x80; x = -x; }
  let exp = 64;
  while (x >= 1) { x /= 16; exp++; }
  while (x < 1 / 16) { x *= 16; exp--; }
  // x in [1/16, 1): mantissa = round(x · 2^56), written as 7 bytes
  let m = x * 2 ** 56;
  m = Math.round(m);
  if (m >= 2 ** 56) { m /= 16; exp++; }
  out[0] = sign | exp;
  for (let i = 7; i >= 1; i--) { const r = m % 256; out[i] = r; m = (m - r) / 256; }
  return out;
}

// ---------------------------------------------------------------- reading
// Yields {type, dtype, data} with data decoded: number[] for ints/reals, string for ASCII,
// number for bit arrays, null for none. `offset` is kept for error messages.
export function* readRecords(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let off = 0;
  while (off + 4 <= u8.length) {
    const len = view.getUint16(off), type = view.getUint8(off + 2), dtype = view.getUint8(off + 3);
    if (len === 0) break;                                      // padding at the end of some files
    if (len < 4 || off + len > u8.length) throw new Error(`GDS: bad record length ${len} at byte ${off}`);
    const p = off + 4, n = len - 4;
    let data = null;
    switch (dtype) {
      case DT.BITS: data = view.getUint16(p); break;
      case DT.INT16: data = []; for (let i = 0; i < n; i += 2) data.push(view.getInt16(p + i)); break;
      case DT.INT32: data = []; for (let i = 0; i < n; i += 4) data.push(view.getInt32(p + i)); break;
      case DT.REAL8: data = []; for (let i = 0; i < n; i += 8) data.push(real8Decode(view, p + i)); break;
      case DT.ASCII: { let s = ''; for (let i = 0; i < n; i++) { const c = u8[p + i]; if (c) s += String.fromCharCode(c); } data = s; break; }
      default: data = null;
    }
    yield { type, dtype, data, offset: off };
    off += len;
    if (type === RT.ENDLIB) break;
  }
}

// ---------------------------------------------------------------- writing
export class RecordWriter {
  constructor() { this.chunks = []; this.size = 0; }
  _push(type, dtype, payload) {
    const len = 4 + payload.length;
    if (len > 0xffff) throw new Error(`GDS: record ${RT_NAME[type]} too long (${len} bytes)`);
    const h = new Uint8Array(4);
    h[0] = len >> 8; h[1] = len & 255; h[2] = type; h[3] = dtype;
    this.chunks.push(h, payload); this.size += len;
  }
  none(type) { this._push(type, DT.NONE, new Uint8Array(0)); }
  bits(type, v) { const p = new Uint8Array(2); p[0] = (v >> 8) & 255; p[1] = v & 255; this._push(type, DT.BITS, p); }
  int16(type, vals) {
    const p = new Uint8Array(vals.length * 2), dv = new DataView(p.buffer);
    vals.forEach((v, i) => dv.setInt16(i * 2, v)); this._push(type, DT.INT16, p);
  }
  int32(type, vals) {
    const p = new Uint8Array(vals.length * 4), dv = new DataView(p.buffer);
    vals.forEach((v, i) => {
      if (!Number.isInteger(v) || v < -2147483648 || v > 2147483647) throw new Error(`GDS: coordinate ${v} does not fit int32`);
      dv.setInt32(i * 4, v);
    });
    this._push(type, DT.INT32, p);
  }
  real8(type, vals) { const p = new Uint8Array(vals.length * 8); vals.forEach((v, i) => p.set(real8Encode(v), i * 8)); this._push(type, DT.REAL8, p); }
  ascii(type, s) {
    const bytes = [...s].map((c) => { const k = c.charCodeAt(0); return k < 128 ? k : 63; });   // non-ASCII → '?'
    if (bytes.length % 2) bytes.push(0);
    this._push(type, DT.ASCII, Uint8Array.from(bytes));
  }
  bytes() {
    const out = new Uint8Array(this.size); let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    return out;
  }
}
