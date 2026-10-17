// Builds the 3D city from city.json and handles picking, coloring and camera moves.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';

export const FLAG = { AGENT: 1, COVERED: 2, REWORK: 4, TEST_CHANGED: 8, FOLLOW_UP: 16 };
const WORLD = 20;

const css = getComputedStyle(document.documentElement);
const color = (/** @type {string} */ name) => new THREE.Color(css.getPropertyValue(name).trim());

/**
 * @param {HTMLElement} stage
 * @param {any} data city.json
 */
export function createCity(stage, data) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const K = WORLD / data.layout.size;
  const OFF = WORLD / 2;
  const files = data.files;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  stage.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xd6e4ff, 0x0d1520, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(-8, 16, 6);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  const home = { pos: new THREE.Vector3(-14, 16, 19), target: new THREE.Vector3(0, 0, 0) };
  camera.position.copy(home.pos);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 2;
  controls.maxDistance = 70;

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD + 1, WORLD + 1), new THREE.MeshBasicMaterial({ color: 0x0e1622 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  scene.add(ground);
  const districtColors = [0x152131, 0x1a283b, 0x1f3046, 0x233650];
  for (const d of data.layout.districts) {
    if (d.depth > 4) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(d.w * K, 0.02, d.h * K), new THREE.MeshLambertMaterial({ color: districtColors[Math.min(d.depth - 1, 3)] }));
    m.position.set(d.x * K + (d.w * K) / 2 - OFF, d.depth * 0.02, d.y * K + (d.h * K) / 2 - OFF);
    scene.add(m);
  }

  // Buildings
  const maxCommits = Math.max(1, ...files.map((/** @type {any} */ f) => f.commits));
  const hk = 6 / Math.sqrt(maxCommits);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), files.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const base = 0.1;
  const geom = files.map((/** @type {any} */ f, /** @type {number} */ i) => {
    const w = Math.max(0.04, f.w * K), d = Math.max(0.04, f.h * K), h = 0.05 + Math.sqrt(f.commits) * hk;
    p.set(f.x * K + w / 2 - OFF, base, f.y * K + d / 2 - OFF);
    m4.compose(p, q, s.set(w, h, d));
    mesh.setMatrixAt(i, m4);
    return { x: p.x, z: p.z, w, d, h };
  });
  scene.add(mesh);

  // Derived per-file numbers used by layers
  const unchecked = files.map((/** @type {any} */ f) => f.log.filter((/** @type {number[]} */ e) => (e[1] & FLAG.AGENT) && !(e[1] & FLAG.TEST_CHANGED)).length);
  const uncheckedAll = files.map((/** @type {any} */ f) => f.log.filter((/** @type {number[]} */ e) => !(e[1] & FLAG.TEST_CHANGED)).length);
  const isSource = (/** @type {string} */ path) => /\.(m?[jt]sx?|cjs|py|go|rb|java|kts?|cs|swift|rs|c|cc|cpp|h|hpp|php|scala|vue|svelte|exs?|dart|lua)$/i.test(path);
  const adoptedAt = data.adoption ? Date.parse(data.adoption.at) : null;
  const commitAt = data.commits.map((/** @type {any} */ c) => Date.parse(c.at));
  const afterShare = files.map((/** @type {any} */ f) => (adoptedAt === null || !f.log.length ? 0
    : f.log.filter((/** @type {number[]} */ e) => commitAt[e[0]] >= adoptedAt).length / f.log.length));

  const C = { human: color('--human'), agent: color('--agent'), unknown: color('--unknown'), rework: color('--rework'), ok: color('--ok') };
  const tmp = new THREE.Color();
  let scope = 'agent';
  /** @type {Record<string, (f: any, i: number) => THREE.Color>} */
  const layers = {
    agent: f => (f.covered ? tmp.copy(C.human).lerp(C.agent, f.agent / f.covered) : tmp.copy(C.unknown)),
    rework: f => {
      if (scope === 'all') return f.commits > 1 ? tmp.copy(C.human).lerp(C.rework, Math.min(1, (f.followUps / f.commits) / 0.6)) : tmp.copy(C.unknown);
      return f.agent ? tmp.copy(C.human).lerp(C.rework, Math.min(1, f.rework / f.agent / 1.5)) : tmp.copy(C.unknown);
    },
    verifier: (f, i) => {
      if (f.isTest) return tmp.copy(C.ok);
      if (!isSource(f.path)) return tmp.copy(C.unknown);
      if (scope === 'all') return f.commits ? tmp.copy(C.human).lerp(C.rework, uncheckedAll[i] / f.commits) : tmp.copy(C.unknown);
      return f.agent ? tmp.copy(C.human).lerp(C.rework, unchecked[i] / f.agent) : tmp.copy(C.unknown);
    },
    owners: f => {
      if (!isSource(f.path) || !f.commits) return tmp.copy(C.unknown);
      return f.authors <= 1 ? tmp.copy(C.rework) : f.authors === 2 ? tmp.copy(C.human).lerp(C.rework, 0.4) : tmp.copy(C.human);
    },
    era: (f, i) => (adoptedAt === null || !f.commits ? tmp.copy(C.unknown) : tmp.copy(C.human).lerp(C.agent, afterShare[i])),
  };
  let layer = 'agent';
  /** @param {string} [name] @param {string} [nextScope] */
  function paint(name = layer, nextScope = scope) {
    layer = name;
    scope = nextScope;
    files.forEach((/** @type {any} */ f, /** @type {number} */ i) => mesh.setColorAt(i, layers[layer](f, i)));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  paint();

  // Outlines for hover and focus
  const edge = new THREE.EdgesGeometry(geo);
  const hover = new THREE.LineSegments(edge, new THREE.LineBasicMaterial({ color: 0xffffff }));
  const focus = new THREE.LineSegments(edge, new THREE.LineBasicMaterial({ color: 0xffffff }));
  hover.visible = focus.visible = false;
  scene.add(hover, focus);
  const outline = (/** @type {THREE.LineSegments} */ obj, /** @type {number} */ i) => {
    if (i < 0) { obj.visible = false; return; }
    const g = geom[i];
    obj.position.set(g.x, base, g.z);
    obj.scale.set(g.w * 1.04, g.h + 0.02, g.d * 1.04);
    obj.visible = true;
  };

  // Folder highlight (for repo- and folder-level findings)
  const area = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }));
  area.rotation.x = -Math.PI / 2;
  area.visible = false;
  scene.add(area);

  // District labels
  const v = new THREE.Vector3();
  const labels = data.layout.districts
    .filter((/** @type {any} */ d) => d.depth <= 2 && d.w * d.h * K * K > (d.depth === 1 ? 2 : 8))
    .map((/** @type {any} */ d) => {
      const el = document.createElement('span');
      el.className = `lbl d${d.depth}`;
      el.textContent = d.path.split('/').pop() + '/';
      stage.appendChild(el);
      return { el, p: new THREE.Vector3(d.x * K + (d.w * K) / 2 - OFF, 0.12, d.y * K + Math.min(0.5, (d.h * K) / 2) - OFF) };
    });

  // Picking
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  /** @param {number} x @param {number} y client coordinates */
  function pick(x, y) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(mesh)[0];
    return hit ? /** @type {number} */ (hit.instanceId) : -1;
  }

  // Camera moves
  /** @type {null | { p0: THREE.Vector3, t0: THREE.Vector3, p1: THREE.Vector3, t1: THREE.Vector3, start: number }} */
  let tween = null;
  controls.addEventListener('start', () => { tween = null; });
  function flyTo(/** @type {THREE.Vector3} */ pos, /** @type {THREE.Vector3} */ target) {
    if (reduce) { camera.position.copy(pos); controls.target.copy(target); return; }
    tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, start: performance.now() };
  }
  const indexOf = new Map(files.map((/** @type {any} */ f, /** @type {number} */ i) => [f.path, i]));
  function focusPath(/** @type {string} */ path) {
    const i = indexOf.get(path);
    area.visible = false;
    if (i !== undefined) {
      outline(focus, i);
      const g = geom[i];
      const target = new THREE.Vector3(g.x, g.h / 2, g.z);
      const dist = Math.max(8, g.h * 2 + 6);
      flyTo(target.clone().add(new THREE.Vector3(-0.45, 0.85, 0.6).normalize().multiplyScalar(dist)), target);
      return;
    }
    outline(focus, -1);
    const d = data.layout.districts.find((/** @type {any} */ x) => x.path === path);
    const r = d ? { x: d.x, y: d.y, w: d.w, h: d.h } : { x: 0, y: 0, w: data.layout.size, h: data.layout.size };
    area.scale.set(r.w * K, r.h * K, 1);
    area.position.set(r.x * K + (r.w * K) / 2 - OFF, 0.2, r.y * K + (r.h * K) / 2 - OFF);
    area.visible = !!d;
    const span = Math.max(r.w, r.h) * K;
    const target = new THREE.Vector3(area.position.x, 0, area.position.z);
    flyTo(target.clone().add(new THREE.Vector3(-0.6, 0.75, 0.9).multiplyScalar(span * 1.1 + 3)), target);
  }
  function home_() { outline(focus, -1); area.visible = false; flyTo(home.pos.clone(), home.target.clone()); }

  /** Screen position of the top of a building, for tooltips. */
  function screenOf(/** @type {string} */ path) {
    const i = indexOf.get(path);
    if (i === undefined) return null;
    const g = geom[i];
    v.set(g.x, base + g.h, g.z).project(camera);
    return { x: ((v.x + 1) / 2) * stage.clientWidth, y: ((1 - v.y) / 2) * stage.clientHeight };
  }

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  (function loop(/** @type {number} */ now) {
    if (tween) {
      const k = Math.min(1, (now - tween.start) / 900);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      camera.position.lerpVectors(tween.p0, tween.p1, e);
      controls.target.lerpVectors(tween.t0, tween.t1, e);
      if (k === 1) tween = null;
    }
    controls.update();
    renderer.render(scene, camera);
    const w = stage.clientWidth, h = stage.clientHeight;
    for (const l of labels) {
      v.copy(l.p).project(camera);
      l.el.style.left = `${((v.x + 1) / 2) * w}px`;
      l.el.style.top = `${((1 - v.y) / 2) * h}px`;
      l.el.hidden = v.z > 1;
    }
    requestAnimationFrame(loop);
  })(performance.now());

  return {
    paint,
    pick,
    hover: (/** @type {number} */ i) => outline(hover, i),
    focusPath,
    home: home_,
    screenOf,
    unchecked,
    uncheckedAll,
    afterShare,
    scope: () => scope,
    canvas: renderer.domElement,
  };
}
