// GPU surface plot of a dose field (Peter, 2026-10-01: "faster than the bars, higher resolution").
//
// WebGL2. The mesh is generated in the vertex shader from gl_VertexID (two triangles per grid
// quad), heights come from an R32F texture via texelFetch, normals from neighbouring texels.
// One draw call per surface; a field change only re-uploads the texture. An optional second
// surface (the target) is drawn translucent on top.
// Axes (Peter, 2026-10-01: "I cannot follow where we are with respect to dose and clearing
// dose"): a 2D overlay draws the dose axis at the left-most corner and the x/y extents; the
// clearing level is a translucent plane plus a red line where the dose surface crosses it.

const VS = `#version 300 es
precision highp float;
uniform highp sampler2D uH;
uniform ivec2 uN;
uniform float uScale, uAspect, uMax;
uniform mat4 uMVP;
out float vH; out vec3 vNormal; out vec2 vUV;
float hAt(ivec2 p){ p = clamp(p, ivec2(0), uN - 1); return min(texelFetch(uH, p, 0).r, uMax); }   // never above the ceiling
void main(){
  int q = gl_VertexID / 6, c = gl_VertexID % 6;
  int qx = q % (uN.x - 1), qy = q / (uN.x - 1);
  ivec2 off = c == 0 ? ivec2(0,0) : c == 1 ? ivec2(1,0) : c == 2 ? ivec2(1,1) : c == 3 ? ivec2(0,0) : c == 4 ? ivec2(1,1) : ivec2(0,1);
  ivec2 p = ivec2(qx, qy) + off;
  float h = hAt(p);
  vec2 uv = vec2(p) / vec2(uN - 1);
  vec3 pos = vec3((uv.x - 0.5) * 2.0 * uAspect, (uv.y - 0.5) * 2.0, h * uScale);
  float dx = (hAt(p + ivec2(1,0)) - hAt(p - ivec2(1,0))) * uScale / (4.0 * uAspect / float(uN.x - 1));
  float dy = (hAt(p + ivec2(0,1)) - hAt(p - ivec2(0,1))) * uScale / (4.0 / float(uN.y - 1));
  vNormal = normalize(vec3(-dx, -dy, 1.0));
  vH = h; vUV = uv;
  gl_Position = uMVP * vec4(pos, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in float vH; in vec3 vNormal; in vec2 vUV;
uniform float uMax, uAlpha, uContour, uClear; uniform int uMode; uniform vec3 uTint;
uniform sampler2D uLut;                                  // 256 × 1 colour scale (colormaps.js)
out vec4 o;
void main(){
  float t = clamp(vH / uMax, 0.0, 1.0);
  vec3 base = uMode == 2 ? uTint : texture(uLut, vec2(t * 255.0 / 256.0 + 0.5 / 256.0, 0.5)).rgb;
  vec3 L = normalize(vec3(0.4, -0.5, 0.75));
  float diff = abs(dot(normalize(vNormal), L));
  vec3 col = base * (0.35 + 0.65 * diff);
  if (uContour > 0.0 && uMode != 2) {
    float s = vH / (uMax * uContour), w = fwidth(s);
    // a plateau that sits exactly on a contour level has w = 0: no line there (it speckled)
    float line = w < 1e-4 ? 0.0 : 1.0 - smoothstep(0.0, 1.2 * w, abs(fract(s - 0.5) - 0.5));
    col = mix(col, vec3(0.08), 0.55 * line);
  }
  if (uClear > 0.0 && uMode != 2) {                     // where the surface crosses the clearing level
    float d = abs(vH - uClear), w = max(fwidth(vH), 1e-6 * uMax);
    col = mix(col, vec3(0.86, 0.1, 0.12), 1.0 - smoothstep(2.0 * w, 3.6 * w, d));   // about three pixels wide
  }
  o = vec4(col, uAlpha);
}`;

import { cmapLUT } from '../colormaps.js';

function compile(gl, type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

const mat = {
  persp(fovy, aspect, n, f) { const t = 1 / Math.tan(fovy / 2); return [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]; },
  mul(a, b) { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return o; },
  lookAt(e, c, u) {
    const z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross(u, z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
  },
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function createSurface(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
  if (!gl) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const U = (n) => gl.getUniformLocation(prog, n);
  const u = { Lut: U('uLut'), H: U('uH'), N: U('uN'), Scale: U('uScale'), Aspect: U('uAspect'), MVP: U('uMVP'), Max: U('uMax'), Alpha: U('uAlpha'), Contour: U('uContour'), Mode: U('uMode'), Tint: U('uTint'), Clear: U('uClear') };
  const vao = gl.createVertexArray();
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const tex = { main: gl.createTexture(), target: gl.createTexture(), plane: gl.createTexture(), lut: gl.createTexture() };
  let lutName = '';
  function uploadLut(name) {
    if (name === lutName) return;
    gl.bindTexture(gl.TEXTURE_2D, tex.lut);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, cmapLUT(name));
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    lutName = name;
  }
  const dims = { main: null, target: null, plane: null };
  const cam = { az: -0.9, el: 0.62, dist: 3.1, tx: 0, ty: 0 };
  // clear: dose of the clearing level (0 = off); unit: axis unit; extent: [x, y] in nm
  const opts = { scale: 0.9, max: 1, contour: 0.1, cmap: 'viridis', target: true, aspect: 1, clear: 0, clearLabel: '', unit: 'µC/cm²', extent: null };
  // 2D overlay for the axes, over the WebGL canvas
  const ov = document.createElement('canvas');
  ov.style.cssText = 'position:absolute;pointer-events:none;';
  canvas.parentElement.style.position = 'relative';
  canvas.parentElement.appendChild(ov);

  function upload(which, data, nx, ny) {
    gl.bindTexture(gl.TEXTURE_2D, tex[which]);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, nx, ny, 0, gl.RED, gl.FLOAT, data instanceof Float32Array ? data : Float32Array.from(data));
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    dims[which] = [nx, ny];
  }

  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!dims.main) return;
    const eye = [cam.tx + cam.dist * Math.cos(cam.el) * Math.cos(cam.az), cam.ty + cam.dist * Math.cos(cam.el) * Math.sin(cam.az), cam.dist * Math.sin(cam.el) + 0.3];
    const view = mat.lookAt(eye, [cam.tx, cam.ty, 0.3], [0, 0, 1]);
    const mvp = mat.mul(mat.persp(0.75, w / h, 0.05, 50), view);
    lastMVP = mvp;
    gl.useProgram(prog); gl.bindVertexArray(vao);
    gl.enable(gl.DEPTH_TEST);
    gl.uniformMatrix4fv(u.MVP, false, new Float32Array(mvp));
    gl.uniform1f(u.Scale, opts.scale / Math.max(opts.max, 1e-30)); gl.uniform1f(u.Aspect, opts.aspect);
    gl.activeTexture(gl.TEXTURE1); uploadLut(opts.cmap); gl.bindTexture(gl.TEXTURE_2D, tex.lut); gl.uniform1i(u.Lut, 1);
    gl.uniform1f(u.Max, opts.max); gl.uniform1i(u.H, 0); gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(u.Clear, opts.clear > 0 && opts.clear < opts.max ? opts.clear : 0);
    const pass = (which, mode, alpha) => {
      const [nx, ny] = dims[which];
      // overlays lie exactly on the dose surface where they agree: push them back, no z-fighting
      if (which === 'main') gl.disable(gl.POLYGON_OFFSET_FILL); else { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1); }
      gl.bindTexture(gl.TEXTURE_2D, tex[which]);
      gl.uniform2i(u.N, nx, ny); gl.uniform1i(u.Mode, mode); gl.uniform1f(u.Alpha, alpha);
      gl.uniform1f(u.Contour, mode === 2 ? 0 : opts.contour);
      if (which === 'plane') gl.uniform3f(u.Tint, 0.9, 0.15, 0.15); else gl.uniform3f(u.Tint, 0.15, 0.7, 0.35);
      gl.drawArrays(gl.TRIANGLES, 0, 6 * (nx - 1) * (ny - 1));
    };
    gl.disable(gl.BLEND); gl.depthMask(true);
    pass('main', 0, 1);
    if (opts.target && dims.target) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); pass('target', 2, 0.28); gl.depthMask(true); gl.disable(gl.BLEND); }
    if (opts.clear > 0 && opts.clear < opts.max) {
      upload('plane', new Float32Array([opts.clear, opts.clear, opts.clear, opts.clear]), 2, 2);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); pass('plane', 2, 0.3); gl.depthMask(true); gl.disable(gl.BLEND);
    }
    drawAxes(w, h, dpr);
  }

  // ---- axes overlay
  let lastMVP = null;
  const nice = (v) => { const e = 10 ** Math.floor(Math.log10(v)), m = v / e; return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * e; };
  function toScreen(x, y, z, w, h) {
    const m = lastMVP, X = m[0] * x + m[4] * y + m[8] * z + m[12], Y = m[1] * x + m[5] * y + m[9] * z + m[13], W = m[3] * x + m[7] * y + m[11] * z + m[15];
    return { x: ((X / W + 1) / 2) * w, y: ((1 - Y / W) / 2) * h, ok: W > 0 };
  }
  function drawAxes(w, h, dpr) {
    ov.style.left = canvas.offsetLeft + 'px'; ov.style.top = canvas.offsetTop + 'px'; ov.style.width = w + 'px'; ov.style.height = h + 'px';
    if (ov.width !== Math.round(w * dpr) || ov.height !== Math.round(h * dpr)) { ov.width = Math.round(w * dpr); ov.height = Math.round(h * dpr); }
    const c = ov.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    if (!dims.main || !lastMVP) return;
    const A = opts.aspect, zOf = (d) => (d * opts.scale) / Math.max(opts.max, 1e-30);
    const corners = [[-A, -1], [A, -1], [A, 1], [-A, 1]].map(([x, y]) => ({ x, y, p: toScreen(x, y, 0, w, h) }));
    // dose axis at the corner that reads left-most
    const ax = corners.reduce((a, b) => (b.p.x < a.p.x ? b : a));
    const step = nice(opts.max / 5), top = Math.floor(opts.max / step) * step;
    const p0 = toScreen(ax.x, ax.y, 0, w, h), p1 = toScreen(ax.x, ax.y, zOf(top), w, h);
    c.font = '12px system-ui'; c.lineWidth = 1.2; c.strokeStyle = '#333'; c.fillStyle = '#333'; c.textBaseline = 'middle';
    c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); c.stroke();
    const tick = (d, col, label) => {
      const p = toScreen(ax.x, ax.y, zOf(d), w, h);
      c.strokeStyle = col; c.fillStyle = col; c.beginPath(); c.moveTo(p.x - 6, p.y); c.lineTo(p.x, p.y); c.stroke();
      c.textAlign = 'right'; c.fillText(label, p.x - 9, p.y);
    };
    const clearY = opts.clear > 0 && opts.clear < opts.max ? toScreen(ax.x, ax.y, zOf(opts.clear), w, h).y : null;
    for (let d = 0; d <= top + 1e-9; d += step) {
      const near = clearY != null && Math.abs(toScreen(ax.x, ax.y, zOf(d), w, h).y - clearY) < 16;   // the clearing label wins
      tick(d, '#333', near ? '' : `${+d.toPrecision(4)}`);
    }
    c.textAlign = 'center'; c.fillStyle = '#333'; c.fillText(opts.unit.startsWith('nm') ? `resist left (nm)` : opts.unit.startsWith('×') ? 'writing ÷ target' : `dose (${opts.unit})`, p1.x, p1.y - 16);
    if (opts.clear > 0 && opts.clear < opts.max) {
      c.font = '600 12px system-ui';
      const p = toScreen(ax.x, ax.y, zOf(opts.clear), w, h);
      c.strokeStyle = '#d11'; c.lineWidth = 2; c.beginPath(); c.moveTo(p.x - 12, p.y); c.lineTo(p.x + 4, p.y); c.stroke();
      // two lines ("clearing 50" / "(50 % of nominal)") and kept inside the canvas
      const lines = (opts.clearLabel || `clearing ${+opts.clear.toPrecision(3)}`).split(' (').map((t, k) => (k ? `(${t}` : t));
      const wMax = Math.max(...lines.map((t) => c.measureText(t).width)), room = p.x - 14 - 4;
      c.fillStyle = '#d11'; c.textAlign = wMax > room ? 'left' : 'right';
      const x = wMax > room ? 4 : p.x - 14;
      lines.forEach((t, k) => c.fillText(t, x, p.y + (k - (lines.length - 1) / 2) * 14));
    }
    // x / y extents along the two front edges
    if (opts.extent) {
      const fmt = (nm) => (nm >= 1000 ? `${+(nm / 1000).toPrecision(3)} µm` : `${+nm.toPrecision(3)} nm`);
      const front = corners.reduce((a, b) => (b.p.y > a.p.y ? b : a));
      c.font = '12px system-ui'; c.fillStyle = '#333'; c.textAlign = 'center'; c.textBaseline = 'top';
      const mx = toScreen(0, front.y, 0, w, h), my = toScreen(front.x, 0, 0, w, h);
      c.fillText(fmt(opts.extent[0]), mx.x, mx.y + 6);
      c.fillText(fmt(opts.extent[1]), my.x, my.y + 6);
    }
  }

  // orbit / pan / zoom
  let drag = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey, cam: { ...cam } }; e.preventDefault(); });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (drag.pan) {
      const s = cam.dist / 600;
      cam.tx = drag.cam.tx - (dx * Math.sin(cam.az) + dy * Math.cos(cam.az)) * s * -1;
      cam.ty = drag.cam.ty - (-dx * Math.cos(cam.az) + dy * Math.sin(cam.az)) * s * -1;
    } else { cam.az = drag.cam.az - dx * 0.008; cam.el = Math.max(0.05, Math.min(1.55, drag.cam.el + dy * 0.006)); }
    draw();
  });
  window.addEventListener('mouseup', () => { drag = null; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = Math.max(0.6, Math.min(20, cam.dist * (e.deltaY > 0 ? 1.1 : 0.9))); draw(); }, { passive: false });

  return {
    maxTex,
    setField(data, nx, ny) { upload('main', data, nx, ny); opts.aspect = nx / ny; },
    setTarget(data, nx, ny) { if (data) upload('target', data, nx, ny); else dims.target = null; },
    setOptions(o) { Object.assign(opts, o); },
    getOptions() { return { ...opts }; },
    resetCamera() { Object.assign(cam, { az: -0.9, el: 0.62, dist: 3.1, tx: 0, ty: 0 }); },
    draw,
  };
}
