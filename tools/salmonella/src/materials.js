import * as THREE from 'three';
import { noiseGLSL, membraneBumpGLSL, fresnelAlphaGLSL, pgNetGLSL, latticeGLSL, latticeFnGLSL } from './glsl.js';

const WPOS_VERT_DECL = '#include <common>\nvarying vec3 vWPos;';
const WPOS_VERT_BODY = `#include <worldpos_vertex>
{ vec4 wp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  wp = instanceMatrix * wp;
#endif
  vWPos = (modelMatrix * wp).xyz; }`;

export function protMat(color, opts = {}) {
  return new THREE.MeshPhysicalMaterial(Object.assign({
    color, roughness: 0.52, metalness: 0.0, clearcoat: 0.28, clearcoatRoughness: 0.45,
    sheen: 0.15, sheenRoughness: 0.8, envMapIntensity: 0.55,
  }, opts));
}

// Membrane layer material with procedural multi-scale bumps and fresnel opacity.
export function membraneMaterial(o) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: o.color, roughness: o.roughness ?? 0.5, metalness: 0,
    transparent: true, opacity: o.opacity ?? 0.9, side: o.side ?? THREE.FrontSide,
    clearcoat: o.clearcoat ?? 0.2, clearcoatRoughness: 0.55,
    sheen: o.sheen ?? 0.15, sheenColor: new THREE.Color(o.sheenColor ?? 0xffffff), sheenRoughness: 0.7,
    envMapIntensity: o.envMapIntensity ?? 0.35, depthWrite: o.depthWrite ?? true,
  });
  const u = {
    uBump0: { value: new THREE.Vector2(...(o.bump0 ?? [90, 2.0])) },
    uBump1: { value: new THREE.Vector2(...(o.bump1 ?? [13, 1.1])) },
    uBump2: { value: new THREE.Vector2(...(o.bump2 ?? [1.1, 0.35])) },
    uFres: { value: new THREE.Vector2(o.faceAlpha ?? 0.7, o.fresnelPow ?? 2.2) },
  };
  mat.userData.u = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', WPOS_VERT_DECL).replace('#include <worldpos_vertex>', WPOS_VERT_BODY);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + noiseGLSL + '\nvarying vec3 vWPos; uniform vec2 uBump0, uBump1, uBump2; uniform vec2 uFres;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + membraneBumpGLSL)
      .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\n' + fresnelAlphaGLSL);
  };
  mat.customProgramCacheKey = () => 'membrane';
  return mat;
}

// Peptidoglycan net: alpha-discarded foam pattern.
export function pgMaterial(o) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: o.color, roughness: 0.6, metalness: 0, transparent: true, opacity: o.opacity ?? 0.9,
    side: THREE.DoubleSide, envMapIntensity: 0.3, depthWrite: false,
  });
  const u = { uNetCell: { value: o.cell ?? 5.5 } };
  mat.userData.u = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', WPOS_VERT_DECL).replace('#include <worldpos_vertex>', WPOS_VERT_BODY);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + noiseGLSL + '\nvarying vec3 vWPos; uniform float uNetCell;')
      .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\n' + pgNetGLSL);
  };
  mat.customProgramCacheKey = () => 'pgnet';
  return mat;
}

// Tube with a helical subunit lattice rendered as bump normals. Geometry needs attribute aTan.
export function latticeMaterial(o) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: o.color, roughness: o.roughness ?? 0.5, metalness: 0, clearcoat: o.clearcoat ?? 0.3, clearcoatRoughness: 0.45,
    sheen: 0.2, sheenRoughness: 0.8, envMapIntensity: o.envMapIntensity ?? 0.55, side: o.side ?? THREE.FrontSide,
    transparent: !!o.transparent, opacity: o.opacity ?? 1,
  });
  const u = {
    uLat: { value: new THREE.Vector4(o.tubeR, o.nProto, o.rise, o.dome ?? 1.2) },
    uLatPhase: { value: 0 },
    uLatShear: { value: o.shear ?? (1 / o.nProto) },
  };
  mat.userData.u = u;
  mat.defines = { USE_UV: '' };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aTan; varying vec3 vTanV;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n{ vec3 tt = aTan;\n#ifdef USE_INSTANCING\n tt = mat3(instanceMatrix) * tt;\n#endif\n vTanV = normalize(normalMatrix * tt); }');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + latticeFnGLSL)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + latticeGLSL);
  };
  mat.customProgramCacheKey = () => 'lattice';
  return mat;
}
