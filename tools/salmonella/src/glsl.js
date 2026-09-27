// GLSL snippets injected into three.js materials via onBeforeCompile.

export const noiseGLSL = /* glsl */`
vec3 hash33(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float hash13(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); vec3 u = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i), hash13(i+vec3(1,0,0)), u.x),
                 mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), u.x), u.y),
             mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), u.x),
                 mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), u.x), u.y), u.z);
}
// distance to nearest jittered lattice point (lipid heads / packed subunits)
float worley(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); float d = 8.0;
  for(int z=-1;z<=1;z++) for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec3 g = vec3(float(x),float(y),float(z));
    vec3 r = g + 0.15 + 0.7*hash33(i+g) - f;
    d = min(d, dot(r,r));
  }
  return sqrt(d);
}
// packed rounded domes (lipid head groups)
float lipidH(vec3 p){ float d = worley(p); return 1.0 - min(1.0, d*d*1.6); }
// F2-F1 of a 3D cellular pattern: small near cell walls (a foam / mesh)
float worleyEdge(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); float d1 = 8.0, d2 = 8.0;
  for(int z=-1;z<=1;z++) for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec3 g = vec3(float(x),float(y),float(z));
    vec3 r = g + 0.1 + 0.8*hash33(i+g) - f;
    float d = dot(r,r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return sqrt(d2) - sqrt(d1);
}
`;

// Membrane: multi-scale procedural bumps in world space. Expects varying vWPos and
// uniforms uBump0/1/2 (x = wavelength nm, y = amplitude nm). Runs after normal_fragment_maps.
export const membraneBumpGLSL = /* glsl */`
{
  vec3 P = vWPos;
  float px = length(vec3(dFdx(P.x), dFdx(P.y), dFdx(P.z))) + length(vec3(dFdy(P.x), dFdy(P.y), dFdy(P.z)));
  vec3 g = vec3(0.0);
  {
    float f = 1.0/uBump0.x; float fade = 1.0 - smoothstep(0.12, 0.5, px*f);
    if (fade > 0.001) {
      float e = 0.06*uBump0.x; float n0 = vnoise(P*f);
      vec3 gg = vec3(vnoise((P+vec3(e,0,0))*f)-n0, vnoise((P+vec3(0,e,0))*f)-n0, vnoise((P+vec3(0,0,e))*f)-n0)/e;
      g += gg*uBump0.y*fade;
    }
  }
  {
    float f = 1.0/uBump1.x; float fade = 1.0 - smoothstep(0.12, 0.5, px*f);
    if (fade > 0.001) {
      float e = 0.06*uBump1.x; float n0 = vnoise(P*f) + 0.5*vnoise(P*f*2.3);
      vec3 gg = vec3(vnoise((P+vec3(e,0,0))*f) + 0.5*vnoise((P+vec3(e,0,0))*f*2.3) - n0,
                     vnoise((P+vec3(0,e,0))*f) + 0.5*vnoise((P+vec3(0,e,0))*f*2.3) - n0,
                     vnoise((P+vec3(0,0,e))*f) + 0.5*vnoise((P+vec3(0,0,e))*f*2.3) - n0)/e;
      g += gg*uBump1.y*fade;
    }
  }
  {
    float f = 1.0/uBump2.x; float fade = 1.0 - smoothstep(0.10, 0.45, px*f);
    if (fade > 0.001) {
      float e = 0.05*uBump2.x; float n0 = lipidH(P*f);
      vec3 gg = vec3(lipidH((P+vec3(e,0,0))*f)-n0, lipidH((P+vec3(0,e,0))*f)-n0, lipidH((P+vec3(0,0,e))*f)-n0)/e;
      g += gg*uBump2.y*fade;
    }
  }
  vec3 gv = (viewMatrix*vec4(g,0.0)).xyz;
  gv -= dot(gv, normal)*normal;
  normal = normalize(normal - gv);
}
`;

// Fresnel-dependent opacity: uFres.x = face alpha factor, uFres.y = exponent. Runs after alphamap_fragment.
export const fresnelAlphaGLSL = /* glsl */`
{
  float fr = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));
  fr = pow(clamp(fr, 0.0, 1.0), uFres.y);
  diffuseColor.a *= mix(uFres.x, 1.0, fr);
}
`;

// Peptidoglycan mesh: keep only fragments near cell walls of a 3D foam.
export const pgNetGLSL = /* glsl */`
{
  vec3 P = vWPos;
  float px = length(vec3(dFdx(P.x), dFdx(P.y), dFdx(P.z))) + length(vec3(dFdy(P.x), dFdy(P.y), dFdy(P.z)));
  float f = 1.0/uNetCell;
  float e = worleyEdge(P*f);
  float w = 0.16 + 0.3*clamp(px*f, 0.0, 1.0);   // strands widen with pixel footprint (anti-alias)
  float fade = 1.0 - smoothstep(0.3, 1.2, px*f);
  if (e > w) discard;
  diffuseColor.a *= (0.85*fade + 0.15);
}
`;

// Tube subunit lattice (flagellin, hook, pilin, DNA...). Expects varying vTanV and uniforms
// uLat = (tubeRadius, nProto, rise, domeHeight), uLatPhase (angle fraction), uLatShear (fraction of rise).
export const latticeGLSL = /* glsl */`
{
  float tubeR = uLat.x; float nP = uLat.y; float rise = uLat.z; float dome = uLat.w;
  float a = 6.2831853*tubeR/nP;
  float shear = rise*uLatShear;
  vec2 q = vec2((vUv.y + uLatPhase)*6.2831853*tubeR, vUv.x);
  float px = fwidth(vUv.x);
  float fade = 1.0 - smoothstep(0.22, 0.6, px/rise);
  if (fade > 0.001) {
    #define LATH(qq) latticeH(qq, a, rise, shear)
    float e = 0.12*rise;
    float hs = (LATH(q+vec2(e,0.0)) - LATH(q-vec2(e,0.0)))/(2.0*e);
    float hz = (LATH(q+vec2(0.0,e)) - LATH(q-vec2(0.0,e)))/(2.0*e);
    vec3 T = normalize(vTanV);
    vec3 B = normalize(cross(T, normal));
    normal = normalize(normal - (hs*B + hz*T)*dome*fade);
  }
}
`;
export const latticeFnGLSL = /* glsl */`
uniform vec4 uLat; uniform float uLatPhase; uniform float uLatShear;
varying vec3 vTanV;
float latticeH(vec2 q, float a, float rise, float shear){
  float best = 0.0;
  float jf = floor(q.x/a);
  for (int dj=-1; dj<=1; dj++){
    float j = jf + float(dj);
    float sc = (j+0.5)*a;
    float zoff = j*shear;
    float k = floor((q.y - zoff)/rise + 0.5);
    float zc = k*rise + zoff;
    vec2 d = vec2((q.x - sc)/a, (q.y - zc)/rise)*2.0;
    float r2 = dot(d,d);
    float h = sqrt(max(0.0, 1.0 - r2*0.78));
    best = max(best, h);
  }
  return best;
}
`;

// Depth of field (gather, scatter-as-gather weights). Colour in tColor, depth in tDepth.
export const dofFragGLSL = /* glsl */`
#include <packing>
uniform sampler2D tColor; uniform sampler2D tDepth;
uniform float cameraNear; uniform float cameraFar;
uniform float focus; uniform float dofWidth; uniform float maxRadius;
uniform vec2 texel; uniform float aspect;
varying vec2 vUv;
float viewDist(vec2 uv){ float z = texture2D(tDepth, uv).x; return -perspectiveDepthToViewZ(z, cameraNear, cameraFar); }
float cocOf(float d){ return clamp((d - focus)/(focus*dofWidth), -1.0, 1.0); }
void main(){
  if (maxRadius < 0.01) { gl_FragColor = texture2D(tColor, vUv); return; }
  float dc = viewDist(vUv); float cc = cocOf(dc); float rc = abs(cc)*maxRadius;
  vec4 acc = texture2D(tColor, vUv); float wsum = 1.0;
  float jit = fract(52.9829189*fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))*6.2831853;
  const int N = 64;
  for (int i = 0; i < N; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi/float(N));
    float an = fi*2.39996323 + jit;
    vec2 off = vec2(cos(an), sin(an))*r*maxRadius;
    vec2 uv = vUv + off*texel;
    float dt = viewDist(uv);
    float ct = abs(cocOf(dt))*maxRadius;
    float dist = r*maxRadius;
    float rt = (dt < dc) ? ct : min(ct, rc);
    float w = clamp((rt - dist)*0.8 + 1.0, 0.0, 1.0);
    acc += texture2D(tColor, uv)*w; wsum += w;
  }
  gl_FragColor = acc/wsum;
}
`;

export const vignetteFragGLSL = /* glsl */`
uniform sampler2D tDiffuse; uniform float strength; uniform float grain; uniform float time;
varying vec2 vUv;
void main(){
  vec4 c = texture2D(tDiffuse, vUv);
  vec2 d = vUv - 0.5; float v = 1.0 - strength*smoothstep(0.25, 0.9, dot(d,d)*2.0);
  float n = fract(sin(dot(vUv*vec2(1231.7, 917.3) + time, vec2(12.9898, 78.233)))*43758.5453) - 0.5;
  gl_FragColor = vec4(c.rgb*v + n*grain, c.a);
}
`;
