// WebXR: the same scene in a Meta Quest 2/3 (Quest Browser, or desktop Chrome with Quest Link).
//
// The scene stays in solar radii. The headset camera sits in a RIG whose scale says how many solar
// radii one metre of the room is, so walking, the stereo baseline and the controllers all follow
// one number (shown as "1 R☉ = x m"). Each view sets a comfortable scale; the left stick changes it.
//
// Controls (xr-standard gamepad):
//   right stick   fly along the right controller's ray (speed grows with height above the Sun)
//   left stick    forward/back: world bigger/smaller · left/right: snap turn 30°
//   grip (either) grab the world and move it
//   right trigger aim: live read-out of what the ray hits (same numbers as the desktop hover)
//   A next instrument · B next view · X flare + CME · Y cutaway · left trigger listen
//   thumbstick press: right = T-map, left = field lines
import * as THREE from 'three';
import { LITE } from './glsl.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
// metres per solar radius for each view (how large the Sun feels)
const VIEW_M = { overview: 1.2, interior: 1.4, core: 2.5, convection: 2.2, photosphere: 18, sunspots: 9, corona: 2.2, wind: 0.22 };
const TABLE_M = 0.18;   // passthrough (AR) start: a Sun 36 cm across, floating in the room
const STAR_M = 600;     // the star sphere is kept this many metres away whatever the scale

// ------------------------------------------------------------------ canvas text panels
function makePanel(wPx, hPx, wM) {
  const c = document.createElement('canvas'); c.width = wPx; c.height = hPx;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wM, wM * hPx / wPx), mat);
  mesh.renderOrder = 999; mesh.frustumCulled = false;
  return { c, g: c.getContext('2d'), tex, mesh, key: '' };
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function wrap(g, text, x, y, maxW, lh, maxLines = 4) {
  const words = String(text).split(/\s+/); let line = '', n = 0;
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y); y += lh; line = w; if (++n >= maxLines - 1) { /* last line */ } }
    else line = t;
    if (n >= maxLines) return y;
  }
  if (line) { g.fillText(line, x, y); y += lh; }
  return y;
}
const FONT = '"Segoe UI", system-ui, sans-serif';

// the desktop read-out cards are small HTML; draw their parts on a canvas
const _div = typeof document !== 'undefined' ? document.createElement('div') : null;
function drawCard(p, html) {
  const { c, g } = p; const W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  if (!html) return;
  _div.innerHTML = html;
  const title = _div.querySelector('.tip-h')?.textContent || '';
  const sub = _div.querySelector('.tip-s')?.textContent || '';
  const rows = [..._div.querySelectorAll('.tip-r')].map((r) => [r.querySelector('span')?.textContent || '', r.querySelector('b')?.textContent || '', r.classList.length > 1]);
  const note = _div.querySelector('.tip-n')?.textContent || '';
  roundRect(g, 4, 4, W - 8, H - 8, 22); g.fillStyle = 'rgba(14,10,8,0.86)'; g.fill();
  g.strokeStyle = 'rgba(240,150,60,0.55)'; g.lineWidth = 3; g.stroke();
  let y = 50; const x = 26, mw = W - 52;
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff3e4'; g.font = `600 34px ${FONT}`; y = wrap(g, title, x, y, mw, 40, 2);
  if (sub) { g.fillStyle = '#c8b6a4'; g.font = `24px ${FONT}`; y = wrap(g, sub, x, y + 2, mw, 30, 2) + 4; }
  for (const [k, v, hl] of rows) {
    if (y > H - 30) break;
    g.font = `22px ${FONT}`; g.fillStyle = hl ? '#ffcf8a' : '#b8a594'; g.fillText(k, x, y + 6);
    g.font = `600 26px ${FONT}`; g.fillStyle = hl ? '#ffd9a0' : '#f3ebe2';
    const tw = g.measureText(v).width; g.fillText(v, Math.max(x + 200, W - 26 - tw), y + 6);
    y += 36;
  }
  if (note && y < H - 40) { g.fillStyle = '#d9c3a8'; g.font = `italic 22px ${FONT}`; wrap(g, note, x, y + 10, mw, 28, Math.floor((H - y - 20) / 28)); }
}

// ------------------------------------------------------------------ module
export function createXR(ctx) {
  const { renderer, scene, camera, controls, S, views, viewPose, VIEW_KEYS, VIEW_NAMES, FILTERS, FILTER_NOTE, stars, act } = ctx;
  const xr = renderer.xr;
  xr.enabled = true;
  xr.setReferenceSpaceType('local');
  xr.setFoveation(1);
  const fbScale = parseFloat(new URLSearchParams(location.search).get('xrscale') || '1');
  if (fbScale > 0 && fbScale !== 1) xr.setFramebufferScaleFactor(fbScale);

  const rig = new THREE.Group(); rig.name = 'xr-rig';
  let mode = null;   // 'vr' | 'ar' while presenting
  let saved = null;
  let msg = '', msgT = 0;
  const pressed = [new Set(), new Set()];

  // controllers (ray) + grips; children are in metres because the rig carries the scale
  const ctrls = [0, 1].map((i) => {
    const c = xr.getController(i);
    const grip = xr.getControllerGrip(i);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.7, toneMapped: false, depthTest: false }));
    line.scale.z = 3; line.renderOrder = 998; line.frustumCulled = false;
    c.add(line);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.11, 16).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x3a3430, toneMapped: false }));
    grip.add(body);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd080, toneMapped: false, depthTest: false }));
    dot.renderOrder = 999; dot.visible = false; c.add(dot);
    const st = { c, grip, line, dot, handedness: '', gamepad: null, grab: null };
    c.addEventListener('connected', (e) => { st.handedness = e.data.handedness; st.gamepad = e.data.gamepad || null; });
    c.addEventListener('disconnected', () => { st.gamepad = null; st.handedness = ''; });
    rig.add(c, grip);
    return st;
  });
  const hand = (h) => ctrls.find((s) => s.handedness === h);

  // wrist status panel (left) and read-out card (right)
  const status = makePanel(640, 400, 0.20);
  const card = makePanel(640, 420, 0.21);
  status.mesh.position.set(0, 0.075, 0.02); status.mesh.rotation.x = -0.75;
  card.mesh.position.set(0, 0.13, -0.05); card.mesh.rotation.x = -0.45;
  card.mesh.visible = false;

  // comfort fade for view jumps (child of the head)
  const fade = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }));
  fade.position.z = -0.12; fade.renderOrder = 1000; fade.frustumCulled = false;
  let fadeT = 0, pendingView = null;

  // ---------------------------------------------------------------- placement
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
  const metresPerR = () => 1 / rig.scale.x;
  function headWorld(out = new THREE.Vector3()) { camera.updateMatrixWorld(true); return out.setFromMatrixPosition(camera.matrixWorld); }
  // put the rig so that an eye at the rig origin is at p looking at t (the head starts near the
  // origin of a 'local' reference space)
  function placeRig(p, t, mPerR) {
    rig.scale.setScalar(1 / mPerR);
    _m.lookAt(p, t, new THREE.Vector3(0, 1, 0));
    rig.quaternion.setFromRotationMatrix(_m);
    // the user may be facing anywhere in the room: turn the rig so the target is ahead of their eyes
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    if (f.x * f.x + f.z * f.z > 1e-6) rig.quaternion.multiply(_q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(-f.x, -f.z)));
    rig.position.copy(p);
    // subtract the head's current offset inside the rig, so the eye (not the floor origin) lands on p
    rig.updateMatrixWorld(true);
    const h = headWorld(_v);
    rig.position.add(_w.copy(p).sub(h));
    rig.updateMatrixWorld(true);
  }
  function goView(name) {
    pendingView = name; fadeT = 0.0001;
  }
  function applyView(name) {
    const v = views[name]; if (!v) return;
    const { p, t } = viewPose(v);
    if (mode === 'ar' && name === 'overview') {
      // passthrough: a small Sun about 0.8 m in front of you
      placeRig(t.clone().add(new THREE.Vector3(0, 0, 0.8 / TABLE_M)), t, TABLE_M);
    } else placeRig(p, t, VIEW_M[name] || 1.2);
  }
  // rotate the rig about the head (snap turn) or about the Sun's axis (co-rotation)
  function rotateRigAbout(point, axis, ang) {
    _q.setFromAxisAngle(axis, ang);
    rig.position.sub(point).applyQuaternion(_q).add(point);
    rig.quaternion.premultiply(_q);
    rig.updateMatrixWorld(true);
  }
  function scaleRigAbout(point, f) {
    const s = clamp(rig.scale.x * f, 1 / 400, 1 / 0.015);
    const k = s / rig.scale.x;
    rig.position.sub(point).multiplyScalar(k).add(point);
    rig.scale.setScalar(s);
    rig.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------- session
  async function start(kind) {
    if (!navigator.xr || mode) return;
    const type = kind === 'ar' ? 'immersive-ar' : 'immersive-vr';
    let session;
    try {
      session = await navigator.xr.requestSession(type, { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    } catch (e) { ctx.onMessage?.('Could not start ' + type + ': ' + e.message); return; }
    saved = { pos: camera.position.clone(), quat: camera.quaternion.clone(), tgt: controls.target.clone(), near: camera.near, far: camera.far, clear: renderer.getClearAlpha() };
    mode = kind === 'ar' ? 'ar' : 'vr';
    controls.enabled = false;
    scene.add(rig); rig.add(camera);
    camera.position.set(0, 0, 0); camera.quaternion.identity();
    camera.near = 0.01; camera.far = 4000; camera.updateProjectionMatrix();
    camera.add(fade);
    const L = hand('left') || ctrls[0];
    if (mode === 'ar') { renderer.setClearColor(0x000000, 0); stars.visible = false; }
    useBaseLayer(session);
    await xr.setSession(session);
    session.addEventListener('end', end);
    // start where the desktop camera was, at the current view's scale
    // start at the current view's own pose (the desktop camera may be mid-flight); a free camera keeps its place
    const cv = ctx.currentView();
    if (mode === 'ar') { ctx.act.view('overview'); applyView('overview'); }
    else if (cv && views[cv]) applyView(cv);
    else placeRig(saved.pos, saved.tgt, 1.2);
    say(mode === 'ar' ? 'Passthrough: the Sun in your room' : 'Welcome aboard - B changes view, A the instrument');
    void L;
  }
  function end() {
    if (!mode) return;
    mode = null;
    camera.remove(fade);
    rig.remove(camera); scene.remove(rig);
    camera.position.copy(saved.pos); camera.quaternion.copy(saved.quat); camera.scale.set(1, 1, 1);
    controls.target.copy(saved.tgt);
    camera.near = saved.near; camera.far = saved.far;
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setClearColor(0x000000, saved.clear);
    stars.visible = true; stars.position.set(0, 0, 0); stars.scale.setScalar(1);
    controls.enabled = true; controls.update();
    ctx.onEnd?.();
  }

  // ---------------------------------------------------------------- input
  function say(s) { msg = s; msgT = 5; }
  function edge(st, i, idx) {
    const b = st.gamepad?.buttons[idx];
    const down = !!(b && b.pressed);
    const set = pressed[i];
    const was = set.has(idx);
    if (down && !was) { set.add(idx); return true; }
    if (!down && was) set.delete(idx);
    return false;
  }
  const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
  function ctrlRay(st) {
    st.c.updateMatrixWorld(true);
    _o.setFromMatrixPosition(st.c.matrixWorld);
    _d.set(0, 0, -1).transformDirection(st.c.matrixWorld);
    return { o: _o.clone(), d: _d.clone() };
  }
  let snapReady = true, viewIdx = 0, lastCardKey = '';

  function update(dt) {
    if (!mode) return;
    const head = headWorld(new THREE.Vector3());
    const R = hand('right') || ctrls[1], Lh = hand('left') || ctrls[0];

    // ---- view jump with a short fade
    if (fadeT > 0) {
      fadeT += dt;
      const half = 0.18;
      if (pendingView && fadeT >= half) { applyView(pendingView); pendingView = null; }
      fade.material.opacity = fadeT < half ? fadeT / half : Math.max(0, 1 - (fadeT - half) / half);
      if (fadeT > 2 * half) { fadeT = 0; fade.material.opacity = 0; }
    }

    // ---- sticks
    const ax = (st, k) => (st?.gamepad?.axes?.[k] || 0);
    const dz = (x) => (Math.abs(x) < 0.15 ? 0 : (x - Math.sign(x) * 0.15) / 0.85);
    const ry = dz(ax(R, 3)), rx = dz(ax(R, 2));
    if (ry || rx) {
      const { d } = ctrlRay(R);
      const right = new THREE.Vector3(1, 0, 0).transformDirection(R.c.matrixWorld);
      const speed = Math.max(0.02, Math.abs(head.length() - 1)) * 0.9 + 0.02;
      rig.position.addScaledVector(d, -ry * speed * dt).addScaledVector(right, rx * speed * dt);
    }
    const ly = dz(ax(Lh, 3)), lx = dz(ax(Lh, 2));
    if (ly) scaleRigAbout(head, Math.exp(ly * dt * 1.4));   // stick forward (y < 0) = bigger Sun
    if (Math.abs(lx) > 0.7) {
      if (snapReady) { rotateRigAbout(head, new THREE.Vector3(0, 1, 0).applyQuaternion(rig.quaternion).normalize(), -Math.sign(lx) * Math.PI / 6); snapReady = false; }
    } else if (Math.abs(lx) < 0.3) snapReady = true;

    // ---- grab the world with either grip
    for (const st of ctrls) {
      const g = st.gamepad?.buttons[1]?.pressed;
      st.c.updateMatrixWorld(true);
      const pw = new THREE.Vector3().setFromMatrixPosition(st.c.matrixWorld);
      if (g && !st.grab) st.grab = pw;
      else if (g && st.grab) { rig.position.add(st.grab.clone().sub(pw)); rig.updateMatrixWorld(true); }
      else if (!g) st.grab = null;
    }

    // ---- buttons (index: 0 trigger, 1 grip, 3 stick, 4 A/X, 5 B/Y)
    ctrls.forEach((st, i) => {
      if (!st.gamepad) return;
      const right = st.handedness !== 'left';
      if (edge(st, i, 4)) { if (right) { act.nextFilter(); say(FILTERS[S.filter]); } else { act.cme(); say('Flare + CME launched'); } }
      if (edge(st, i, 5)) { if (right) { viewIdx = (VIEW_KEYS.indexOf(ctx.currentView()) + 1) % VIEW_KEYS.length; act.view(VIEW_KEYS[viewIdx]); say(VIEW_NAMES[VIEW_KEYS[viewIdx]]); } else { act.toggle('cut'); say(S.cut ? 'Cutaway on' : 'Cutaway off'); } }
      if (edge(st, i, 3)) { if (right) { act.toggle('tmap'); say(S.tmap ? 'Temperature map on' : 'Temperature map off'); } else { act.toggle('field'); say(S.field ? 'Field lines on' : 'Field lines off'); } }
      if (!right && edge(st, i, 0)) { act.sound(); }
      if (right) edge(st, i, 0);
    });

    // ---- stars stay at "infinity"
    stars.position.copy(head);
    stars.scale.setScalar((STAR_M * rig.scale.x) / 1400);

    // ---- right-hand ray: read-out
    let html = null;
    for (const st of ctrls) { st.line.visible = !!st.gamepad && st.handedness !== 'left'; st.dot.visible = false; }
    const aim = R?.gamepad;
    if (aim) {
      const trig = (R.gamepad.buttons[0]?.value || 0) > 0.2;
      const { o, d } = ctrlRay(R);
      const hit = trig ? ctx.pickRay(o, d) : null;
      const local = hit && isFinite(hit.dist) ? hit.dist / rig.scale.x : 3;
      R.line.scale.z = clamp(local, 0.05, 6);
      R.line.material.opacity = trig ? 0.9 : 0.35;
      if (hit && isFinite(hit.dist)) { R.dot.visible = true; R.dot.position.set(0, 0, -R.line.scale.z); }
      html = hit ? hit.html : null;
      if (R.card !== R.c) { R.c.add(card.mesh); R.card = R.c; }
    }
    card.mesh.visible = !!html;
    if (html && html !== lastCardKey) { drawCard(card, html); card.tex.needsUpdate = true; lastCardKey = html; }

    // ---- wrist panel
    if (Lh?.gamepad && Lh.statusOn !== Lh.grip) { Lh.grip.add(status.mesh); Lh.statusOn = Lh.grip; }
    msgT -= dt;
    const key = [Math.round(fps), Math.round(rtScale * 100), ctx.currentView(), S.filter, S.cut, S.tmap, S.field, S.cycleYear?.toFixed(1), metresPerR().toPrecision(2), msgT > 0 ? msg : ''].join('|');
    if (key !== status.key) { drawStatus(); status.key = key; }
  }

  function drawStatus() {
    const { c, g } = status; const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    roundRect(g, 4, 4, W - 8, H - 8, 22); g.fillStyle = 'rgba(14,10,8,0.85)'; g.fill();
    g.strokeStyle = 'rgba(240,150,60,0.4)'; g.lineWidth = 3; g.stroke();
    const x = 26; let y = 52;
    g.fillStyle = '#fff3e4'; g.font = `650 36px ${FONT}`; g.fillText('The Sun', x, y);
    g.fillStyle = '#c8b6a4'; g.font = `24px ${FONT}`; g.fillText(`1 R☉ = ${metresPerR().toPrecision(2)} m`, x + 170, y);
    y += 44;
    const rowS = (k, v) => { g.font = `20px ${FONT}`; g.fillStyle = '#a8968a'; g.fillText(k.toUpperCase(), x, y); g.font = `600 26px ${FONT}`; g.fillStyle = '#f3ebe2'; g.fillText(v, x + 130, y); y += 36; };
    rowS('View', VIEW_NAMES[ctx.currentView()] || 'free');
    rowS('Filter', FILTERS[S.filter]);
    g.font = `21px ${FONT}`; g.fillStyle = '#c9b39c'; g.fillText(FILTER_NOTE[S.filter], x + 130, y - 8); y += 22;
    rowS('Cycle', `year ${(S.cycleYear ?? 0).toFixed(1)} · ${S.phase || ''}`);
    g.font = `20px ${FONT}`; g.fillStyle = '#9d8b7e';
    g.fillText('A instrument · B view · trigger: read-out', x, y + 8);
    g.fillText('X flare · Y cutaway · L-trigger listen · grip: grab', x, y + 36);
    g.fillStyle = '#7f7268'; g.fillText(`${Math.round(fps)} fps · resolution ${Math.round(rtScale * 100)} %${canHalf ? '' : ' · 8-bit'}`, x, y + 64);
    if (msgT > 0 && msg) { g.fillStyle = '#ffcf8a'; g.font = `600 24px ${FONT}`; g.fillText(msg, x, H - 22); }
    status.tex.needsUpdate = true;
  }

// ---------------------------------------------------------------- render
  // As on the desktop, the scene is drawn into a linear half-float target and tone mapping + sRGB
  // are applied ONCE to the finished image (per eye, by a quad in front of the head). Converting
  // each additive layer on its own would make faint glows far too bright over the disc.
  // A Quest draws on a phone-class GPU: the scene is rendered at a FRACTION of the headset's
  // resolution (rtScale), adapted to the frame rate, without MSAA, and the quad scales it up.
  // At full resolution the photosphere shader can stall the GPU until the browser drops the WebGL
  // context (a dark headset). Half float only where the GPU can render to it.
  const ext = renderer.extensions;
  const canHalf = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
  const rt = new THREE.WebGLRenderTarget(16, 16, { type: canHalf ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: LITE ? 0 : 4 });
  const Qs = new URLSearchParams(location.search);
  const SCALE_MAX = parseFloat(Qs.get('xrrt') || (LITE ? '0.8' : '1'));
  let rtScale = Math.min(SCALE_MAX, LITE ? (Qs.get('safe') === '1' ? 0.4 : 0.55) : 1);
  let lastT = 0, ema = 0, nextAdapt = 0, fps = 0;
  const _vps = [], _fb = new THREE.Vector2();
  const post = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    uniforms: { tMap: { value: rt.texture }, uSize: { value: new THREE.Vector2(16, 16) } },
    vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `uniform sampler2D tMap; uniform vec2 uSize;
      void main(){
        vec4 c = texture2D(tMap, gl_FragCoord.xy / uSize);
        gl_FragColor = vec4(c.rgb, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        // passthrough: glows must stay visible over the room, so alpha follows brightness
        gl_FragColor.a = clamp(max(c.a, max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b))), 0., 1.);
      }`,
    depthTest: false, depthWrite: false,
  }));
  quad.frustumCulled = false; quad.matrixAutoUpdate = false;
  post.add(quad);
  const _qm = new THREE.Matrix4().makeTranslation(0, 0, -0.05).multiply(new THREE.Matrix4().makeScale(2, 2, 1));
  function render() {
    const bl = xr.getBaseLayer();
    renderer.getDrawingBufferSize(_fb);   // three sizes the renderer to the headset framebuffer while presenting
    const w = bl?.framebufferWidth || bl?.textureWidth || _fb.x || 2, h = bl?.framebufferHeight || bl?.textureHeight || _fb.y || 2;
    adapt();
    const rw = Math.max(2, Math.round(w * rtScale)), rh = Math.max(2, Math.round(h * rtScale));
    if (rt.width !== rw || rt.height !== rh) rt.setSize(rw, rh);
    quad.material.uniforms.uSize.value.set(w, h);   // the quad runs on the headset framebuffer
    // three sets each eye's viewport in framebuffer pixels: scale them to the smaller target
    const cams = xr.getCamera().cameras;
    for (let i = 0; i < cams.length; i++) {
      const v = cams[i].viewport; if (!v) continue;
      (_vps[i] ||= new THREE.Vector4()).copy(v);
      v.set(Math.round(v.x * rtScale), Math.round(v.y * rtScale), Math.round(v.z * rtScale), Math.round(v.w * rtScale));
    }
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    for (let i = 0; i < cams.length; i++) if (cams[i].viewport && _vps[i]) cams[i].viewport.copy(_vps[i]);
    // the quad sits 5 cm in front of the head (in rig metres), filling both eyes' views
    quad.matrix.multiplyMatrices(camera.matrixWorld, _qm); quad.matrixWorldNeedsUpdate = true;   // no parent: world = matrix
    renderer.setRenderTarget(null);
    renderer.render(post, camera);
  }

  // frame-rate driven resolution: below ~75 % of the headset's rate, render fewer pixels
  function adapt() {
    const t = performance.now();
    if (lastT) { const d = Math.min(500, t - lastT); ema = ema ? ema * 0.9 + d * 0.1 : d; }
    lastT = t;
    if (!ema || t < nextAdapt) return;
    const target = 1000 / (xr.getSession()?.frameRate || 72);
    fps = 1000 / ema;
    if (ema > target * 1.35 && rtScale > 0.3) { rtScale = Math.max(0.3, rtScale * 0.8); nextAdapt = t + 1500; }
    else if (ema < target * 1.12 && rtScale < SCALE_MAX) { rtScale = Math.min(SCALE_MAX, rtScale * 1.08); nextAdapt = t + 4000; }
    else nextAdapt = t + 1000;
  }

  // co-rotation with the Sun in Sun-frame views
  function corotate(dA) { if (mode) rotateRigAbout(new THREE.Vector3(), _Y, dA); }

  return {
    start, goView, update, corotate, render,
    get presenting() { return !!mode; },
    get mode() { return mode; },
    say,
    debug: () => ({ mode, card: card.mesh.visible, cardText: lastCardKey.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120),
      mPerR: metresPerR(), rig: rig.position.toArray().map((x) => +x.toFixed(3)), head: headWorld().toArray().map((x) => +x.toFixed(3)),
      ctrls: ctrls.map((s) => s.handedness + (s.gamepad ? '+gp' : '')), fade: fade.material.opacity, rtScale, rt: [rt.width, rt.height], fps,
      ray: (() => { const st = hand('right'); if (!st) return null; const r = ctrlRay(st); return { o: r.o.toArray(), d: r.d.toArray() }; })() }),
  };
}

// The Quest Browser offers WebXR layers without being asked, and three.js then draws into a
// projection layer (per-eye sub-images, possibly a texture array) instead of the XRWebGLLayer
// framebuffer this module renders through - in the headset: a black screen. Hiding renderState.layers
// keeps three on the base layer, as the emulator (no layers) always was.
function useBaseLayer(session) {
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(session), 'renderState');
  if (!desc || !desc.get) return;
  Object.defineProperty(session, 'renderState', { configurable: true, get() {
    const r = desc.get.call(session);
    return new Proxy(r, { get(t, k) { if (k === 'layers') return undefined; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; } });
  } });
}
// buttons on the page: shown only where the browser offers immersive sessions
export async function xrSupport() {
  const out = { vr: false, ar: false };
  if (!navigator.xr) return out;
  try { out.vr = await navigator.xr.isSessionSupported('immersive-vr'); } catch (e) { /* not offered */ }
  try { out.ar = await navigator.xr.isSessionSupported('immersive-ar'); } catch (e) { /* not offered */ }
  return out;
}
