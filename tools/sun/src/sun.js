// The Sun itself: photosphere (granulation, limb darkening, sunspots, faculae, eight instruments),
// the two cut faces of the interior cutaway, the chromosphere shell and the corona billboard.
import * as THREE from 'three';
import { commonGLSL, cutGLSL } from './glsl.js';
import { SPOTS, AR_N, AR_S, dirLL, DEG } from './spec.js';
import { SSM_R, SSM_LOGT } from './model.js';

// uniforms shared by every Sun material (one object each, so one assignment reaches them all)
export const U = {
  uTime: { value: 0 },      // visual clock for granulation and flows (s)
  uFilter: { value: 0 },    // 0 white, 1 Hα, 2 He II 304, 3 Fe IX 171, 4 Fe XII 193, 5 magnetogram, 6 Doppler, 7 eclipse
  uCut: { value: 0 },       // interior cutaway on/off
  uTmap: { value: 0 },      // cut faces: 0 illustrative colours, 1 temperature map
  uGran: { value: 1 },      // granulation contrast
  uFlare: { value: 0 },     // flare brightening of the active region, decays to 0
  uAct: { value: 0.64 },    // solar-cycle activity 0..1 (shape of corona, coronal holes)
  uPolarN: { value: -1 },   // sign/strength of the north polar field (flips at maximum)
  uSpotVis: { value: 1 },   // spots and active regions fade out towards solar minimum
};

const V_SURF = /* glsl */`
varying vec3 vLocal; varying vec3 vWorld; varying vec3 vNW;
void main(){
  vLocal = position;
  vec4 w = modelMatrix * vec4(position, 1.);
  vWorld = w.xyz; vNW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// ------------------------------------------------------------------ photosphere
// Eight instruments, after the "Sun, alive" model (SunSim.html): 0 white light, 1 Hα,
// 2 He II 304 Å, 3 Fe IX 171 Å, 4 Fe XII 193 Å, 5 magnetogram, 6 Dopplergram, 7 total eclipse.
function photosphereMaterial() {
  const spots = SPOTS.map((s) => new THREE.Vector4(...dirLL(s.lat, s.lon), s.r * DEG));
  while (spots.length < 8) spots.push(new THREE.Vector4(0, 1, 0, 0));
  const pol = SPOTS.map((s) => s.pol);
  while (pol.length < 8) pol.push(0);
  const plage = [AR_N, AR_S].map((a) => new THREE.Vector4(...dirLL(a.lat, a.lon), a.plage * DEG));
  return new THREE.ShaderMaterial({
    uniforms: {
      ...U,
      uSpots: { value: spots }, uSpotPol: { value: pol }, uSpotN: { value: SPOTS.length },
      uPlage: { value: plage },
      uTint: { value: new THREE.Vector3(1.0, 0.68, 0.32) },
    },
    vertexShader: /* glsl */`
      varying vec3 vLocal; varying vec3 vWorld; varying vec3 vNW; varying vec3 vViewL;
      void main(){
        vLocal = position;
        vec4 w = modelMatrix * vec4(position, 1.);
        vWorld = w.xyz; vNW = normalize(mat3(modelMatrix) * normal);
        // the camera in the Sun's own frame, for line-of-sight velocities in the Dopplergram
        vViewL = (inverse(modelMatrix) * vec4(cameraPosition, 1.)).xyz - position;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      ${commonGLSL}
      ${cutGLSL}
      uniform float uTime, uFilter, uGran, uFlare, uAct, uPolarN, uSpotVis;
      uniform vec4 uSpots[8]; uniform float uSpotPol[8]; uniform int uSpotN;
      uniform vec4 uPlage[2];
      uniform vec3 uTint;
      varying vec3 vLocal; varying vec3 vWorld; varying vec3 vNW; varying vec3 vViewL;

      void main(){
        if (cutAway(vWorld)) discard;
        int mode = int(uFilter + .5);
        vec3 n = normalize(vLocal);
        vec3 V = normalize(cameraPosition - vWorld);
        float mu = clamp(dot(normalize(vNW), V), 0., 1.);
        if (mode == 7){ gl_FragColor = vec4(vec3(.006, .007, .010), 1.); return; }   // the Moon

        // sunspots: umbra, filamentary penumbra, and their line-of-sight field (gauss)
        float umbra = 0., pen = 0., fil = .5, Bsp = 0., halo = 0.;
        for (int i = 0; i < 8; i++){
          if (i >= uSpotN) break;
          vec4 s = uSpots[i];
          float sw = s.w * uSpotVis;                      // spots fade out towards solar minimum
          if (sw < 1e-4) continue;
          float c = dot(n, s.xyz);
          float a = acos(clamp(c, -1., 1.));
          float wh = max(sw * 2.6, .03);
          halo += uSpotPol[i] * exp(-pow(a / wh, 2.));    // plage keeps its spot's polarity
          if (a > sw * 1.4) continue;
          vec3 e1 = normalize(cross(s.xyz, vec3(0., 1., 0.)));
          vec3 e2 = cross(s.xyz, e1);
          vec3 v = n - s.xyz * c;
          float az = atan(dot(v, e2), dot(v, e1));
          float edge = sw * (1. + .16 * (vnoise(n * 1400.) - .5));
          float inP = 1. - smoothstep(edge * .9, edge * 1.04, a);
          float ur = s.w < .0087 ? .75 : .42;            // pores (< 0.5°) are nearly all umbra
          float inU = 1. - smoothstep(sw * (ur - .06), sw * (ur + .05), a);
          float f = .5 + .5 * sin(az * 110. + 5. * vnoise(vec3(cos(az) * 14., sin(az) * 14., a / sw * 4. + float(i))));
          f = mix(f, vnoise(vec3(cos(az) * 60., sin(az) * 60., a / sw * 2.)), .45);
          if (inP > pen) fil = f;
          float pi = inP * (1. - inU);
          pen = max(pen, pi);
          umbra = max(umbra, inU);
          Bsp += uSpotPol[i] * (pi * (900. + 900. * (1. - a / sw)) + inU * 2600.);
        }
        // plage (compact, bright in Hα/304) and the broader active-region corona (EUV)
        float pl = 0., arCor = 0.;
        for (int i = 0; i < 2; i++){
          float a = acos(clamp(dot(n, uPlage[i].xyz), -1., 1.));
          pl = max(pl, 1. - smoothstep(uPlage[i].w * .45, uPlage[i].w, a));
          arCor = max(arCor, exp(-pow(a / (uPlage[i].w * 1.25), 2.)));
        }
        pl *= (.55 + .9 * fbm(n * 70.)) * uSpotVis; arCor *= uSpotVis;
        float hole = holeAt(n, uAct);

        // supergranulation: network along the cell edges, outflow from each cell centre
        vec3 qn = n * 24.; qn += (vec3(vnoise(qn * .7), vnoise(qn * .7 + 5.2), vnoise(qn * .7 + 9.4)) - .5) * .9;
        vec3 rn; vec2 sg = worleyR(qn, uTime * .03, rn);
        float net = 1. - smoothstep(0., .2, sg.y - sg.x);
        float bead = smoothstep(.38, .78, vnoise(n * 170.));
        float netB = net * (.25 + .75 * bead) * (.55 + .45 * smoothstep(.25, .75, vnoise(n * 9. + 2.)));

        vec3 col;
        if (mode == 0){
          // granulation: cells of ~1000 km (1/700 R), faded out when smaller than a pixel
          vec3 p = n * 700.;
          float px = length(fwidth(p));
          float fine = 1. - smoothstep(.35, 1.1, px);
          float gran = .5;
          if (fine > .001){
            // warped lattice: rounded, irregular cells - bright centres (upflow), dark lanes
            vec3 q = p + (vec3(vnoise(p * .45), vnoise(p * .45 + 7.1), vnoise(p * .45 + 3.3)) - .5) * 1.1;
            vec2 w = worley(q, uTime);
            float g = smoothstep(.0, .42, w.y - w.x) * (1.25 - .9 * w.x);
            gran = mix(.5, clamp(g, 0., 1.), fine);
          }
          float meso = fbm(n * 55. + vec3(0., uTime * .02, 0.));
          // temperature -> intensity (∝ T⁴) and colour, Eddington limb darkening
          float T = 5772. + (gran - .5) * 700. * uGran + (meso - .5) * 140.;
          T = mix(T, 5230. + (fil - .5) * 520., pen);   // ≈ 0.75 of the (lane-darkened) quiet-Sun mean
          T = mix(T, 3950. + 320. * (vnoise(n * 900.) - .5), umbra);
          float fac = (pl + .15 * netB) * pow(1. - mu, 1.4) * 1.1;
          float I = (.4 + .6 * mu) * pow(T / 5772., 4.) * (1. + fac);
          // the visible layer lies higher and cooler towards the limb: T(τ = μ)
          float Tc = T * pow(.75 * (mu + .6667), .25) / 1.0567;
          col = toLin(bbColor(Tc)) * I * uTint * .92;
          col *= 1. + uFlare * 2.5 * pl;
        } else if (mode <= 4){
          float E, gain = 1.;
          if (mode == 1){
            // Hα: mottles and dark fibrils, bright network and plage, weak limb darkening
            float mot = fbm(n * 38. + vec3(0., uTime * .004, 0.));
            float fib = vnoise(vec3(n.xz * 90., n.y * 30.));
            float v = .36 + .20 * (mot - .5) - .10 * smoothstep(.55, .85, fib)
                    + .30 * netB * (.6 + .4 * mot) + .75 * pl * (.4 + .6 * netB + .3 * mot);
            v *= mix(1., .28, umbra) * mix(1., .65, pen * (1. - umbra));
            v *= .72 + .28 * pow(mu, .35);
            E = max(v, .03) + 2.2 * uFlare * pl; gain = 1.35;
          } else if (mode == 2){
            // He II 304 Å (≈ 50 000–80 000 K): chromospheric network and transition region
            float mot = fbm(n * 26.);
            float v = .18 + .12 * mot + .55 * netB * (.5 + .5 * mot) + 1.0 * pl;
            v *= (.85 + .25 * (1. - mu)) * (1. - .35 * hole);
            E = v + 3. * uFlare * pl; gain = 1.2;
          } else {
            // Fe IX 171 Å (≈ 0.7 MK) and Fe XII 193 Å (≈ 1.5 MK): optically thin corona seen on the
            // disc - brighter towards the limb, dark coronal holes, bright active-region corona and moss
            bool m171 = mode == 3;
            float H = m171 ? .05 : .09;
            float quiet = .30 + .25 * fbm(n * 13.) + (m171 ? .22 : .08) * netB;
            float moss = pl * netB * (m171 ? .6 : .3);
            float lb = pow(1. / max(mu, sqrt(2. * H / 3.14159)), .55);
            float v = ((m171 ? .30 : .42) * quiet + (m171 ? .9 : 1.6) * arCor + moss) * lb;
            v *= 1. - (m171 ? .55 : .85) * hole;
            E = v + 4. * uFlare * arCor;
          }
          col = toLin(modeRamp(mode, 1. - exp(-E * gain)));
        } else if (mode == 5){
          // magnetogram: line-of-sight field B∥ = B_r μ for nearly radial fields; grey = 0,
          // white = towards us, black = away. Saturates at about ±300 G.
          float pole = uPolarN * sign(n.y) * smoothstep(.62, .92, abs(n.y)) * netB;
          float netPol = tanh(4. * (vnoise(n * 5.) - .5));
          float elemPol = tanh(5. * (vnoise(n * 60. + 9.) - .5) + 2.5 * netPol);   // mixed-polarity network
          float Bn = elemPol * netB * 110. + pole * 120. + Bsp + halo * 260. * (.3 + .9 * netB) * uSpotVis
                   + (hash13(floor(n * 700.)) - .5) * 12.;
          col = toLin(vec3(.5 + .5 * tanh(Bn * mu / 320.)));
        } else {
          // Dopplergram: v∥ in km/s, red = away (redshift), blue = towards us
          vec3 rd = -normalize(vViewL);
          float s2 = n.y * n.y;
          float om = (14.713 - 2.396 * s2 - 1.787 * s2 * s2) / 14.713;
          vec3 vrot = om * 2. * vec3(n.z, 0., -n.x);                      // ≈ 2 km/s at the equator
          vec3 sgv = -rn;
          vec3 vsg = (sgv - n * dot(sgv, n)) * .45 - n * .06 * net;       // supergranule outflow
          float ph5 = fbm(n * 16. + 3.) * 9.;
          float pm = .30 * sin(uTime * 2.2 + ph5) * (.35 + .9 * smoothstep(.3, .8, fbm(n * 11. + 4.)));
          float vlos = dot(vrot + vsg + n * pm, rd);
          float x = clamp(vlos / 2.4, -1., 1.);
          vec3 red = vec3(.86, .22, .12), blu = vec3(.13, .36, .86), wht = vec3(.93);
          vec3 c = x > 0. ? mix(wht, red, pow(x, .75)) : mix(wht, blu, pow(-x, .75));
          col = toLin(c * (.55 + .45 * smoothstep(0., .25, mu)));
        }
        gl_FragColor = vec4(col, 1.);
      }`,
  });
}

// ------------------------------------------------------------------ cut faces
function cutFaceMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uR: { value: SSM_R }, uLT: { value: SSM_LOGT } },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      ${commonGLSL}
      uniform float uTime, uTmap, uCut, uFilter;
      uniform float uR[19]; uniform float uLT[19];
      varying vec3 vW;

      float logT(float r){
        float lt = uLT[18];
        for (int i = 0; i < 18; i++){
          if (r >= uR[i] && r < uR[i + 1]) lt = mix(uLT[i], uLT[i + 1], (r - uR[i]) / (uR[i + 1] - uR[i]));
        }
        return lt;
      }
      float ring(float r, float r0, float w){ return 1. - smoothstep(0., w, abs(r - r0)); }

      void main(){
        if (uCut < .5) discard;
        float r = length(vW);
        float h = vW.x + vW.z;               // in-plane horizontal coordinate (x or z is 0)
        float th = atan(vW.y, h);            // -π/2 .. π/2 across the half disc
        float fw = fwidth(r);
        vec3 col;

        if (uTmap > .5){
          // temperature map: log T from the solar-model table, isotherms every 0.25 dex
          float lt = logT(r);
          col = toLin(inferno((lt - 3.7613) / (7.1959 - 3.7613))) * 1.35;
          float q = lt * 4.; float d = min(fract(q), 1. - fract(q));
          col = mix(col, vec3(1.), .35 * (1. - smoothstep(0., fwidth(q) * 1.4, d)));
          float dash = step(.5, fract(th * 18.));
          col = mix(col, vec3(1.), .8 * dash * (ring(r, .25, fw * 1.6) + ring(r, .713, fw * 1.6)));
        } else {
          // illustrative colours: core, radiative zone, tachocline, convection zone
          vec3 cCore = vec3(1., .95, .78), cRad = vec3(1., .78, .36), cRad2 = vec3(1., .55, .16);
          float sr = smoothstep(.25, .71, r);
          col = mix(cRad, cRad2, sr) * (1.05 - .35 * sr);
          // radiation diffusing outwards: a fine, restless glow
          col *= .88 + .24 * vnoise(vec3(h * 70., vW.y * 70., uTime * 1.6));
          float core = 1. - smoothstep(.21, .27, r);
          col = mix(col, cCore * (1.7 - 1.6 * r), core);
          // fusion events: brief sparks
          vec3 g = vec3(h, vW.y, 0.) * 150.;
          float sp = hash13(floor(g) + floor(uTime * 7.) * 17.);
          float dd = length(fract(g.xy) - .5);
          col += core * vec3(3., 2.6, 1.8) * step(.985, sp) * (1. - smoothstep(.1, .45, dd));

          // convection: rolls rising and sinking, smaller near the surface
          float s = clamp((r - .713) / .287, 0., 1.);
          // two layers of rolls with a fixed cell count each (a count that varied with depth
          // would bend the cell walls into moiré), blended across mid-depth
          float x1 = (th / 3.14159 + .5) * 18., x2 = (th / 3.14159 + .5) * 54.;
          float k1 = floor(x1), u1 = fract(x1), k2 = floor(x2), u2 = fract(x2);
          float s1 = clamp(s / .62, 0., 1.), s2 = clamp((s - .55) / .45, 0., 1.);
          float up1 = (.5 + .5 * cos(3.14159 * (u1 + mod(k1, 2.)))) * (.55 + .45 * sin(3.14159 * s1));
          float up2 = (.5 + .5 * cos(3.14159 * (u2 + mod(k2, 2.)))) * (.55 + .45 * sin(3.14159 * s2));
          float f1 = vnoise(vec3(x1 * 3., s1 * 5. - uTime * .5 * (up1 * 2. - 1.), 1.7));
          float f2 = vnoise(vec3(x2 * 3., s2 * 5. - uTime * .9 * (up2 * 2. - 1.), 4.3));
          float lay = smoothstep(.5, .66, s);
          float up = mix(up1, up2, lay), flow = mix(f1, f2, lay);
          vec3 cc = vec3(.9, .30, .07) * (1.15 - .5 * s) * (.4 + .7 * up) * (.75 + .5 * flow);
          col = mix(col, cc, smoothstep(.700, .726, r));
          // tachocline: the shear layer at the base of the convection zone
          col += vec3(1., .55, .2) * .5 * ring(r, .712, .010);
        }
        // photosphere edge
        col = mix(col, vec3(1.3, 1.1, .8), ring(r, .997, .004));
        // instruments other than white light are shown without tone mapping: keep the faces in range
        if (uFilter > .5) col = col / (1. + col) * 1.35;
        gl_FragColor = vec4(col, 1.);
      }`,
  });
}

function buildCutFaces() {
  const mat = cutFaceMaterial();
  // face on the plane z = 0 covering x ≥ 0, and face on x = 0 covering z ≥ 0
  const gB = new THREE.CircleGeometry(0.9985, 160, -Math.PI / 2, Math.PI);
  const gA = new THREE.CircleGeometry(0.9985, 160, Math.PI / 2, Math.PI);
  gA.rotateY(Math.PI / 2);
  const g = new THREE.Group();
  const a = new THREE.Mesh(gA, mat), b = new THREE.Mesh(gB, mat);
  g.add(a, b);
  return { group: g, faces: [a, b], mat };
}

// ------------------------------------------------------------------ chromosphere
function chromosphereMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...U },
    vertexShader: V_SURF,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    fragmentShader: /* glsl */`
      ${commonGLSL}
      ${cutGLSL}
      uniform float uTime, uFilter;
      varying vec3 vLocal; varying vec3 vWorld; varying vec3 vNW;
      void main(){
        if (cutAway(vWorld) || behindMoon(vWorld, uFilter)) discard;
        vec3 V = normalize(cameraPosition - vWorld);
        float mu = abs(dot(normalize(vNW), V));
        float rim = pow(1. - mu, 5.);
        vec3 n = normalize(vLocal);
        float sp = fbm(n * 260. + vec3(0., uTime * .2, 0.));     // a forest of spicules
        float a = rim * (.35 + 1.4 * smoothstep(.45, .75, sp));
        int m = int(uFilter + .5);
        // pink in white light and at totality, red in Hα, orange in He II 304, faint in Fe IX/XII
        vec3 c = m == 0 ? vec3(1., .3, .4) * .22 : m == 1 ? vec3(1., .28, .16) * 1.2 : m == 2 ? vec3(1., .45, .1) * 1.1
               : m <= 4 ? vec3(1., .7, .3) * .3 : m == 7 ? vec3(1., .2, .4) * 1.3 : vec3(0.);
        gl_FragColor = vec4(c * a, 1.);
      }`,
  });
}

// ------------------------------------------------------------------ corona
// A camera-facing billboard through the Sun's centre. White light follows the Baumbach
// K-corona profile with helmet streamers over the equatorial belt and polar plumes; EUV
// falls off with a ~60 000 km scale height. Brightness is boosted enormously - the real
// corona is a millionth of the disc, which is why it is only seen in eclipses.
function coronaMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...U,
      uK: { value: 1 }, uScale: { value: 7 },
      uAxis: { value: new THREE.Vector2(0, 1) }, uAxisLen: { value: 1 },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: /* glsl */`
      ${commonGLSL}
      uniform float uTime, uFilter, uK, uScale, uAxisLen, uAct, uSpotVis;
      uniform vec2 uAxis;
      varying vec2 vUv;
      void main(){
        vec2 q = (vUv - .5) * 2. * uScale;
        float p = length(q);
        if (p < 1.) discard;
        int m = int(uFilter + .5);
        if (m == 5 || m == 6){ discard; }               // magnetogram, Dopplergram: photosphere only
        vec2 d = q / p;
        float ax = dot(d, uAxis);
        float lat = asin(clamp(ax, -1., 1.));
        float ang = atan(d.y, d.x);
        vec3 a3 = vec3(cos(ang), sin(ang), 0.);
        float rays = fbm(vec3(a3.xy * 7., p * .22 - uTime * .025));
        // the solar cycle reshapes the corona: a flat streamer belt and polar plumes at
        // minimum, streamers at all latitudes at maximum
        float w = mix(.26, .42, uAct) * (.5 + .65 / p);
        float warp = (vnoise(a3 * 1.6 + 3.) - .5) * (.25 + 1.2 * uAct);
        float belt = mix(.5, exp(-pow((lat - warp) / w, 2.)), uAxisLen);
        float rnd = smoothstep(.45, .8, fbm(a3 * 2.4 + 5.));
        float streamer = mix(belt * (.6 + .7 * vnoise(a3 * 4.)), rnd * 1.3 + belt * .35, pow(uAct, 1.5));
        float plumes = pow(abs(ax), 12.) * smoothstep(.45, .8, fbm(vec3(a3.xy * 40., p * .15))) * uAxisLen * (1.4 - uAct);
        float base = (.0532 * pow(p, -2.5) + 1.425 * pow(p, -7.) + 2.565 * pow(p, -17.)) / 4.04;
        vec3 col; float I;
        if (m == 0){
          I = .7 * base * (.25 + 1.6 * streamer * (.5 + 1.0 * rays) + .3 * rays + .5 * plumes);
          col = vec3(1., .95, .88);
        } else if (m == 7){
          // totality: the structured K-corona is the whole show
          I = 1.25 * base * (.3 + 1.9 * streamer * (.45 + 1.1 * rays) + .35 * rays + 1.2 * plumes) + .25 * pow(base, .6);
          col = vec3(.97, .97, 1.);
        } else if (m == 1){
          I = base * .08;
          col = vec3(1., .3, .2);
        } else if (m == 2){
          // He II 304: a thin bright rim (scale height ≈ 0.04 R☉)
          I = .12 * sqrt(6.2832 * p / .04) * exp(-(p - 1.) / .04) * (.6 + .5 * rays) + .03 * base;
          col = vec3(1., .46, .10);
        } else {
          // Fe IX 171 (H ≈ 0.05 R☉, plumes) / Fe XII 193 (H ≈ 0.09 R☉, hotter, broader streamers)
          bool m171 = m == 3;
          float H = m171 ? .05 : .09;
          float col0 = pow(sqrt(6.2832 * p / H) * exp(-(p - 1.) / H), .55);
          float S = m171 ? (.30 + 1.8 * plumes + .25 * streamer + .3 * rays) : (.40 + .9 * streamer + .2 * plumes + .3 * rays);
          I = (m171 ? .16 : .2) * col0 * S * (1. - (m171 ? .5 : .8) * pow(abs(ax), 8.) * uAxisLen * (1. - uAct));
          col = m171 ? vec3(1., .78, .3) : vec3(.95, .66, .38);
        }
        float edge = 1. - smoothstep(uScale * .7, uScale, p);
        gl_FragColor = vec4(col * I * uK * edge, 1.);
      }`,
  });
}

// soft radial glow on a billboard (flare flash)
function glowMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `uniform float uI; uniform vec3 uColor; varying vec2 vUv;
      void main(){ float r = length(vUv - .5) * 2.; float g = exp(-r * r * 9.) + .25 * exp(-r * 3.); gl_FragColor = vec4(uColor * g * uI * (1. - smoothstep(.85, 1., r)), 1.); }`,
  });
}

export function buildSun() {
  const sunGroup = new THREE.Group();        // turns with the Sun
  const photosphere = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 128), photosphereMaterial());
  sunGroup.add(photosphere);
  const chromo = new THREE.Mesh(new THREE.SphereGeometry(1.006, 160, 100), chromosphereMaterial());
  chromo.renderOrder = 2;
  sunGroup.add(chromo);

  const cut = buildCutFaces();               // fixed in the world

  const corona = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), coronaMaterial());
  corona.renderOrder = 1;
  corona.frustumCulled = false;

  const flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMaterial(0xfff4dd));
  flash.renderOrder = 5;
  flash.frustumCulled = false;

  return { sunGroup, photosphere, chromo, cut, corona, flash };
}
