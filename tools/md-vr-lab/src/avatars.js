// The other person in the lab: a head with a visor, a floating body, a name tag, two hands (VR) or a pointer ray (desktop).
// Poses arrive in the *structure's* coordinates (Angstrom, the `inner` group), so both people see the same thing wherever they stand,
// even when one is in the lab and the other walks on the structure: the avatar is drawn at the sender's size relative to the structure
// (k = my metres per Angstrom / the sender's metres per Angstrom).
import * as THREE from 'three';

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(), _m = new THREE.Matrix4(), _o = new THREE.Vector3(), _d = new THREE.Vector3();
const hueCol = (h, l = 0.6) => new THREE.Color().setHSL(h, 0.75, l);

function tagTexture(name, role, hue) {
  const cv = document.createElement('canvas'); cv.width = 320; cv.height = 90; const c = cv.getContext('2d');
  c.fillStyle = 'rgba(8,14,28,0.82)'; c.beginPath(); c.roundRect(2, 2, 316, 86, 20); c.fill();
  c.strokeStyle = '#' + hueCol(hue).getHexString(); c.lineWidth = 4; c.stroke();
  c.textAlign = 'center'; c.fillStyle = '#ffffff'; c.font = '700 40px system-ui,sans-serif'; c.fillText(name.slice(0, 14), 160, 44);
  c.fillStyle = '#' + hueCol(hue, 0.75).getHexString(); c.font = '24px system-ui,sans-serif'; c.fillText(role, 160, 76);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class AvatarSet {
  constructor(scene, makeHand) { this.scene = scene; this.makeHand = makeHand; this.map = new Map(); }
  _make(id, name, role) {
    let hue = 0; for (const ch of id) hue = (hue * 31 + ch.charCodeAt(0)) % 360; hue /= 360;
    const col = hueCol(hue), g = new THREE.Group(); g.visible = false; this.scene.add(g);
    const skin = new THREE.MeshLambertMaterial({ color: col, emissive: col.clone().multiplyScalar(0.25) });
    const head = new THREE.Group(); head.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), skin));
    const visor = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshBasicMaterial({ color: 0x0a1628 })); visor.scale.set(0.078, 0.04, 0.05); visor.position.set(0, 0.01, -0.072); head.add(visor);
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.008, 0.004), new THREE.MeshBasicMaterial({ color: 0x9fe8ff })); eyes.position.set(0, 0.014, -0.117); head.add(eyes);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.34, 4, 12), new THREE.MeshLambertMaterial({ color: col, transparent: true, opacity: 0.32, depthWrite: false }));
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTexture(name, role, hue), transparent: true, depthWrite: false, fog: false })); tag.renderOrder = 20;
    const hands = [this.makeHand(), this.makeHand()]; hands[0].group.scale.x = -1;
    const lasers = [0, 1].map(() => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.85 })); l.visible = false; return l; });
    const cursor = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), new THREE.MeshBasicMaterial({ color: col })); cursor.visible = false;
    for (const o of [head, body, tag, hands[0].group, hands[1].group, lasers[0], lasers[1], cursor]) g.add(o);
    const a = { id, name, role, hue, g, head, body, tag, hands, lasers, cursor, tex: tag.material.map, msg: null, cur: null };
    this.map.set(id, a); return a;
  }
  setPose(id, name, role, msg) {
    let a = this.map.get(id) || this._make(id, name, role);
    if (a.name !== name || a.role !== role) { a.name = name; a.role = role; a.tex.dispose(); a.tag.material.map = tagTexture(name, role, a.hue); a.tex = a.tag.material.map; a.tag.material.needsUpdate = true; }
    a.msg = msg; if (!a.cur) a.cur = { head: msg.head.slice(), hands: msg.hands.map((h) => (h ? h.slice() : null)), ray: msg.ray ? msg.ray.slice() : null }; a.t = performance.now();
  }
  remove(id) { const a = this.map.get(id); if (!a) return; this.scene.remove(a.g); a.g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); this.map.delete(id); }
  clear() { for (const id of [...this.map.keys()]) this.remove(id); }
  // place every avatar: inner = the structure's group (its matrixWorld maps Angstrom to the world), myScale = metres per Angstrom here
  update(dt, inner, myScale) {
    inner.updateWorldMatrix(true, false); inner.matrixWorld.decompose(_p, _q2, _s);
    const k = 1 - Math.exp(-dt * 16);
    for (const a of this.map.values()) {
      const m = a.msg; if (!m) continue; if (performance.now() - a.t > 4000) { a.g.visible = false; continue; } a.g.visible = true;
      const c = a.cur, sc = myScale / (m.s || myScale);
      const lerpArr = (cu, tg) => { for (let i = 0; i < 3; i++) cu[i] += (tg[i] - cu[i]) * k; _q.set(cu[3], cu[4], cu[5], cu[6]); _q2.set(tg[3], tg[4], tg[5], tg[6]); _q.slerp(_q2, k); cu[3] = _q.x; cu[4] = _q.y; cu[5] = _q.z; cu[6] = _q.w; };
      lerpArr(c.head, m.head);
      const place = (obj, arr, scale) => { _o.set(arr[0], arr[1], arr[2]).applyMatrix4(inner.matrixWorld); inner.matrixWorld.decompose(_p, _q2, _s); obj.position.copy(_o); obj.quaternion.copy(_q2).multiply(_q.set(arr[3], arr[4], arr[5], arr[6])); obj.scale.setScalar(scale); };
      place(a.head, c.head, sc); a.head.getWorldPosition(_o);
      a.body.position.copy(_o).add(_d.set(0, -0.34 * sc, 0)); a.body.scale.setScalar(sc); a.body.quaternion.identity();
      a.tag.position.copy(_o).add(_d.set(0, 0.27 * sc, 0)); a.tag.scale.set(0.56 * sc, 0.157 * sc, 1);
      for (let i = 0; i < 2; i++) {
        const h = m.hands[i], hm = a.hands[i].group, L = a.lasers[i];
        if (h) {
          if (!c.hands[i]) c.hands[i] = h.slice(); lerpArr(c.hands[i], h); place(hm, c.hands[i], sc); hm.visible = true;
          const t = m.fin ? m.fin[i * 2] : 0, gr = m.fin ? m.fin[i * 2 + 1] : 0, P = a.hands[i].pose; P.index = 0.1 + 0.8 * t; P.thumb = 0.15 + 0.6 * t; P.others = Math.max(0.25, gr); a.hands[i].apply();
          L.visible = i === 1; if (L.visible) { L.position.copy(hm.position); L.quaternion.copy(hm.quaternion); L.scale.set(sc, sc, sc * 1.5); }
        } else { hm.visible = false; c.hands[i] = null; L.visible = false; }
      }
      a.cursor.visible = false;
      if (m.ray && !m.hands[1]) {                                                              // desktop: a ray from the pointer instead of hands
        if (!c.ray) c.ray = m.ray.slice(); for (let i = 0; i < 6; i++) c.ray[i] += (m.ray[i] - c.ray[i]) * k;
        _o.set(c.ray[0], c.ray[1], c.ray[2]).applyMatrix4(inner.matrixWorld); _d.set(c.ray[3], c.ray[4], c.ray[5]).transformDirection(inner.matrixWorld);
        const L = a.lasers[1]; L.visible = true; L.position.copy(_o); L.quaternion.setFromUnitVectors(_p.set(0, 0, -1), _d); L.scale.set(sc, sc, sc * 2.5);
        a.cursor.visible = true; a.cursor.position.copy(_o); a.cursor.scale.setScalar(sc * 1.5);
      }
    }
  }
}
