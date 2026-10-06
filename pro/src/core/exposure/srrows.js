// The short-range operator's rows: point k gets Σ val · dose(idx) over its row. Two forms:
//   CSR       {ptr, idx, val}                 one array each, rows in point order (small jobs, the
//                                             native core's reply, tests)
//   segmented {seg: [{idx, val}], sp, off, len, nnz}
//             row k is seg[sp[k]].idx/val from off[k], len[k] entries long. The rows stay in the
//             buffers they were built in (one per tile of the engine, per helper), so nothing is
//             concatenated or reordered: ChipV11's contour fit has ~10 GB of rows, and one
//             contiguous copy of them (plus the parts it was copied from) was more than the machine
//             could allocate.
// Either form gives the same row contents in the same order, so a solve over them is bit-identical.

export const isSegmented = (SR) => !!SR && Array.isArray(SR.seg);
export const srEntries = (SR) => (isSegmented(SR) ? SR.nnz : SR.val.length);

// the arrays a loop reads, for either form: row k is I[S[k]] / V[S[k]] from O[k] for L[k] entries
export function rowsOf(SR) {
  if (isSegmented(SR)) return { I: SR.seg.map((s) => s.idx), V: SR.seg.map((s) => s.val), S: SR.sp, O: SR.off, L: SR.len, n: SR.len.length };
  const n = SR.ptr.length - 1, O = SR.ptr.subarray(0, n), L = new Int32Array(n);
  for (let k = 0; k < n; k++) L[k] = SR.ptr[k + 1] - SR.ptr[k];
  return { I: [SR.idx], V: [SR.val], S: null, O, L, n };
}

// one CSR (for tests and the native core; small jobs only)
export function toCSR(SR) {
  if (!isSegmented(SR)) return SR;
  const n = SR.len.length, ptr = new Int32Array(n + 1);
  for (let k = 0; k < n; k++) ptr[k + 1] = ptr[k] + SR.len[k];
  const idx = new Int32Array(ptr[n]), val = new Float64Array(ptr[n]);
  for (let k = 0; k < n; k++) {
    const s = SR.seg[SR.sp[k]], o = SR.off[k], l = SR.len[k];
    idx.set(s.idx.subarray(o, o + l), ptr[k]); val.set(s.val.subarray(o, o + l), ptr[k]);
  }
  return { ptr, idx, val };
}

// the buffers to transfer with a segmented operator (postMessage)
export function srTransfer(SR) {
  if (!isSegmented(SR)) return [SR.ptr.buffer, SR.idx.buffer, SR.val.buffer];
  const t = [SR.sp.buffer, SR.off.buffer, SR.len.buffer];
  for (const s of SR.seg) t.push(s.idx.buffer, s.val.buffer);
  return t;
}
