// Paper & pen theme: a notebook on a wooden desk, ink that "boils" like
// hand-drawn animation, a 3D pen that draws every stroke, margin doodles,
// page flips between rounds, star doodles for wins and a cat for draws.

import * as THREE from '../vendor/three.module.min.js';
import { tween, ease } from './anim.js';
import { PLAYERS, runEnds } from './rules.js';

export const PAPER_BG = 0x9b6b42;
export const GRAPHITE = 0x46464f;
const BOIL_FPS = 8;

const rnd = (a = 1) => (Math.random() - 0.5) * a;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const V = (x, z) => new THREE.Vector3(x, 0, z);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- textures
function canvasTex(S, draw, repeat = true) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  draw(cv.getContext('2d'), S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function grain(g, S, amt) {
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amt;
    d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.9;
  }
  g.putImageData(img, 0, 0);
}

// one 512px tile = 4 world units, ruled every board cell
let _page = null;
function pageTexture() {
  if (_page) return _page;
  _page = canvasTex(512, (g, S) => {
    g.fillStyle = '#fbf6e9';
    g.fillRect(0, 0, S, S);
    grain(g, S, 9);
    g.strokeStyle = 'rgba(150,130,100,0.07)';
    for (let i = 0; i < 160; i++) {
      const x = Math.random() * S, y = Math.random() * S, a = Math.random() * Math.PI, l = 4 + Math.random() * 10;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    g.strokeStyle = 'rgba(70,120,200,0.33)';
    g.lineWidth = 2.2;
    for (let y = 64; y < S; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
  });
  return _page;
}

let _wood = null;
function woodTexture() {
  if (_wood) return _wood;
  _wood = canvasTex(1024, (g, S) => {
    const plank = S / 4;
    for (let p = 0; p < 4; p++) {
      const base = [[184, 128, 78], [170, 116, 70], [192, 136, 84], [176, 122, 74]][p];
      g.fillStyle = `rgb(${base})`;
      g.fillRect(0, p * plank, S, plank);
      for (let k = 0; k < 70; k++) { // grain lines
        const y0 = p * plank + Math.random() * plank;
        const amp = 2 + Math.random() * 6, ph = Math.random() * 6, fr = 0.004 + Math.random() * 0.01;
        g.strokeStyle = Math.random() < 0.5 ? `rgba(90,52,25,${0.08 + Math.random() * 0.14})` : `rgba(235,190,130,${0.06 + Math.random() * 0.1})`;
        g.lineWidth = 0.6 + Math.random() * 1.8;
        g.beginPath();
        for (let x = 0; x <= S; x += 16) g.lineTo(x, y0 + Math.sin(x * fr + ph) * amp);
        g.stroke();
      }
      if (Math.random() < 0.8) { // a knot
        const kx = Math.random() * S, ky = p * plank + plank * (0.3 + Math.random() * 0.4);
        for (let r = 14; r > 2; r -= 3) {
          g.strokeStyle = 'rgba(80,45,20,0.25)';
          g.beginPath(); g.ellipse(kx, ky, r * 2.2, r * 0.8, 0, 0, Math.PI * 2); g.stroke();
        }
      }
      g.fillStyle = 'rgba(60,32,14,0.55)'; // seam
      g.fillRect(0, p * plank, S, 3);
    }
    grain(g, S, 12);
  });
  _wood.repeat.set(10, 10);
  return _wood;
}

// ---------------------------------------------------------------- strokes
// Flat ink ribbon along points; indices run along the stroke so
// setDrawRange reveals it like a pen drawing it.
export function ribbonGeometry(pts, width) {
  const n = pts.length;
  const pos = new Float32Array(n * 2 * 3);
  const idx = [];
  const t = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    t.subVectors(b, a).setY(0).normalize();
    const u = i / (n - 1);
    const w = width * (0.55 + 0.45 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15 + 0.04)), 0.35)) / 2;
    const p = pts[i];
    pos.set([p.x - t.z * w, p.y, p.z + t.x * w, p.x + t.z * w, p.y, p.z - t.x * w], i * 6);
    if (i < n - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.userData.segments = n - 1;
  return geo;
}

export function inkMaterial(hex, opacity = 0.92) {
  return new THREE.MeshBasicMaterial({
    color: hex, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

// smooth, low-frequency wobble for the boil variants
function jitter(pts, amp) {
  const p1 = Math.random() * 6, p2 = Math.random() * 6, f = 0.5 + Math.random() * 0.5;
  return pts.map((p, i) => p.clone().add(V(Math.sin(i * f + p1) * amp + rnd(amp * 0.4), Math.cos(i * f * 1.3 + p2) * amp + rnd(amp * 0.4))));
}

// A stroke = 3 slightly different drawings that alternate (line boil).
function makeStroke(pts, width, mat, y = 0.01, amp = 0.007) {
  pts.forEach((p) => { p.y = y; });
  const g = new THREE.Group();
  const geos = [pts, jitter(pts, amp), jitter(pts, amp)].map((v, k) => {
    const geo = ribbonGeometry(v, width);
    const m = new THREE.Mesh(geo, mat);
    m.visible = k === 0;
    g.add(m);
    return geo;
  });
  g.userData = { boil: true, geos, pts, segments: geos[0].userData.segments };
  return g;
}
function reveal(stroke, k) {
  const n = k >= 1 ? Infinity : Math.ceil(k * stroke.userData.segments) * 6;
  stroke.userData.geos.forEach((geo) => geo.setDrawRange(0, n));
}

// ---------------------------------------------------------------- paths
function wobblyLine(a, b, steps = 16, bow = 0.04, wob = 0.008) {
  const out = [];
  const dir = b.clone().sub(a);
  const nrm = V(-dir.z, dir.x).normalize();
  const k = rnd(2) * bow;
  const ph = Math.random() * 6;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const p = a.clone().lerp(b, u);
    p.addScaledVector(nrm, Math.sin(Math.PI * u) * k + Math.sin(u * 9 + ph) * wob);
    out.push(p);
  }
  return out;
}

function polyline(corners, perEdge = 8) {
  const out = [];
  for (let c = 0; c < corners.length - 1; c++) {
    const seg = wobblyLine(corners[c], corners[c + 1], perEdge, 0.02, 0.004);
    if (c > 0) seg.shift();
    out.push(...seg);
  }
  return out;
}

function loopPath(r = 0.3, cx = 0, cz = 0, steps = 48, over = 0.3) {
  const rx = 1 + rnd(0.12), rz = 1 + rnd(0.12);
  const a0 = -Math.PI / 2 + rnd(0.8);
  const total = Math.PI * 2 + over + Math.random() * 0.3;
  const ph = Math.random() * 6;
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const a = a0 - total * u;
    const rr = r * (1 + 0.05 * Math.sin(a * 2 + ph) + u * 0.05);
    out.push(V(cx + Math.cos(a) * rr * rx, cz + Math.sin(a) * rr * rz));
  }
  return out;
}

function arc(r, a0, a1, cx = 0, cz = 0, steps = 14) {
  return Array.from({ length: steps + 1 }, (_, i) => { const a = a0 + (a1 - a0) * (i / steps); return V(cx + Math.cos(a) * r, cz + Math.sin(a) * r); });
}

function markStrokes(seat) {
  const j = (a) => rnd(a);
  if (seat === 0) {
    const s = 0.29;
    return [
      wobblyLine(V(-s + j(0.05), -s + j(0.05)), V(s + j(0.05), s + j(0.05)), 14, 0.05),
      wobblyLine(V(s + j(0.05), -s + j(0.05)), V(-s + j(0.05), s + j(0.05)), 14, 0.05),
    ];
  }
  if (seat === 1) return [loopPath(0.29, j(0.03), j(0.03))];
  if (seat === 2) {
    const top = V(j(0.04), -0.32), br = V(0.3 + j(0.04), 0.24 + j(0.03)), bl = V(-0.3 + j(0.04), 0.24 + j(0.03));
    return [polyline([top, br, bl, top.clone().add(V(0.05, 0.04))])];
  }
  const s = 0.27;
  const c = [V(-s + j(0.03), -s + j(0.03)), V(s + j(0.03), -s + j(0.03)), V(s + j(0.03), s + j(0.03)), V(-s + j(0.03), s + j(0.03))];
  return [polyline([...c, c[0].clone().add(V(0.06, 0.01))])];
}
const STROKE_TIME = [0.17, 0.4, 0.42, 0.44];

// doodles, roughly 1 unit across, centred on 0
const DOODLES = {
  star: () => {
    const pts = [];
    for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.2 : 0.5; pts.push(V(Math.cos(a) * r, Math.sin(a) * r)); }
    return [polyline(pts, 3)];
  },
  spiral: () => [Array.from({ length: 60 }, (_, i) => { const u = i / 59, a = u * Math.PI * 4.5; return V(Math.cos(a) * (0.05 + u * 0.45), Math.sin(a) * (0.05 + u * 0.45)); })],
  heart: () => [Array.from({ length: 50 }, (_, i) => {
    const t = (i / 49) * Math.PI * 2;
    return V((16 * Math.sin(t) ** 3) / 32, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 32);
  })],
  smiley: () => [loopPath(0.45, 0, 0, 40, 0.2), loopPath(0.05, -0.16, -0.12, 10, 0.1), loopPath(0.05, 0.16, -0.12, 10, 0.1), arc(0.27, 0.2 * Math.PI, 0.8 * Math.PI, 0, 0.02)],
  bolt: () => [polyline([V(0.12, -0.5), V(-0.18, 0.02), V(0.1, 0.02), V(-0.14, 0.5)], 5)],
  sparkle: () => [0, 1, 2].map((k) => { const a = (k * Math.PI) / 3; return wobblyLine(V(Math.cos(a) * -0.4, Math.sin(a) * -0.4), V(Math.cos(a) * 0.4, Math.sin(a) * 0.4), 6, 0.02); }),
  flower: () => {
    const out = [loopPath(0.1, 0, 0, 14, 0.1)];
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; out.push(loopPath(0.14, Math.cos(a) * 0.28, Math.sin(a) * 0.28, 16, 0.1)); }
    return out;
  },
};
const MARGIN_DOODLES = ['star', 'spiral', 'heart', 'smiley', 'bolt', 'flower'];

function catFace(s) {
  const S = (p) => p.map((v) => v.multiplyScalar(s));
  return [
    S(loopPath(0.5, 0, 0.05, 44, 0.15)),
    S(polyline([V(-0.42, -0.2), V(-0.36, -0.62), V(-0.1, -0.38)], 5)),
    S(polyline([V(0.42, -0.2), V(0.36, -0.62), V(0.1, -0.38)], 5)),
    S(loopPath(0.06, -0.18, -0.02, 10, 0.1)),
    S(loopPath(0.06, 0.18, -0.02, 10, 0.1)),
    S(polyline([V(-0.05, 0.12), V(0.05, 0.12), V(0, 0.18), V(-0.05, 0.12)], 3)),
    S(polyline([V(-0.14, 0.26), V(-0.07, 0.31), V(0, 0.22), V(0.07, 0.31), V(0.14, 0.26)], 3)),
    S(wobblyLine(V(-0.2, 0.17), V(-0.68, 0.08), 6, 0.03)),
    S(wobblyLine(V(-0.2, 0.22), V(-0.66, 0.3), 6, 0.03)),
    S(wobblyLine(V(0.2, 0.17), V(0.68, 0.08), 6, 0.03)),
    S(wobblyLine(V(0.2, 0.22), V(0.66, 0.3), 6, 0.03)),
  ];
}

// ---------------------------------------------------------------- the pen
class Pen {
  constructor(parent) {
    this.group = new THREE.Group();
    const tilt = new THREE.Group(); // tip at the group origin
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x1d47c4, roughness: 0.35, metalness: 0.1 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.4 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xc9c9cf, roughness: 0.25, metalness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.6 });
    const add = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; tilt.add(m); return m; };
    add(new THREE.SphereGeometry(0.014, 10, 8), dark, 0.012);
    add(new THREE.CylinderGeometry(0.018, 0.05, 0.16, 16), metal, 0.09);
    add(new THREE.CylinderGeometry(0.062, 0.058, 0.36, 20), dark, 0.34);
    add(new THREE.CylinderGeometry(0.06, 0.062, 1.05, 6), white, 1.04);
    add(new THREE.CylinderGeometry(0.066, 0.066, 0.42, 20), this.bodyMat, 1.55);
    add(new THREE.SphereGeometry(0.066, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.bodyMat, 1.76);
    const clip = add(new THREE.BoxGeometry(0.03, 0.34, 0.02), this.bodyMat, 1.55);
    clip.position.z = 0.075;
    tilt.rotation.set(0.38, 0, -0.5);
    this.tilt = tilt;
    this.group.add(tilt);
    parent.add(this.group);
    this.rest = new THREE.Vector3(2, 1, 1);
    this.group.position.copy(this.rest);
    this.busy = false;
    this.t = 0;
  }
  setColor(hex) { this.bodyMat.color.setHex(hex); }
  update(dt) {
    this.t += dt;
    if (this.busy) { this.tilt.rotation.z = -0.5; return; }
    const target = this.rest.clone();
    target.y += Math.sin(this.t * 1.6) * 0.06;
    this.group.position.lerp(target, 1 - Math.exp(-dt * 5));
    this.tilt.rotation.z = -0.5 + Math.sin(this.t * 1.1) * 0.06; // idle sway
  }
}

// ---------------------------------------------------------------- props
function mug() {
  const g = new THREE.Group();
  const ceramic = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.35 });
  const band = new THREE.MeshStandardMaterial({ color: 0xd42a2a, roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.55, 1.35, 32, 1, true), ceramic);
  body.position.y = 0.675;
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.57, 0.5, 1.3, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xe8e3d8, side: THREE.BackSide }));
  inner.position.y = 0.7;
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.55, 32).rotateX(-Math.PI / 2), ceramic);
  bottom.position.y = 0.01;
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.56, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3b2314, roughness: 0.15 }));
  coffee.position.y = 1.12;
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.625, 0.6, 0.22, 32, 1, true), band);
  stripe.position.y = 0.95;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.08, 10, 24, Math.PI * 1.2), ceramic);
  handle.rotation.set(0, 0, -Math.PI * 0.6);
  handle.position.set(0.6, 0.68, 0);
  g.add(body, inner, bottom, coffee, stripe, handle);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function pencil() {
  const g = new THREE.Group();
  const add = (geo, color, y, opts = {}) => {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...opts }));
    m.position.y = y; m.castShadow = true; g.add(m);
  };
  add(new THREE.CylinderGeometry(0.11, 0.11, 2.6, 6), 0xf4c20d, 0);
  add(new THREE.CylinderGeometry(0.02, 0.11, 0.42, 6), 0xe9c9a0, 1.51);
  add(new THREE.CylinderGeometry(0.004, 0.024, 0.09, 8), 0x333333, 1.7);
  add(new THREE.CylinderGeometry(0.115, 0.115, 0.22, 16), 0xb9b9be, -1.4, { metalness: 0.8, roughness: 0.3 });
  add(new THREE.CylinderGeometry(0.11, 0.11, 0.24, 16), 0xf08aa0, -1.62);
  g.rotation.z = Math.PI / 2;
  const holder = new THREE.Group();
  holder.add(g);
  g.position.y = 0.11;
  return holder;
}

function eraser() {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.28, 0.5), new THREE.MeshStandardMaterial({ color: 0xf28fa2, roughness: 0.9 }));
  m.position.y = 0.14;
  m.castShadow = true;
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.52), new THREE.MeshStandardMaterial({ color: 0x2e6fd8, roughness: 0.6 }));
  sleeve.position.set(0.22, 0.14, 0);
  sleeve.castShadow = true;
  const g = new THREE.Group();
  g.add(m, sleeve);
  return g;
}

function stickyNotes() {
  const g = new THREE.Group();
  const colors = [0xffe066, 0xff9fb4, 0x9fe6ff];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.03, 1.5), new THREE.MeshStandardMaterial({ color: i === 5 ? colors[0] : colors[i % 3], roughness: 0.9 }));
    m.position.y = 0.015 + i * 0.03;
    m.rotation.y = rnd(0.25);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  const heart = makeStroke(DOODLES.heart()[0].map((p) => p.multiplyScalar(0.9)), 0.07, inkMaterial(0xd42a2a, 0.85), 0.19);
  g.add(heart);
  return g;
}

function paperBall() {
  const geo = new THREE.IcosahedronGeometry(0.42, 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    v.multiplyScalar(1 + rnd(0.32));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xf6f0e2, roughness: 0.95, flatShading: true }));
  m.position.y = 0.36;
  m.castShadow = true;
  return m;
}

// ---------------------------------------------------------------- stage
export class PaperStage {
  constructor(arena) {
    this.a = arena;
    this.world = new THREE.Group();
    arena.scene.add(this.world);

    const desk = new THREE.Mesh(new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.7, metalness: 0.0 }));
    desk.position.y = -0.14;
    desk.receiveShadow = true;
    this.world.add(desk);

    const sun = new THREE.DirectionalLight(0xfff0d8, 1.9);
    sun.position.set(-5, 12, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    this.sun = sun;
    this.world.add(sun, sun.target);

    this.props = new THREE.Group();
    this.world.add(this.props);
    this.pen = new Pen(this.world);
    this.boilClock = 0;
    this.boilFrame = 0;
  }

  setVisible(on) { this.world.visible = on; }

  // ---------------------------------------------------------- board
  buildBoard(n) {
    const a = this.a, half = n / 2;
    this.W = n + 2.6;
    this.H = n + 3.0;
    this.sheetZ = 0.25;

    // notebook: top page plus a few pages peeking out underneath
    const tex = pageTexture().clone();
    tex.needsUpdate = true;
    tex.repeat.set(this.W / 4, this.H / 4);
    tex.offset.set(0, 0.5 - ((this.H / 4) % 1) / 2 + 0.125);
    this.pageMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
    const edge = new THREE.MeshStandardMaterial({ color: 0xf1ead9, roughness: 0.95 });
    const sheet = new THREE.Mesh(new THREE.BoxGeometry(this.W, 0.06, this.H), [edge, edge, this.pageMat, edge, edge, edge]);
    sheet.position.set(0, -0.03, this.sheetZ);
    sheet.receiveShadow = true;
    a.board.add(sheet);
    for (let k = 1; k <= 2; k++) {
      const under = new THREE.Mesh(new THREE.BoxGeometry(this.W, 0.04, this.H), edge);
      under.position.set(rnd(0.12), -0.06 - k * 0.02, this.sheetZ + 0.03 * k);
      under.rotation.y = rnd(0.03);
      under.receiveShadow = true;
      a.board.add(under);
    }
    // spiral binding
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xbfc3c9, metalness: 0.9, roughness: 0.25 });
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x5d4a35 });
    const top = this.sheetZ - this.H / 2;
    const count = Math.floor(this.W / 0.45);
    for (let i = 0; i < count; i++) {
      const x = -this.W / 2 + 0.3 + i * ((this.W - 0.6) / (count - 1));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.028, 8, 20), ringMat);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(x, 0, top + 0.05);
      ring.castShadow = true;
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.06, 14).rotateX(-Math.PI / 2), holeMat);
      hole.position.set(x, 0.002, top + 0.2);
      a.board.add(ring, hole);
    }
    // red margin line
    const margin = new THREE.Mesh(new THREE.PlaneGeometry(0.035, this.H - 0.1).rotateX(-Math.PI / 2), inkMaterial(0xd44a4a, 0.5));
    margin.position.set(-half - 0.55, 0.002, this.sheetZ);
    a.board.add(margin);

    a._makeTiles(n, false); // invisible, for picking
    this.drawGrid(n, 0);
    this.drawMarginDoodles(n, 300 + n * 140);
    this.layoutProps(n);

    const s = n + 7;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 40 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.placePenRest();
  }

  // pencil grid, sketched in line by line
  drawGrid(n, delay = 0) {
    const a = this.a, half = n / 2, gen = a.gen;
    const grp = new THREE.Group();
    a.board.add(grp);
    this.grid = grp;
    const mat = inkMaterial(GRAPHITE, 0.82);
    const lines = [];
    for (let k = 1; k < n; k++) {
      const o = () => rnd(0.14);
      const x = -half + k + rnd(0.04);
      lines.push(wobblyLine(V(x, -half - 0.08 + o()), V(x + rnd(0.06), half + 0.08 + o()), 6 + n * 2, 0.05, 0.006));
      const z = -half + k + rnd(0.04);
      lines.push(wobblyLine(V(-half - 0.08 + o(), z), V(half + 0.08 + o(), z + rnd(0.06)), 6 + n * 2, 0.05, 0.006));
    }
    lines.forEach((pts, j) => {
      const st = makeStroke(pts, 0.05, mat, 0.004, 0.006);
      reveal(st, 0);
      grp.add(st);
      setTimeout(() => {
        if (gen !== a.gen) { reveal(st, 1); return; }
        tween(0.2, (k) => reveal(st, k), ease.inOut);
      }, delay + j * 60);
    });
  }

  drawMarginDoodles(n, delay) {
    const a = this.a, half = n / 2, gen = a.gen;
    const spots = [
      [-half - 0.85, -half - 0.8], [half + 0.8, -half - 0.8], [-half - 0.85, half + 0.75], [half + 0.8, half + 0.8], [0, -half - 0.95], [0, half + 0.95],
    ].sort(() => Math.random() - 0.5).slice(0, 3 + (Math.random() < 0.5 ? 1 : 0));
    const kinds = MARGIN_DOODLES.slice().sort(() => Math.random() - 0.5);
    this.doodles = new THREE.Group();
    a.board.add(this.doodles);
    spots.forEach(([x, z], j) => {
      const col = pick([GRAPHITE, PLAYERS[0].hex, PLAYERS[1].hex, 0x9a6bd1]);
      const sc = 0.45 + Math.random() * 0.2;
      const rot = rnd(0.6);
      const mat = inkMaterial(col, 0.55);
      DOODLES[kinds[j % kinds.length]]().forEach((pts) => {
        pts.forEach((p) => { p.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).multiplyScalar(sc); p.x += x; p.z += z; });
        const st = makeStroke(pts, 0.045, mat, 0.003, 0.008);
        reveal(st, 0);
        this.doodles.add(st);
        setTimeout(() => {
          if (gen !== a.gen) { reveal(st, 1); return; }
          tween(0.3, (k) => reveal(st, k), ease.inOut);
        }, delay + j * 250);
      });
    });
  }

  layoutProps(n) {
    for (const ch of [...this.props.children]) { this.props.remove(ch); this.a._dispose(ch); }
    const W = this.W, H = this.H, z0 = this.sheetZ;
    const put = (obj, x, z, ry = 0, y = -0.14) => { obj.position.set(x, y, z); obj.rotation.y = ry; this.props.add(obj); };
    put(mug(), -W / 2 - 1.3, z0 - H * 0.28, 0.5);
    put(pencil(), W / 2 + 0.9, z0 + H * 0.12, 1.15 + rnd(0.2));
    put(eraser(), W / 2 + 1.0, z0 - H * 0.3, 0.4);
    put(stickyNotes(), -W / 2 - 1.2, z0 + H * 0.25, -0.2);
    put(paperBall(), W / 2 + 1.5, z0 + H * 0.45, 0);
  }

  // pen waits just below the board; on narrow screens further in, since it leans right
  placePenRest() {
    const half = (this.a.n || 3) / 2;
    const portrait = (this.a.camera.aspect || 1) < 1;
    if (portrait) this.pen.rest.set(half * 0.15, 0.8, half + 0.55);
    else this.pen.rest.set(half + 0.55, 0.8, half * 0.25);
  }

  setTurn(seat) { this.pen.setColor(seat == null ? PLAYERS[0].hex : PLAYERS[seat].hex); }

  // ---------------------------------------------------------- marks
  makeMark(seat, ghost = false) {
    const g = new THREE.Group();
    const mat = inkMaterial(PLAYERS[seat].hex, ghost ? 0.25 : 0.92);
    g.userData.mats = [mat];
    g.userData.strokes = markStrokes(seat).map((pts) => { const st = makeStroke(pts, 0.075, mat); g.add(st); return st; });
    g.userData.paper = true;
    return g;
  }

  // move the pen to a stroke and draw it; the pen follows the tip
  async drawStroke(st, origin, dur, usePen) {
    const pen = usePen ? this.pen : null;
    const pts = st.userData.pts, segs = st.userData.segments;
    const at = (idx) => pts[Math.min(pts.length - 1, idx)].clone().add(origin);
    reveal(st, 0);
    if (pen) {
      const from = pen.group.position.clone();
      const to = at(0).setY(0.02);
      await tween(0.11, (k) => { pen.group.position.lerpVectors(from, to, k); pen.group.position.y += Math.sin(Math.PI * k) * 0.25; }, ease.inOut);
    }
    await tween(dur, (k) => {
      reveal(st, k);
      if (pen) pen.group.position.copy(at(Math.ceil(k * segs))).setY(0.02);
    }, ease.linear);
    reveal(st, 1);
  }

  async withPen(fn, quiet = false) {
    const usePen = !quiet && !this.pen.busy;
    if (usePen) this.pen.busy = true;
    try { await fn(usePen); } finally { if (usePen) this.pen.busy = false; }
  }

  async drawMark(mark, seat, origin) {
    const gen = this.a.gen;
    mark.userData.strokes.forEach((st) => reveal(st, 0));
    await this.withPen(async (usePen) => {
      for (const st of mark.userData.strokes) {
        if (gen !== this.a.gen) break;
        await this.drawStroke(st, origin, STROKE_TIME[seat], usePen);
      }
    });
    if (gen !== this.a.gen) return;
    // a couple of ink splats where the pen lifted, and a little pop
    const last = mark.userData.strokes.at(-1).userData.pts.at(-1);
    for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) {
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.012 + Math.random() * 0.022, 10).rotateX(-Math.PI / 2), mark.userData.mats[0]);
      dot.position.set(last.x + rnd(0.22), 0.011, last.z + rnd(0.22));
      mark.add(dot);
    }
    await tween(0.24, (k) => mark.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.14), ease.out);
  }

  // ---------------------------------------------------------- outcomes
  async win(line, seat, quiet) {
    const a = this.a, gen = a.gen;
    const col = PLAYERS[seat].hex;
    a.cells.forEach((c, i) => {
      if (!c.obj || line.includes(i)) return;
      const mats = c.obj.userData.mats || [];
      tween(quiet ? 0 : 0.5, (k) => mats.forEach((m) => { m.opacity = 0.92 - k * 0.6; }));
    });
    const ends = runEnds(line, a.n);
    const paths = [];
    if (ends) {
      const p0 = a.cellPos(ends[0]), p1 = a.cellPos(ends[1]);
      const ext = p1.clone().sub(p0).setLength(0.42);
      paths.push(wobblyLine(p0.sub(ext), p1.add(ext), 10 + line.length * 6, 0.08, 0.01));
    } else {
      line.forEach((i) => { const p = a.cellPos(i); paths.push(loopPath(0.44, p.x, p.z, 40)); });
    }
    const mat = inkMaterial(col, 0.85);
    const strokes = paths.map((pts) => { const st = makeStroke(pts, 0.11, mat, 0.014, 0.01); a.board.add(st); a.winFx.push(st); return st; });
    if (quiet) return;
    await this.withPen(async (usePen) => {
      for (const st of strokes) {
        if (gen !== a.gen) return;
        await this.drawStroke(st, new THREE.Vector3(), ends ? 0.5 : 0.3, usePen);
      }
    });
    if (gen !== a.gen) return;
    // winners jump for joy, one after another
    line.forEach((i, j) => {
      const o = a.cells[i].obj;
      if (!o) return;
      setTimeout(() => tween(0.45, (k) => o.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.35), ease.out), j * 90);
    });
    // stars and sparkles doodled around the line
    const cells = line.map((i) => a.cellPos(i));
    const spots = [];
    for (let k = 0; k < 4; k++) {
      const c = pick(cells);
      const ang = Math.random() * Math.PI * 2;
      spots.push(V(c.x + Math.cos(ang) * 0.62, c.z + Math.sin(ang) * 0.62));
    }
    await this.withPen(async (usePen) => {
      for (const [j, p] of spots.entries()) {
        if (gen !== a.gen) return;
        const kind = j % 2 ? 'sparkle' : 'star';
        const sc = kind === 'star' ? 0.62 : 0.45;
        const rot = rnd(0.8);
        for (const pts of DOODLES[kind]()) {
          pts.forEach((v) => { v.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).multiplyScalar(sc); });
          const st = makeStroke(pts, 0.05, mat, 0.016, 0.01);
          st.position.copy(p);
          a.board.add(st);
          a.winFx.push(st);
          await this.drawStroke(st, p, kind === 'star' ? 0.22 : 0.07, usePen);
        }
      }
    });
  }

  // "cat's game": the pen sketches a cat over the board
  async draw(quiet) {
    const a = this.a, gen = a.gen;
    const mats = a.cells.filter((c) => c.obj).flatMap((c) => c.obj.userData.mats || []);
    tween(quiet ? 0 : 0.6, (k) => mats.forEach((m) => { m.opacity = 0.92 - k * 0.55; }), ease.out);
    const mat = inkMaterial(GRAPHITE, 0.9);
    const s = Math.min(a.n, 4) * 0.55;
    const strokes = catFace(s).map((pts) => { const st = makeStroke(pts, 0.07, mat, 0.016, 0.009); a.board.add(st); a.winFx.push(st); return st; });
    if (quiet) return;
    await this.withPen(async (usePen) => {
      for (const st of strokes) {
        if (gen !== a.gen) return;
        await this.drawStroke(st, new THREE.Vector3(), 0.08 + st.userData.segments * 0.006, usePen);
      }
    });
  }

  // new round: the page flips over the binding, revealing a fresh sheet
  async clear(animate) {
    const a = this.a;
    const live = [];
    a.cells.forEach((c) => { if (c.obj) live.push(c.obj); c.obj = null; c.seat = -1; });
    const old = [...live, ...a.winFx, this.grid, this.doodles].filter(Boolean);
    a.winFx = [];
    const n = a.n;
    if (!animate) {
      old.forEach((o) => { a.board.remove(o); a._dispose(o); });
      this.drawGrid(n, 0);
      this.drawMarginDoodles(n, 200);
      return;
    }
    const pivotZ = this.sheetZ - this.H / 2 + 0.05;
    const flip = new THREE.Group();
    flip.position.set(0, 0.004, pivotZ);
    a.board.add(flip);
    const page = new THREE.Mesh(new THREE.PlaneGeometry(this.W, this.H).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: this.pageMat.map, roughness: 0.95, side: THREE.DoubleSide }));
    page.position.set(0, 0, this.H / 2 - 0.05);
    page.castShadow = true;
    flip.add(page);
    old.forEach((o) => flip.attach(o));
    setTimeout(() => { if (a.n === n) { this.drawGrid(n, 0); this.drawMarginDoodles(n, 500); } }, 380);
    const gen = a.gen;
    await tween(0.85, (k) => {
      flip.rotation.x = -k * Math.PI * 0.97;
      flip.position.y = 0.004 + Math.sin(k * Math.PI) * 0.4;
    }, ease.inOut);
    await tween(0.25, (k) => { flip.position.y = 0.004 + k * 0.6; flip.scale.setScalar(1 - k * 0.05); }, ease.in);
    a.board.remove(flip);
    page.material.map = null; // shared with the base page
    a._dispose(flip);
    if (gen !== a.gen) return;
    await sleep(0);
  }

  celebrate() { this.a.fx.confetti(220, this.a.n + 8); }

  // ---------------------------------------------------------- per frame
  update(dt) {
    this.pen.update(dt);
    this.boilClock += dt;
    if (this.boilClock < 1 / BOIL_FPS) return;
    this.boilClock = 0;
    const f = ++this.boilFrame % 3;
    this.a.board.traverse((o) => {
      if (!o.userData?.boil) return;
      o.children.forEach((m, k) => { m.visible = k === f; });
    });
    this.props.traverse((o) => {
      if (!o.userData?.boil) return;
      o.children.forEach((m, k) => { m.visible = k === f; });
    });
  }
}
