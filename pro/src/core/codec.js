// Compact, exact storage of float arrays inside the JSON project file: little-endian Float32 bytes
// as base64 (4 bytes per value → 5.3 characters, against ~10–20 for decimal text).

export function f32ToB64(arr) {
  const f = arr instanceof Float32Array ? arr : Float32Array.from(arr);
  const bytes = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64ToF32(b64) {
  const s = atob(b64), bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}
