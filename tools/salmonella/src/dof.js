// Renders the scene into a colour + depth target, then applies a gather depth-of-field.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { dofFragGLSL } from './glsl.js';

export class SceneDoFPass extends Pass {
  constructor(scene, camera, w, h) {
    super();
    this.scene = scene; this.camera = camera;
    const depthTexture = new THREE.DepthTexture(w, h);
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture, depthBuffer: true, samples: 0 });
    this.uniforms = {
      tColor: { value: this.rt.texture }, tDepth: { value: depthTexture },
      cameraNear: { value: 0.1 }, cameraFar: { value: 1e4 },
      focus: { value: 1000 }, dofWidth: { value: 0.5 }, maxRadius: { value: 20 },
      texel: { value: new THREE.Vector2(1 / w, 1 / h) }, aspect: { value: w / h },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: dofFragGLSL, depthTest: false, depthWrite: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
    this.needsSwap = true;
  }
  setSize(w, h) {
    this.rt.setSize(w, h);
    this.uniforms.texel.value.set(1 / w, 1 / h); this.uniforms.aspect.value = w / h;
  }
  render(renderer, writeBuffer) {
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    this.uniforms.cameraNear.value = this.camera.near; this.uniforms.cameraFar.value = this.camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }
  dispose() { this.rt.dispose(); this.material.dispose(); this.fsQuad.dispose(); }
}
