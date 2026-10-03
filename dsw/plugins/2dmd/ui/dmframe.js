// The one reader for the 2DM1 frame format.
//
// Spec: DSW/2DMD-FRAME-FORMAT.md. This file runs unchanged in the browser and
// in node, so the panel and the analysis scripts parse frames through the SAME
// code. The plan called for "two readers written from one spec"; one reader
// used by both is strictly better, because two readers agree right up until
// they don't and nothing tells you when that happened.
//
// Browser:  <script src="dmframe.js"></script>   -> window.DM
// Node:     const { DMReader } = require(".../dmframe.js");

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DM = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MAGIC = 0x314D4432;          // '2DM1'
  var KIND = { 1: "registry", 2: "strain", 3: "species" };

  // DSW wraps plugin payloads, so the magic sits at 0 or at 12 depending on the
  // path a frame took. Sniffing both is not paranoia -- it is the documented
  // behaviour, and getting it wrong reads a plausible-looking header out of the
  // wrapper.
  function findMagic(dv) {
    if (dv.byteLength >= 4 && dv.getUint32(0, true) === MAGIC) return 0;
    if (dv.byteLength >= 16 && dv.getUint32(12, true) === MAGIC) return 12;
    return -1;
  }

  // One reader per stream. It is stateful ON PURPOSE: a static layer (the
  // substrate) is only transmitted when the geometry changes, so without a
  // cache every second frame appears to have lost its substrate. That is the
  // single easiest thing to get wrong about this format.
  // A Float32Array VIEW needs its byte offset to be a multiple of 4. In the
  // browser a frame arrives as an ArrayBuffer at offset 0 and every view is
  // free; in node the same bytes are a slice of a shared pool at an arbitrary
  // offset, and the view throws. So: view when we can, copy when we must. The
  // fast path is the one the render loop takes.
  function f32at(u8, byteStart, count) {
    var abs = u8.byteOffset + byteStart;
    if ((abs & 3) === 0) return new Float32Array(u8.buffer, abs, count);
    return new Float32Array(u8.buffer.slice(abs, abs + 4 * count));
  }

  function DMReader() {
    this.cache = [];               // last positions seen, per layer index
    this.geomSeen = false;
  }

  DMReader.prototype.reset = function () {
    this.cache = [];
    this.geomSeen = false;
  };

  DMReader.prototype.parse = function (bytes) {
    var u8 = bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength || bytes.length);
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var o = findMagic(dv);
    if (o < 0) return null;

    var version = dv.getUint32(o + 4, true);
    if (version > 2) {
      // Forward compatibility has limits: blocks are skippable, a header change
      // is not. Say so rather than returning something subtly wrong.
      return { error: "frame format version " + version + " is newer than this reader (2)" };
    }
    var flags = dv.getUint32(o + 8, true);
    var nLayers = dv.getUint32(o + 12, true);
    var frame = dv.getUint32(o + 16, true);
    var ePot = dv.getFloat32(o + 20, true);
    var eKin = dv.getFloat32(o + 24, true);
    var nBlocks = dv.getUint32(o + 28, true);

    var q = o + 32;
    var table = [];
    for (var k = 0; k < nLayers; k++, q += 8) {
      table.push({
        n: dv.getUint32(q, true),
        mobile: (dv.getUint32(q + 4, true) & 1) !== 0,
        present: (dv.getUint32(q + 4, true) & 2) !== 0
      });
    }

    var layers = [];
    for (var k2 = 0; k2 < nLayers; k2++) {
      var t = table[k2];
      var pos;
      if (t.present) {
        pos = f32at(u8, q, 3 * t.n);
        q += 12 * t.n;
        this.cache[k2] = pos;
      } else {
        pos = this.cache[k2] || null;   // null only before the first geometry frame
      }
      layers.push({ n: t.n, mobile: t.mobile, present: t.present, pos: pos });
    }

    var blocks = {};
    var unknown = [];
    for (var b = 0; b < nBlocks; b++) {
      if (q + 16 > o + u8.byteLength) break;
      var kind = dv.getUint32(q, true);
      var mask = dv.getUint32(q + 4, true);
      var nValues = dv.getUint32(q + 8, true);
      q += 16;
      var name = KIND[kind];
      if (!name) {
        // the whole point of nValues: step over what we do not understand
        unknown.push(kind);
        q += 4 * nValues;
        continue;
      }
      var per = [];
      var at = q;
      for (var k3 = 0; k3 < nLayers; k3++) {
        if (!(mask & (1 << k3))) { per.push(undefined); continue; }
        per.push(f32at(u8, at, table[k3].n));
        at += 4 * table[k3].n;
      }
      blocks[name] = per;
      q += 4 * nValues;
    }

    if (flags & 1) this.geomSeen = true;

    return {
      version: version, frame: frame, ePot: ePot, eKin: eKin,
      staticIncluded: (flags & 1) !== 0,
      layers: layers,
      mobile: layers.filter(function (L) { return L.mobile; }),
      substrate: layers.length ? layers[0] : null,
      blocks: blocks,
      unknownBlocks: unknown,
      bytes: u8.byteLength - o
    };
  };

  // Convenience: positions of one layer as [[x,y,z],...]. Handy in scripts,
  // wasteful in a render loop -- read the Float32Array directly there.
  function toTriples(pos) {
    if (!pos) return [];
    var out = new Array(pos.length / 3);
    for (var i = 0, k = 0; i < pos.length; i += 3, k++)
      out[k] = [pos[i], pos[i + 1], pos[i + 2]];
    return out;
  }

  return { DMReader: DMReader, toTriples: toTriples, MAGIC: MAGIC, KINDS: KIND };
});
