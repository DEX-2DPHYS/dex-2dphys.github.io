// Shader snippets shared by the Sun's materials: hashes, value noise, fbm, a cellular (Worley)
// noise for granulation, an approximate black-body colour and the inferno colour map.
// All colours are returned in linear light; the OutputPass does tone mapping and sRGB.

export const commonGLSL = /* glsl */`
// sin-free hashes (Hoskins), stable for the large lattice coordinates granulation needs
vec3 hash33(vec3 p3){ p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }

float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3. - 2. * f);
  float a = hash13(i),               b = hash13(i + vec3(1,0,0));
  float c = hash13(i + vec3(0,1,0)), d = hash13(i + vec3(1,1,0));
  float e = hash13(i + vec3(0,0,1)), g = hash13(i + vec3(1,0,1));
  float h = hash13(i + vec3(0,1,1)), k = hash13(i + vec3(1,1,1));
  return mix(mix(mix(a,b,u.x), mix(c,d,u.x), u.y), mix(mix(e,g,u.x), mix(h,k,u.x), u.y), u.z);
}
float fbm(vec3 p){ float s = 0., a = .5; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= .5; } return s; }

// cellular noise: x = distance to the nearest feature point, y = to the second nearest.
// The feature points wander with t, so cells are born, grow and fade like granules.
vec2 worley(vec3 p, float t){
  vec3 i = floor(p), f = fract(p); float d1 = 8., d2 = 8.;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = hash33(i + g);
    o = .5 + .42 * sin(t * (.6 + .8 * o.zxy) + 6.2831 * o);
    vec3 r = g + o - f; float d = dot(r, r);
    if (d < d1){ d2 = d1; d1 = d; } else if (d < d2){ d2 = d; }
  }
  return vec2(sqrt(d1), sqrt(d2));
}

// as worley(), and also the offset from p to the nearest feature point (cell centre), which
// gives the direction of a supergranule's outflow for the Dopplergram
vec2 worleyR(vec3 p, float t, out vec3 rn){
  vec3 i = floor(p), f = fract(p); float d1 = 8., d2 = 8.; rn = vec3(0.);
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = hash33(i + g);
    o = .5 + .42 * sin(t * (.6 + .8 * o.zxy) + 6.2831 * o);
    vec3 r = g + o - f; float d = dot(r, r);
    if (d < d1){ d2 = d1; d1 = d; rn = r; } else if (d < d2){ d2 = d; }
  }
  return vec2(sqrt(d1), sqrt(d2));
}

vec3 toLin(vec3 c){ return pow(max(c, 0.), vec3(2.2)); }

// Total eclipse (instrument 7): the Moon, just larger than the disc, hides everything whose line
// of sight passes within 1.004 R☉ of the Sun's centre; only what reaches beyond the limb shows.
bool behindMoon(vec3 w, float instr){
  if (instr < 6.5) return false;
  vec3 v = normalize(w - cameraPosition);
  return dot(v, -cameraPosition) > 0. && length(cross(cameraPosition, v)) < 1.004;
}

// Filtergram colour tables (sRGB), after the false-colour conventions of SDO/AIA and Hα
// imagers: 1 Hα, 2 He II 304 Å, 3 Fe IX 171 Å, 4 Fe XII 193 Å. x = 1 - exp(-E·gain).
vec3 ramp4(float x, vec3 a, vec3 b, vec3 c, vec3 d){
  x = clamp(x, 0., 1.) * 3.;
  if (x < 1.) return mix(a, b, x); if (x < 2.) return mix(b, c, x - 1.); return mix(c, d, x - 2.);
}
vec3 modeRamp(int m, float x){
  if (m == 1) return ramp4(x, vec3(0.), vec3(.42, .03, .01), vec3(.95, .27, .12), vec3(1., .83, .68));
  if (m == 2) return ramp4(x, vec3(0.), vec3(.50, .06, .02), vec3(1., .46, .10), vec3(1., .96, .62));
  if (m == 3) return ramp4(x, vec3(0.), vec3(.42, .27, 0.), vec3(.95, .76, .26), vec3(1., 1., .90));
  return ramp4(x, vec3(0.), vec3(.38, .20, .07), vec3(.88, .60, .34), vec3(1., .97, .90));
}

// Coronal holes (open field): polar caps that shrink towards solar maximum, plus occasional
// low-latitude holes in the declining phase. act = cycle activity 0..1, n in the Sun's frame.
float holeAt(vec3 n, float act){
  float lat = abs(asin(clamp(n.y, -1., 1.)));
  float hl = mix(55., 92., act) * .017453;
  float polar = smoothstep(hl - .06, hl + .06, lat + .08 * (vnoise(n * 3.) - .5));
  float low = smoothstep(.76, .84, vnoise(n * 1.9 + 11.)) * clamp(act * (1. - act) * 4., 0., 1.);
  return max(polar, low);
}

// black-body colour (sRGB, max channel 1) for T in kelvin; fit after T. Helland
vec3 bbColor(float T){
  float t = clamp(T, 1000., 40000.) / 100.;
  float r = t <= 66. ? 1. : clamp(1.29293618606 * pow(t - 60., -0.1332047592), 0., 1.);
  float g = t <= 66. ? clamp(0.39008157876 * log(t) - 0.63184144378, 0., 1.)
                     : clamp(1.12989086089 * pow(t - 60., -0.0755148492), 0., 1.);
  float b = t >= 66. ? 1. : (t <= 19. ? 0. : clamp(0.54320678911 * log(t - 10.) - 1.19625408914, 0., 1.));
  return vec3(r, g, b);
}

// matplotlib inferno, polynomial fit (sRGB)
vec3 inferno(float t){
  t = clamp(t, 0., 1.);
  const vec3 c0 = vec3(0.0002189403691192265, 0.001651004631001012, -0.01948089843709184);
  const vec3 c1 = vec3(0.1065134194856116, 0.5639564367884091, 3.932712388889277);
  const vec3 c2 = vec3(11.60249308247187, -3.972853965665698, -15.9423941062914);
  const vec3 c3 = vec3(-41.70399613139459, 17.43639888205313, 44.35414519872813);
  const vec3 c4 = vec3(77.162935699427, -33.40235894210092, -81.80730925738993);
  const vec3 c5 = vec3(-71.31942824499214, 32.62606426397723, 73.20951985803202);
  const vec3 c6 = vec3(25.13112622477341, -12.24266895238567, -23.07032500287172);
  return c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6)))));
}
`;

// The cutaway removes the quadrant x > 0, z > 0 of the Sun, fixed in the world (it does not
// turn with the Sun), so every Sun material shares this test on its world position.
export const cutGLSL = /* glsl */`
uniform float uCut;
bool cutAway(vec3 w){ return uCut > .5 && w.x > 0. && w.z > 0.; }
`;
