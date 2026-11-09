// 3D viewers: Gaussian-splat scene viewer and styled mesh viewer.
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';

/* ======================================================================
   Gaussian splat viewer (scene preview)
   ====================================================================== */
export class SplatViewer {
  constructor(el, { onProgress } = {}) {
    this.el = el;
    this.onProgress = onProgress;
    this.viewer = null;
    this.scene = null;
  }

  async load(scene) {
    this.scene = scene;
    const GS = await import('./vendor/gaussian-splats-3d.module.min.js');
    this.GS = GS;
    const up = scene.up || [0, -1, 0];
    const target = scene.target || [0, 0, 0];
    const cam0 = scene.cameras?.[0];
    const pos = cam0 ? cam0.position : [target[0], target[1] - 2, target[2] - 4];
    this.viewer = new GS.Viewer({
      rootElement: this.el,
      cameraUp: up,
      initialCameraPosition: pos,
      initialCameraLookAt: target,
      sharedMemoryForWorkers: false,
      dynamicScene: false,
      antialiased: true,
      sphericalHarmonicsDegree: 2,
      useBuiltInControls: true,
      selfDrivenMode: true,
      logLevel: GS.LogLevel ? GS.LogLevel.None : 0,
    });
    await this.viewer.addSplatScene(scene.ply_url, {
      format: GS.SceneFormat.Ply,
      showLoadingUI: false,
      progressiveLoad: false,
      splatAlphaRemovalThreshold: 5,
      onProgress: (pct, label, stage) => this.onProgress && this.onProgress(pct, label, stage),
    });
    this.viewer.start();
    if (this.viewer.controls) this.viewer.controls.target.set(...target);
    this.home = { pos: [...pos], target: [...target] };
  }

  setCamera(position, lookAt, up) {
    const v = this.viewer;
    if (!v) return;
    v.camera.position.set(...position);
    if (up) v.camera.up.set(...up);
    if (v.controls) {
      v.controls.target.set(...lookAt);
      v.controls.update();
    } else {
      v.camera.lookAt(...lookAt);
    }
  }

  goTrainingCamera(i) {
    const c = this.scene?.cameras?.[i];
    if (!c) return;
    const R = c.rotation; // camera-to-world, columns are camera axes
    const fwd = [R[0][2], R[1][2], R[2][2]];
    const up = [-R[0][1], -R[1][1], -R[2][1]];
    const dist = this.scene.radius || 3;
    const look = c.position.map((p, k) => p + fwd[k] * dist);
    this.setCamera(c.position, look, up);
  }

  resetView() {
    if (this.home) this.setCamera(this.home.pos, this.home.target, this.scene.up);
  }

  setFov(deg) {
    const v = this.viewer;
    if (!v) return;
    v.camera.fov = deg;
    v.camera.updateProjectionMatrix();
  }

  setAutoRotate(on) {
    const c = this.viewer?.controls;
    if (!c) return;
    c.autoRotate = on;
    c.autoRotateSpeed = 1.2;
  }

  screenshot() {
    const v = this.viewer;
    if (!v) return null;
    v.forceRenderNextFrame?.();
    v.update?.();
    v.render?.();
    return v.renderer.domElement.toDataURL('image/png');
  }

  dispose() {
    const v = this.viewer;
    this.viewer = null;
    if (!v) return Promise.resolve();
    try { v.stop?.(); } catch (e) { /* ignore */ }
    // the library removes its own canvas asynchronously; don't touch the container before that
    return Promise.resolve(v.dispose?.()).catch(() => {});
  }
}

/* ======================================================================
   Mesh viewer with display styles
   ====================================================================== */
export class MeshViewer {
  constructor(el) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    el.prepend(this.renderer.domElement); // overlays (toolbar, chips) stay above the canvas

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
    this.camera.position.set(4, 3, 6);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;

    this.hemi = new THREE.HemisphereLight(0xdfe8ff, 0x2a2622, 1.1);
    this.key = new THREE.DirectionalLight(0xffffff, 1.6);
    this.key.position.set(5, 8, 6);
    this.fill = new THREE.DirectionalLight(0xbcd0ff, 0.5);
    this.fill.position.set(-6, 3, -4);
    this.rim = new THREE.DirectionalLight(0xffe2c0, 0.6);
    this.rim.position.set(0, 4, -8);
    this.scene.add(this.hemi, this.key, this.fill, this.rim);

    this.grid = new THREE.GridHelper(20, 40, 0x3a4560, 0x232a3a);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.55;
    this.scene.add(this.grid);
    this.axes = new THREE.AxesHelper(1);
    this.axes.visible = false;
    this.scene.add(this.axes);

    this.mesh = null;
    this.wire = null;
    this.style = 'color';
    this.flat = false;
    this.lightScale = 1;
    this._raf = null;
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(el);
    this.resize();
    this.loop();
  }

  resize() {
    const w = this.el.clientWidth || 1;
    const h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  loop() {
    this._raf = requestAnimationFrame(() => this.loop());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  async load(url, onProgress) {
    const gltf = await new GLTFLoader().loadAsync(url, (e) => {
      if (onProgress && e.total) onProgress(e.loaded / e.total);
    });
    let geom = null;
    gltf.scene.traverse((o) => { if (o.isMesh && !geom) geom = o.geometry; });
    if (!geom) throw new Error('模型中没有网格');
    this.clear();
    geom.computeBoundingBox();
    geom.computeBoundingSphere();
    if (!geom.attributes.normal) geom.computeVertexNormals();
    this.hasColors = !!geom.attributes.color;
    if (this.hasColors) {
      // trimesh stores 8-bit sRGB vertex colours; three.js treats COLOR_0 as linear,
      // so convert once to linear floats to avoid a washed-out look.
      const src = geom.attributes.color;
      const n = src.count, out = new Float32Array(n * 3);
      const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      for (let i = 0; i < n; i++) { out[i * 3] = lin(src.getX(i)); out[i * 3 + 1] = lin(src.getY(i)); out[i * 3 + 2] = lin(src.getZ(i)); }
      geom.setAttribute('color', new THREE.BufferAttribute(out, 3));
    }
    // cache original colors and a height ramp for the "elevation" style
    this.origColors = this.hasColors ? geom.attributes.color.clone() : null;
    this.geom = geom;
    this.mesh = new THREE.Mesh(geom);
    this.scene.add(this.mesh);
    this.frame();
    this.applyStyle(this.hasColors ? this.style : (this.style === 'color' || this.style === 'unlit' ? 'clay' : this.style));
    return { vertices: geom.attributes.position.count, faces: geom.index ? geom.index.count / 3 : geom.attributes.position.count / 3, hasColors: this.hasColors };
  }

  clear() {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    if (this.wire) { this.scene.remove(this.wire); this.wire = null; }
  }

  frame() {
    const bb = this.geom.boundingBox;
    const size = new THREE.Vector3(); bb.getSize(size);
    const center = new THREE.Vector3(); bb.getCenter(center);
    const r = this.geom.boundingSphere.radius;
    this.grid.position.set(center.x, bb.min.y, center.z);
    const gs = Math.pow(10, Math.ceil(Math.log10(Math.max(size.x, size.z) * 1.6)));
    this.grid.scale.setScalar(gs / 20);
    this.axes.position.set(center.x, bb.min.y, center.z);
    this.axes.scale.setScalar(r * 0.4);
    this.camera.near = r / 200;
    this.camera.far = r * 200;
    this.camera.updateProjectionMatrix();
    const dir = new THREE.Vector3(0.9, 0.55, 1.1).normalize();
    this.camera.position.copy(center).addScaledVector(dir, r * 2.1);
    this.controls.target.copy(center);
    this.controls.update();
    this.home = { pos: this.camera.position.clone(), target: center.clone() };
    this.key.position.copy(center).add(new THREE.Vector3(r * 2, r * 3, r * 2));
  }

  resetView() {
    if (!this.home) return;
    this.camera.position.copy(this.home.pos);
    this.controls.target.copy(this.home.target);
  }

  viewFrom(side) {
    if (!this.home) return;
    const t = this.home.target;
    const d = this.home.pos.distanceTo(t);
    const v = { front: [0, 0.15, 1], back: [0, 0.15, -1], left: [-1, 0.15, 0], right: [1, 0.15, 0], top: [0, 1, 0.001] }[side];
    this.camera.position.copy(t).addScaledVector(new THREE.Vector3(...v).normalize(), d);
    this.controls.target.copy(t);
  }

  _elevationColors() {
    const pos = this.geom.attributes.position;
    const bb = this.geom.boundingBox;
    const h = bb.max.y - bb.min.y || 1;
    const out = new Float32Array(pos.count * 3);
    const stops = [[0.13, 0.25, 0.67], [0.15, 0.64, 0.78], [0.33, 0.8, 0.45], [0.95, 0.83, 0.3], [0.93, 0.36, 0.27]];
    for (let i = 0; i < pos.count; i++) {
      let t = (pos.getY(i) - bb.min.y) / h;
      t = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
      const k = Math.floor(t), f = t - k, a = stops[k], b = stops[k + 1];
      out[i * 3] = a[0] + (b[0] - a[0]) * f;
      out[i * 3 + 1] = a[1] + (b[1] - a[1]) * f;
      out[i * 3 + 2] = a[2] + (b[2] - a[2]) * f;
    }
    return new THREE.BufferAttribute(out, 3);
  }

  applyStyle(style) {
    if (!this.mesh) { this.style = style; return; }
    this.style = style;
    if (this.wire) { this.scene.remove(this.wire); this.wire = null; }
    const g = this.geom;
    const useColors = (style === 'color' || style === 'unlit' || style === 'colorwire') && this.hasColors;
    if (style === 'elevation') g.setAttribute('color', this._elevationColors());
    else if (this.origColors) g.setAttribute('color', this.origColors);
    let mat;
    switch (style) {
      case 'unlit':
        mat = new THREE.MeshBasicMaterial({ vertexColors: useColors, color: useColors ? 0xffffff : 0xcfcac2 });
        mat.toneMapped = false; // show the captured colours exactly
        break;
      case 'clay':
        mat = new THREE.MeshStandardMaterial({ color: 0xd8d2c8, roughness: 0.78, metalness: 0.0 });
        break;
      case 'normal':
        mat = new THREE.MeshNormalMaterial();
        break;
      case 'wire':
        mat = new THREE.MeshBasicMaterial({ color: 0x8aa2ff, wireframe: true, transparent: true, opacity: 0.6 });
        break;
      case 'xray':
        mat = new THREE.MeshBasicMaterial({ color: 0x6fa8ff, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
        break;
      case 'elevation':
        mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
        break;
      case 'colorwire':
      case 'color':
      default:
        mat = new THREE.MeshStandardMaterial({ vertexColors: useColors, color: useColors ? 0xffffff : 0xd8d2c8, roughness: 0.92, metalness: 0.0 });
    }
    if ('flatShading' in mat) mat.flatShading = this.flat;
    mat.side = THREE.DoubleSide;
    if (this.mesh.material) this.mesh.material.dispose();
    this.mesh.material = mat;
    if (style === 'colorwire') {
      this.wire = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x000000, wireframe: true, transparent: true, opacity: 0.18 }));
      this.scene.add(this.wire);
    }
  }

  setFlat(on) { this.flat = on; this.applyStyle(this.style); }
  setGrid(on) { this.grid.visible = on; }
  setAxes(on) { this.axes.visible = on; }
  setAutoRotate(on) { this.controls.autoRotate = on; this.controls.autoRotateSpeed = 1.4; }
  setExposure(v) { this.renderer.toneMappingExposure = v; }

  setLighting(preset) {
    const P = {
      studio: { hemi: 1.1, key: 1.6, fill: 0.5, rim: 0.6, keyColor: 0xffffff },
      soft: { hemi: 1.8, key: 0.7, fill: 0.7, rim: 0.2, keyColor: 0xffffff },
      dramatic: { hemi: 0.35, key: 2.8, fill: 0.15, rim: 1.4, keyColor: 0xfff0dd },
      warm: { hemi: 1.0, key: 1.7, fill: 0.4, rim: 0.8, keyColor: 0xffd9a8 },
    }[preset] || {};
    this.hemi.intensity = P.hemi; this.key.intensity = P.key; this.fill.intensity = P.fill; this.rim.intensity = P.rim;
    this.key.color.setHex(P.keyColor);
  }

  screenshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
    this.clear();
    this.controls.dispose();
    this.renderer.dispose();
    this.el.innerHTML = '';
  }
}
