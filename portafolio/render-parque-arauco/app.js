import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// ---------- parámetros ----------
const Q = new URLSearchParams(location.search);
if (Q.get('ui') === '0') document.body.classList.add('noui');
const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
const DPR = parseFloat(Q.get('dpr')) || Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2);
const HQ = Q.get('hq') === '1';
const D2R = Math.PI / 180;
// Ángulo de planta θ (0° = este/derecha del plano, 90° = arriba del plano). Arriba del plano = -Z.
const polar = (r, th, y = 0) => new THREE.Vector3(r * Math.cos(th * D2R), y, -r * Math.sin(th * D2R));

// Colores de temperatura (aprox. cuerpo negro)
const K2300 = new THREE.Color(1.0, 0.56, 0.20);
const K3000 = new THREE.Color(1.0, 0.70, 0.42);

// ---------- renderer ----------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
Object.assign(labelRenderer.domElement.style, { position: 'fixed', inset: '0', pointerEvents: 'none' });
app.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 1.5; controls.maxDistance = 60;

// ---------- texturas procedurales ----------
function canvasTex(w, h, draw, repeat = [1, 1], srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function noise(g, w, h, a, n = 6000) { for (let i = 0; i < n; i++) { const v = Math.random() * 255 | 0; g.fillStyle = `rgba(${v},${v},${v},${a})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }
// Adoquín exterior 0.60 x 0.30 m (estimado). Canvas = 2.4 m
const paverTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#8f8a82'; g.fillRect(0, 0, w, h);
  const tw = w / 4, th = h / 8;
  for (let j = 0; j < 8; j++) for (let i = -1; i < 5; i++) {
    const x = i * tw + (j % 2) * tw / 2, y = j * th, s = 128 + Math.random() * 22;
    g.fillStyle = `rgb(${s + 10},${s + 6},${s})`; g.fillRect(x + 2, y + 2, tw - 4, th - 4);
  }
  noise(g, w, h, 0.07, 9000);
}, [1, 1]);
const woodTex = canvasTex(256, 64, (g, w, h) => { // listones de madera
  for (let i = 0; i < 4; i++) {
    const s = 0.85 + Math.random() * 0.3;
    g.fillStyle = `rgb(${120 * s | 0},${78 * s | 0},${48 * s | 0})`; g.fillRect(i * w / 4, 0, w / 4 - 5, h);
    for (let k = 0; k < 18; k++) { g.fillStyle = `rgba(60,35,20,${Math.random() * 0.25})`; g.fillRect(i * w / 4 + Math.random() * (w / 4 - 6), 0, 1, h); }
    g.fillStyle = '#2b1d14'; g.fillRect(i * w / 4 + w / 4 - 5, 0, 5, h);
  }
});
const concreteTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#b9b5ad'; g.fillRect(0, 0, w, h); noise(g, w, h, 0.10, 7000); });
const grassTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#3d6b2a'; g.fillRect(0, 0, w, h); for (let i = 0; i < 9000; i++) { const s = Math.random(); g.fillStyle = `rgb(${40 + s * 50 | 0},${80 + s * 70 | 0},${25 + s * 30 | 0})`; g.fillRect(Math.random() * w, Math.random() * h, 1, 3); } }, [6, 6]);
const gradTex = canvasTex(4, 256, (g, w, h) => { const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, '#fff'); gr.addColorStop(0.25, '#999'); gr.addColorStop(0.6, '#2a2a2a'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, [1, 1], false);
gradTex.wrapT = THREE.ClampToEdgeWrapping;
const beamTex = canvasTex(4, 256, (g, w, h) => { const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, '#666'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, [1, 1], false);
beamTex.wrapT = THREE.ClampToEdgeWrapping;

// ---------- materiales ----------
const M = {
  concrete: new THREE.MeshStandardMaterial({ map: concreteTex, color: 0xd8d4cc, roughness: 0.9, side: THREE.DoubleSide }),
  recess: new THREE.MeshStandardMaterial({ color: 0x8a857d, roughness: 0.9, side: THREE.DoubleSide, emissive: K2300.clone(), emissiveIntensity: 0 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x3b3e42, roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide }),
  grass: new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, side: THREE.DoubleSide }),
  soil: new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 1 }),
  black: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.6 }),
  led: new THREE.MeshBasicMaterial({ color: K2300.clone().multiplyScalar(7) }),
  lens: new THREE.MeshBasicMaterial({ color: K3000.clone().multiplyScalar(9) }),
  floor: new THREE.MeshStandardMaterial({ map: paverTex, roughness: 0.85 }),
  socket: new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.5 }),
};
const woodMats = [];
function woodMat(len) { const t = woodTex.clone(); t.needsUpdate = true; t.repeat.set(len / 0.6, 1); const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.7, side: THREE.DoubleSide }); woodMats.push(m); return m; }

// ---------- geometría base ----------
const world = new THREE.Group(); scene.add(world);
function ring(r1, h1, r2, h2, thA, thB, mat, seg) {
  seg = seg || Math.max(16, Math.round((thB - thA) * Math.max(r1, r2) / 4));
  const g = new THREE.LatheGeometry([new THREE.Vector2(r1, h1), new THREE.Vector2(r2, h2)], seg, (thA + 90) * D2R, (thB - thA) * D2R);
  const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; world.add(m); return m;
}
// Tapa plana (perfil u,h) en un ángulo θ; rOf(u) da el radio.
function cap(profile, rOf, th, mat) {
  const shape = new THREE.Shape(profile.map(([u, h]) => new THREE.Vector2(u, h)));
  const g = new THREE.ShapeGeometry(shape); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const v = polar(rOf(p.getX(i)), th, p.getY(i)); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; world.add(m);
}

const SEAT_H = 0.45, D = 0.80, LIP = 0.15, TOE = 0.20, BACK_TOP = 0.88, WALL_H = 1.0, WALL_T = 0.18, SOIL_H = 0.50;
const stripLights = []; // luces de relleno de la cinta
const glowMeshes = [];
// Banca: rW = radio del muro de respaldo, dir = +1 asiento hacia afuera / -1 hacia el centro
function bench(rW, dir, thA, thB, nFill) {
  const r = u => rW + dir * u;
  const len = (thB - thA) * D2R * r(D);
  ring(r(D - TOE), 0, r(D - TOE), LIP, thA, thB, M.recess);
  ring(r(D - TOE), LIP, r(D), LIP, thA, thB, M.recess);
  ring(r(D), LIP, r(D), SEAT_H, thA, thB, woodMat(len));
  ring(r(D), SEAT_H, r(D - 0.48), SEAT_H, thA, thB, woodMat(len));
  ring(r(D - 0.48), SEAT_H, r(0), BACK_TOP, thA, thB, woodMat(len));
  const prof = [[0, 0], [D - TOE, 0], [D - TOE, LIP], [D, LIP], [D, SEAT_H], [D - 0.48, SEAT_H], [0, BACK_TOP]];
  cap(prof, r, thA, M.concrete); cap(prof, r, thB, M.concrete);
  // T1: cinta LED neón flex 12x12 mm bajo el borde del asiento (detalle D-01/D-02)
  ring(r(D - 0.045), LIP - 0.004, r(D - 0.033), LIP - 0.004, thA + 0.15, thB - 0.15, M.led, 256);
  ring(r(D - 0.045), LIP - 0.004, r(D - 0.045), LIP - 0.016, thA + 0.15, thB - 0.15, M.led);
  // Brillo en el piso (aproximación de la luz rasante de la cinta)
  const gm = new THREE.MeshBasicMaterial({ map: gradTex, color: K2300, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.26, side: THREE.DoubleSide });
  const g = ring(r(D - TOE), 0.004, r(D + 0.6), 0.004, thA + 0.3, thB - 0.3, gm); g.castShadow = g.receiveShadow = false; g.renderOrder = 2; glowMeshes.push(g);
  for (let i = 0; i < nFill; i++) {
    const th = thA + (thB - thA) * (i + 0.5) / nFill;
    const L = new THREE.PointLight(K2300, 0, 3.2, 2); L.position.copy(polar(r(D + 0.45), th, 0.35)); world.add(L); stripLights.push(L);
  }
}
// Muro de jardinera con remate metálico. dir apunta hacia la banca.
function wall(rW, dir, thA, thB) {
  const r = u => rW + dir * u;
  ring(r(0), BACK_TOP - 0.01, r(0), WALL_H, thA, thB, M.concrete);
  ring(r(0), WALL_H, r(-WALL_T), WALL_H, thA, thB, M.concrete);
  ring(r(-WALL_T), WALL_H, r(-WALL_T), SOIL_H - 0.05, thA, thB, M.concrete);
  // remate metálico inclinado (detalle banca)
  ring(r(-WALL_T - 0.02), WALL_H + 0.02, r(0.12), WALL_H + 0.08, thA, thB, M.metal);
  ring(r(0.12), WALL_H + 0.08, r(0.12), WALL_H + 0.02, thA, thB, M.metal);
}

// ---------- piso ----------
const ground = new THREE.Mesh(new THREE.CircleGeometry(13.05, 128), M.floor);
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
paverTex.repeat.set(26.1 / 2.4, 26.1 / 2.4);
// anillo de piso alrededor de la banca central (círculo en planta, r≈3.7 m)
const inlay = new THREE.Mesh(new THREE.RingGeometry(3.62, 3.74, 128), new THREE.MeshStandardMaterial({ color: 0x5d5853, roughness: 0.8 }));
inlay.rotation.x = -Math.PI / 2; inlay.position.y = 0.003; inlay.receiveShadow = true; scene.add(inlay);
// césped perimetral (contexto, estimado)
const lawn = new THREE.Mesh(new THREE.RingGeometry(13, 150, 128), new THREE.MeshStandardMaterial({ color: 0x3e5f2e, roughness: 1 })); lawn.rotation.x = -Math.PI / 2; lawn.position.y = 0.002; scene.add(lawn);

// ---------- vegetación ----------
const leafMats = [0x3f7a35, 0x4f8a3e, 0x2f6328, 0x6a9a4a].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
const barkMat = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 });
const ico = new THREE.IcosahedronGeometry(1, 2);
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function shrub(p, s = 1, n = 7) {
  const g = new THREE.Group(); g.position.copy(p);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(ico, leafMats[(rnd() * 4) | 0]);
    const a = rnd() * 6.28, d = rnd() * 0.35 * s, k = (0.22 + rnd() * 0.2) * s;
    m.position.set(Math.cos(a) * d, k * 0.8 + rnd() * 0.15 * s, Math.sin(a) * d); m.scale.set(k, k * 0.85, k);
    m.rotation.set(rnd() * 3, rnd() * 3, 0); m.castShadow = m.receiveShadow = true; g.add(m);
  }
  world.add(g); return g;
}
function grassTuft(p, s = 1) { // gramínea ornamental
  const g = new THREE.Group(); g.position.copy(p);
  const geo = new THREE.ConeGeometry(0.015, 0.7 * s, 3);
  for (let i = 0; i < 28; i++) { const m = new THREE.Mesh(geo, leafMats[3]); m.position.y = 0.32 * s; m.rotation.set((rnd() - 0.5) * 0.9, rnd() * 6, (rnd() - 0.5) * 0.9); m.castShadow = true; g.add(m); }
  world.add(g);
}
// Conífera tipo araucaria (como en el corte de la banca exterior) — ramas en verticilos con follaje instanciado
const leafInst = [[], [], []], branchInst = [];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v = new THREE.Vector3();
function tree(p, H = 4.8) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.14, H, 8), barkMat); trunk.position.copy(p); trunk.position.y += H / 2; trunk.castShadow = true; world.add(trunk);
  const whorls = 10, rot0 = rnd() * 6;
  for (let i = 0; i < whorls; i++) {
    const t = i / (whorls - 1), y = p.y + 1.5 + t * (H - 1.7), Lb = 1.25 * (1 - t) + 0.3;
    for (let k = 0; k < 7; k++) {
      const a = rot0 + i * 0.5 + k * Math.PI * 2 / 7 + (rnd() - 0.5) * 0.3, up = 0.12 + rnd() * 0.12;
      const dir = new THREE.Vector3(Math.cos(a), up, Math.sin(a)).normalize();
      _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); _v.copy(p).setY(y).addScaledVector(dir, Lb / 2);
      branchInst.push(new THREE.Matrix4().compose(_v.clone(), _q.clone(), new THREE.Vector3(1, Lb, 1)));
      for (const f of [0.2, 0.33, 0.46, 0.59, 0.72, 0.85, 0.97, 1.06]) {
        const sz = 0.5 * (0.16 + 0.16 * f) * (0.8 + rnd() * 0.4) * (0.75 + 0.35 * (1 - t));
        _v.copy(p).setY(y).addScaledVector(dir, Lb * f); _v.y += -0.05 * f + (rnd() - 0.5) * 0.12; _v.x += (rnd() - 0.5) * 0.1; _v.z += (rnd() - 0.5) * 0.1;
        _q.setFromEuler(new THREE.Euler(rnd() * 0.4, a, rnd() * 0.4));
        leafInst[(i + k) % 3].push(new THREE.Matrix4().compose(_v.clone(), _q.clone(), new THREE.Vector3(sz * 1.2, sz * 0.65, sz)));
      }
    }
  }
  for (let j = 0; j < 4; j++) { _v.copy(p).setY(p.y + H + 0.05 - j * 0.12); leafInst[j % 3].push(new THREE.Matrix4().compose(_v.clone(), new THREE.Quaternion(), new THREE.Vector3(0.28 - j * 0.03, 0.22, 0.28 - j * 0.03))); }
}
function buildInstances() {
  const bg = new THREE.CylinderGeometry(0.025, 0.04, 1, 5);
  const bm = new THREE.InstancedMesh(bg, barkMat, branchInst.length); branchInst.forEach((m, i) => bm.setMatrixAt(i, m)); bm.castShadow = true; world.add(bm);
  leafInst.forEach((arr, k) => { const im = new THREE.InstancedMesh(ico, leafMats[k], arr.length); arr.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = im.receiveShadow = true; world.add(im); });
}
function treePit(p, th) { // alcorque cuadrado 0.90 m
  const g = new THREE.Group(); g.position.copy(p); g.rotation.y = th * D2R;
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.9), new THREE.MeshStandardMaterial({ color: 0x55585b, roughness: 0.6, metalness: 0.4 }));
  box.position.y = SOIL_H + 0.03; box.receiveShadow = true; g.add(box);
  const grate = new THREE.Mesh(new THREE.CircleGeometry(0.3, 32), M.soil); grate.rotation.x = -Math.PI / 2; grate.position.y = SOIL_H + 0.065; g.add(grate);
  world.add(g);
}

// ---------- estacas L3 (KYR068541, GU10 4.6 W, 3000 K, 36°) ----------
const spots = [], beams = [];
const stakeBody = new THREE.CylinderGeometry(0.029, 0.029, 0.17, 20);
const stakeVisor = new THREE.CylinderGeometry(0.032, 0.032, 0.07, 20, 1, true, 0, Math.PI);
function stake(base, target) {
  const g = new THREE.Group(); g.position.copy(base); world.add(g);
  const spike = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 6), M.black); spike.position.y = 0.04; g.add(spike);
  const dir = new THREE.Vector3().subVectors(target, base.clone().add(new THREE.Vector3(0, 0.12, 0))).normalize();
  const head = new THREE.Group(); head.position.y = 0.12; head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); g.add(head);
  const body = new THREE.Mesh(stakeBody, M.black); body.castShadow = true; head.add(body);
  const visor = new THREE.Mesh(stakeVisor, M.black); visor.position.y = 0.115; head.add(visor);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.022, 20), M.lens); lens.position.y = 0.087; lens.rotation.x = -Math.PI / 2; head.add(lens);
  const lensPos = base.clone().add(new THREE.Vector3(0, 0.12, 0)).addScaledVector(dir, 0.09);
  const S = new THREE.SpotLight(K3000, 0, 14, 18 * D2R, 0.45, 2);
  S.userData.k = Math.min(1, Math.pow(lensPos.distanceTo(target) / 2.6, 2));
  S.position.copy(lensPos); S.target.position.copy(target); world.add(S); world.add(S.target); spots.push(S);
  // cono visible del haz 36°
  const L = Math.min(3.2, lensPos.distanceTo(target) * 1.25);
  const cg = new THREE.ConeGeometry(L * Math.tan(18 * D2R), L, 32, 1, true); cg.translate(0, -L / 2, 0);
  const cm = new THREE.MeshBasicMaterial({ color: K3000, alphaMap: beamTex, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const cone = new THREE.Mesh(cg, cm); cone.position.copy(lensPos); cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir); world.add(cone); beams.push(cone);
}

// ---------- tomacorrientes TE ----------
function socket(rW, dir, th) {
  const p = polar(rW + dir * 0.006, th, (BACK_TOP + WALL_H) / 2 + 0.005);
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.075, 0.012), M.socket); m.position.copy(p); m.lookAt(polar(rW + dir * 2, th, p.y)); world.add(m);
}

// ---------- etiquetas ----------
const labels = [];
function label(text, p) { const d = document.createElement('div'); d.className = 'lbl'; d.textContent = text; const o = new CSS2DObject(d); o.position.copy(p); scene.add(o); labels.push(o); }

// ================== MODELO ==================
// Banca central (Jardinera 1): muro r=2.40, asiento hacia afuera hasta r≈3.20
const RC = 2.40;
bench(RC, +1, 0, 360, 6);
wall(RC, +1, 0, 360);
ring(0.001, SOIL_H, RC - WALL_T, SOIL_H, 0, 360, M.grass, 96);
[0, 90, 180, 270].forEach(th => socket(RC, +1, th + 45));
tree(new THREE.Vector3(0, SOIL_H, 0), 3.4);
for (let i = 0; i < 3; i++) { const th = i * 120 + 30; grassTuft(polar(1.5, th, SOIL_H), 0.9); }
for (let i = 0; i < 3; i++) { const th = 90 + i * 120; shrub(polar(1.55, th + 60, SOIL_H), 0.75, 6); }
// 3 estacas en Jardinera 1
for (let i = 0; i < 3; i++) { const th = 90 + i * 120; stake(polar(1.85, th, SOIL_H), polar(0.15, th, 2.6)); }

// Bancas exteriores en arco (arriba y abajo del plano), θ 20°–160° y -160°–-20°
const RI = 6.15, RO = 8.20; // muros de respaldo (banca interior mira al centro, exterior mira afuera)
const RP = (RI + WALL_T + RO - WALL_T) / 2; // eje de jardinera 2 ≈ 7.18 m
for (const s of [+1, -1]) {
  const a = s > 0 ? 20 : -160, b = s > 0 ? 160 : -20;
  bench(RI, -1, a, b, 3); wall(RI, -1, a, b);
  bench(RO, +1, a, b, 3); wall(RO, +1, a, b);
  // tapas de los extremos de la jardinera
  for (const th of [a, b]) cap([[0, 0], [RO - RI, 0], [RO - RI, WALL_H], [0, WALL_H]], u => RI + u, th, M.concrete);
  ring(RI + WALL_T, SOIL_H, RO - WALL_T, SOIL_H, a, b, M.grass);
  // 3 árboles en alcorques (Jardinera 2) + 2 estacas por árbol
  for (const th of [a + 32, a + 70, a + 108]) {
    treePit(polar(RP, th), th); tree(polar(RP, th, SOIL_H), 4.4 + rnd() * 0.8);
    stake(polar(RP - 0.62, th, SOIL_H), polar(RP - 0.1, th, 3.1));
    stake(polar(RP + 0.62, th, SOIL_H), polar(RP + 0.1, th, 3.1));
    shrub(polar(RP - 0.35, th + 9, SOIL_H), 0.7, 5); shrub(polar(RP + 0.35, th - 9, SOIL_H), 0.7, 5);
  }
  // Jardineras 3 y 4 en los extremos: arbustos + 2 estacas cada una
  for (const [th, dth] of [[a + 7, 1], [b - 7, -1]]) {
    tree(polar(RP, th + 2 * dth, SOIL_H), 2.6); shrub(polar(RP, th + 6 * dth, SOIL_H), 0.8, 7); grassTuft(polar(RP + 0.55, th + 1 * dth, SOIL_H)); grassTuft(polar(RP - 0.55, th + 1 * dth, SOIL_H));
    stake(polar(RP - 0.5, th - 4 * dth, SOIL_H), polar(RP - 0.05, th + 2 * dth, 2.2));
    stake(polar(RP + 0.5, th - 4 * dth, SOIL_H), polar(RP + 0.05, th + 2 * dth, 2.2));
  }
  for (const th of [a + 20, a + 50, a + 90, a + 120]) grassTuft(polar(RP + (rnd() - 0.5) * 0.8, th, SOIL_H), 0.8);
  // 6 tomacorrientes por arco
  [a + 32, a + 70, a + 108].forEach(th => { socket(RI, -1, th + 12); socket(RO, +1, th - 12); });
}
buildInstances();
label('Banca central · Jardinera 1', new THREE.Vector3(0, 2.3, 0));
label('Jardinera 2 · banca doble', polar(RP, 70, 2.0)); label('Jardinera 2 · banca doble', polar(RP, -110, 2.0));
label('Jardinera 3', polar(RP, 27, 1.6)); label('Jardinera 4', polar(RP, 153, 1.6));
label('Jardinera 3', polar(RP, -27, 1.6)); label('Jardinera 4', polar(RP, -153, 1.6));
label('Acceso', polar(7.2, 0, 0.3)); label('Acceso', polar(7.2, 180, 0.3)); label('Hacia el Faro →', polar(15, 0, 0.3));

// Contexto: fachada del centro comercial hacia el Faro (estimado)
const bldg = new THREE.Group(); scene.add(bldg);
const facade = new THREE.Mesh(new THREE.BoxGeometry(6, 9, 46), new THREE.MeshStandardMaterial({ color: 0x6f6a63, roughness: 0.9 }));
facade.position.set(46, 4.5, 0); facade.receiveShadow = true; bldg.add(facade);
const winMat = new THREE.MeshStandardMaterial({ color: 0x222833, emissive: new THREE.Color(1, 0.78, 0.5), emissiveIntensity: 0, roughness: 0.3 });
for (let k = 0; k < 2; k++) for (let i = -4; i <= 4; i++) { const w = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.4), winMat); w.position.set(42.98, 2 + k * 4, i * 5); w.rotation.y = -Math.PI / 2; bldg.add(w); }

// ---------- cielo y luces ----------
const skyU = { top: { value: new THREE.Color() }, bot: { value: new THREE.Color() } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader: 'uniform vec3 top; uniform vec3 bot; varying vec3 vP; void main(){ float t = clamp(vP.y*1.6+0.05,0.0,1.0); gl_FragColor = vec4(mix(bot,top,pow(t,0.7)),1.0); }'
}));
scene.add(sky);
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.castShadow = true; sun.shadow.mapSize.set(HQ ? 4096 : 2048, HQ ? 4096 : 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 80 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
scene.add(sun); scene.add(sun.target);

// ---------- postproceso ----------
const composer = new EffectComposer(renderer);
composer.setPixelRatio(DPR); composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.9, 0.55, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

let mode = 'noche';
function setMode(m) {
  mode = m; const night = m === 'noche';
  scene.fog = new THREE.Fog(night ? 0x0b1220 : 0xcfdcea, 35, 140);
  skyU.top.value.set(night ? 0x02040c : 0x5d8fd0); skyU.bot.value.set(night ? 0x1a2236 : 0xdfe9f3);
  hemi.color.set(night ? 0x5a6f9a : 0xcfe3ff); hemi.groundColor.set(night ? 0x0e0c0a : 0x7a6a55); hemi.intensity = night ? 1.1 : 1.1;
  sun.color.set(night ? 0x9fb4ff : 0xfff1dc); sun.intensity = night ? 0.35 : 3.2;
  sun.position.set(night ? -10 : 12, night ? 22 : 20, night ? -8 : 9);
  renderer.toneMappingExposure = night ? 1.3 : 0.95;
  spots.forEach(s => s.intensity = night ? 90 * s.userData.k : 0);
  stripLights.forEach(l => l.intensity = night ? 0.25 : 0);
  beams.forEach(b => b.visible = night);
  glowMeshes.forEach(g => g.visible = night);
  M.led.color.copy(K2300).multiplyScalar(night ? 5.5 : 1.1);
  M.lens.color.copy(K3000).multiplyScalar(night ? 9 : 0.2);
  M.recess.emissiveIntensity = night ? 0.22 : 0;
  winMat.emissiveIntensity = night ? 0.12 : 0;
  bloom.strength = night ? 0.7 : 0.08;
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
}

const VIEWS = {
  aerea: { p: [0, 19, 18.5], t: [0, 0, 0.6], fov: 45 },
  bancas: { p: polar(3.75, -112, 1.5).toArray(), t: polar(6.4, -42, 0.55).toArray(), fov: 55 },
  estacas: { p: polar(6.95, 112, 1.5).toArray(), t: polar(7.18, 90, 1.15).toArray(), fov: 55 },
  central: { p: [4.4, 1.65, 2.9], t: [0, 0.75, 0], fov: 50 },
};
function setView(v) {
  let V = VIEWS[v] || VIEWS.aerea;
  if (Q.get('cam')) V = { p: Q.get('cam').split(',').map(Number), t: Q.get('tgt').split(',').map(Number), fov: +(Q.get('fov') || 50) };
  camera.position.set(...V.p); controls.target.set(...V.t);
  if (camera.aspect < 1 && v === 'aerea' && !Q.get('cam')) camera.position.sub(controls.target).multiplyScalar(1.9).add(controls.target); camera.fov = V.fov; camera.updateProjectionMatrix(); controls.update();
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
}
document.querySelectorAll('#modes button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
document.querySelectorAll('#views button').forEach(b => b.onclick = () => setView(b.dataset.view));
let showLabels = Q.get('labels') !== '0';
const btnL = document.getElementById('btnLabels');
function applyLabels() { labels.forEach(l => l.visible = showLabels); btnL.classList.toggle('on', showLabels); }
btnL.onclick = () => { showLabels = !showLabels; applyLabels(); };
const info = document.getElementById('info');
document.getElementById('btnInfo').onclick = () => info.hidden = !info.hidden;
document.getElementById('closeInfo').onclick = () => info.hidden = true;
setMode(Q.get('mode') === 'dia' ? 'dia' : 'noche'); setView(Q.get('view') || 'aerea'); applyLabels();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); labelRenderer.setSize(innerWidth, innerHeight);
});
let frames = 0;
renderer.setAnimationLoop(() => {
  controls.update(); composer.render(); labelRenderer.render(scene, camera);
  if (++frames === 3) window.__ready = true;
});
