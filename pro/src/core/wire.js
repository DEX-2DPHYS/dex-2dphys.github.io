// One binary message for an object that holds typed arrays: the page ↔ desktop backend link.
//
// The structure goes as JSON with every typed array replaced by {"$ta": i} and its bytes appended
// after it, 8-byte aligned, so an operator of hundreds of MB costs one copy instead of a text
// conversion. Numbers JSON cannot carry (NaN, ±Infinity, -0) and undefined array entries travel as
// tagged objects, so a round trip gives back what was put in.
//
//   [u32 "EBW2"][u32 json bytes][json][pad to 8] then per array: [u32 type][u32 0][f64 byte length][bytes][pad to 8]

const MAGIC = 0x32574245;   // "EBW2"
const TYPES = [Float64Array, Float32Array, Int32Array, Uint32Array, Int16Array, Uint16Array, Int8Array, Uint8Array, Uint8ClampedArray, BigInt64Array, BigUint64Array];
const pad8 = (n) => (n + 7) & ~7;

export function encodeWire(obj) {
  const arrays = [];
  const walk = (v) => {
    if (v === undefined) return { $u: 1 };
    if (typeof v === 'number') {
      if (Number.isNaN(v)) return { $n: 'NaN' };
      if (v === Infinity) return { $n: 'Inf' };
      if (v === -Infinity) return { $n: '-Inf' };
      if (v === 0 && 1 / v < 0) return { $n: '-0' };
      return v;
    }
    if (v === null || typeof v !== 'object') return v;
    if (ArrayBuffer.isView(v)) { const t = TYPES.findIndex((T) => v instanceof T); if (t < 0) throw new Error('wire: unsupported view'); arrays.push([t, v]); return { $ta: arrays.length - 1 }; }
    if (Array.isArray(v)) return v.map(walk);
    const o = {};
    for (const k of Object.keys(v)) { const x = v[k]; if (x === undefined || typeof x === 'function') continue; o[k] = walk(x); }
    return o;
  };
  const json = new TextEncoder().encode(JSON.stringify(walk(obj)));
  let size = pad8(8 + json.length);
  for (const [, a] of arrays) size += 16 + pad8(a.byteLength);
  const buf = new ArrayBuffer(size), dv = new DataView(buf), u8 = new Uint8Array(buf);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, json.length, true); u8.set(json, 8);
  let at = pad8(8 + json.length);
  for (const [t, a] of arrays) {
    dv.setUint32(at, t, true); dv.setFloat64(at + 8, a.byteLength, true); at += 16;
    u8.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), at); at += pad8(a.byteLength);
  }
  return buf;
}

// buf: ArrayBuffer, or a Uint8Array view (a Node Buffer) of one message
export function decodeWire(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('wire: not an EBW2 message');
  const jl = dv.getUint32(4, true);
  const tree = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + jl)));
  const arrays = [];
  let at = pad8(8 + jl);
  while (at < u8.byteLength) {
    const t = dv.getUint32(at, true), bl = dv.getFloat64(at + 8, true); at += 16;
    const T = TYPES[t];
    // a copy into its own buffer: aligned for the view, and transferable on its own
    const own = new ArrayBuffer(bl); new Uint8Array(own).set(u8.subarray(at, at + bl));
    arrays.push(new T(own)); at += pad8(bl);
  }
  const back = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(back);
    if ('$ta' in v && Object.keys(v).length === 1) return arrays[v.$ta];
    if ('$n' in v && Object.keys(v).length === 1) return v.$n === 'NaN' ? NaN : v.$n === 'Inf' ? Infinity : v.$n === '-Inf' ? -Infinity : -0;
    if ('$u' in v && Object.keys(v).length === 1) return undefined;
    const o = {};
    for (const k of Object.keys(v)) o[k] = back(v[k]);
    return o;
  };
  return back(tree);
}
