// three.js neon arena: synthwave floor, glowing grid board, neon marks,
// bloom post-processing, picking, win beams and celebrations.

import * as THREE from '../vendor/three.module.min.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';
import { EffectComposer } from '../vendor/EffectComposer.js';
import { RenderPass } from '../vendor/RenderPass.js';
import { UnrealBloomPass } from '../vendor/UnrealBloomPass.js';
import { OutputPass } from '../vendor/OutputPass.js';
import { tween, ease, updateTweens } from './anim.js';
import { Fx3D, softSprite } from './fx3d.js';
import { PLAYERS, runEnds } from './rules.js';
import { PAPER_BG, PaperStage } from './paper.js';

const BG = 0x05020f;
const NEUTRAL = 0x8a5cff;
const MARK_Y = 0.16;

// ---------------------------------------------------------------- textures
function sunTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#ffd23f');
  grd.addColorStop(0.5, '#ff3f9e');
  grd.addColorStop(1, '#7a2cff');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(128, 128, 120, 0, Math.PI * 2);
  g.fill();
  // retro horizontal slits in the lower half
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 7; i++) {
    const y = 140 + i * 16;
    g.fillRect(0, y, 256, 2 + i * 1.3);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function pillarTexture() {
  const cv = document.createElement('canvas');
  cv.width = 4; cv.height = 128;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0.9)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(cv);
}

// ---------------------------------------------------------------- mark geometry
const markGeo = [];
function geometriesFor(seat) {
  if (markGeo[seat]) return markGeo[seat];
  let list;
  if (seat === 0) { // X: two crossed neon capsules
    const a = new THREE.CapsuleGeometry(0.075, 0.6, 6, 14).rotateZ(Math.PI / 2).rotateY(Math.PI / 4);
    const b = new THREE.CapsuleGeometry(0.075, 0.6, 6, 14).rotateZ(Math.PI / 2).rotateY(-Math.PI / 4);
    list = [a, b];
  } else if (seat === 1) { // O
    list = [new THREE.TorusGeometry(0.27, 0.075, 16, 56).rotateX(Math.PI / 2)];
  } else if (seat === 2) { // triangle, point away from the camera
    list = [new THREE.TorusGeometry(0.33, 0.07, 12, 3).rotateZ(-Math.PI / 2).rotateX(Math.PI / 2).translate(0, 0, 0.04)];
  } else { // square
    list = [new THREE.TorusGeometry(0.33, 0.07, 12, 4).rotateZ(Math.PI / 4).rotateX(Math.PI / 2)];
  }
  markGeo[seat] = list;
  return list;
}

function markMaterial(seat, ghost = false) {
  const col = new THREE.Color(PLAYERS[seat].hex);
  return new THREE.MeshStandardMaterial({
    color: col.clone().multiplyScalar(0.3),
    emissive: col,
    emissiveIntensity: ghost ? 0.6 : 1.5,
    roughness: 0.35,
    metalness: 0.2,
    transparent: ghost,
    opacity: ghost ? 0.35 : 1,
    depthWrite: !ghost,
  });
}

// ---------------------------------------------------------------- arena
export class Arena {
  constructor(canvas, { quality = 'high', theme = 'neon' } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    this.theme = theme;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.shadowMap.enabled = true; // only the paper desk casts shadows
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(BG, 1);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG);
    scene.fog = new THREE.FogExp2(BG, 0.022);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
    this.camera.position.set(0, 12, 6);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.08, enablePan: false, rotateSpeed: 0.6, zoomSpeed: 0.8,
      minPolarAngle: 0, maxPolarAngle: 1.15,
    });
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };

    this.hemi = new THREE.HemisphereLight(0x9c7bff, 0x0a0018, 0.9);
    scene.add(this.hemi);
    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(4, 10, 6);
    scene.add(key);

    this.fx = new Fx3D(scene, { floorY: 0.05, confettiColors: PLAYERS.map((p) => p.hex).concat([0xffffff]) });
    this._buildWorld();

    this.cells = [];        // { seat, obj }
    this.n = 0;
    this.turnSeat = null;
    this.interactive = false;
    this.onTap = null;
    this.onHover = null;
    this.view = 'tilt';
    this.demo = false;
    this.winFx = [];
    this.ghost = null;
    this.hoverCell = -1;

    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._initPointer();

    this._setupComposer();
    this._applyWorld();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());

    this._clock = performance.now();
    this._loop = this._loop.bind(this);
    renderer.setAnimationLoop(this._loop);
  }

  // ---------------------------------------------------------------- world
  _buildWorld() {
    const { scene } = this;
    this.neonWorld = new THREE.Group();
    this.paperWorld = new THREE.Group();
    scene.add(this.neonWorld, this.paperWorld);
    this._buildPaperWorld();
    // synthwave grid floor
    this.floorMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uA: { value: new THREE.Color(0xff2bd6) },
        uB: { value: new THREE.Color(0x00e5ff) },
        uBg: { value: new THREE.Color(BG) },
      },
      vertexShader: `varying vec3 vW;
        void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform float uTime; uniform vec3 uA; uniform vec3 uB; uniform vec3 uBg; varying vec3 vW;
        void main(){
          vec2 p = vW.xz / 2.4; p.y += uTime * 0.2;
          vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
          float line = 1.0 - min(min(g.x, g.y), 1.0);
          float d = length(vW.xz);
          float fade = exp(-d * 0.035);
          vec3 col = mix(uB, uA, smoothstep(6.0, 40.0, d)) * line * fade * 0.55;
          col += uA * 0.025 * exp(-d * 0.08);
          gl_FragColor = vec4(uBg + col, 1.0);
          #include <colorspace_fragment>
        }`,
      fog: false,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), this.floorMat);
    floor.position.y = -7;
    this.neonWorld.add(floor);

    // stars
    const N = 700, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const v = new THREE.Vector3().randomDirection();
      v.y = Math.abs(v.y) * 0.9 + 0.05;
      v.multiplyScalar(110 + Math.random() * 60);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({
      size: 1.3, map: softSprite(), color: 0xcfc4ff, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    }));
    this.neonWorld.add(this.stars);

    // retro sun on the horizon
    const sun = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: sunTexture(), transparent: true, depthWrite: false, fog: false,
    }));
    sun.scale.setScalar(70);
    sun.position.set(0, 14, -150);
    this.sun = sun;
    this.neonWorld.add(sun);

    this.board = new THREE.Group();
    scene.add(this.board);
  }

  _buildPaperWorld() { this.paper = new PaperStage(this); }

  get isPaper() { return this.theme === 'paper'; }

  _applyWorld() {
    const paper = this.isPaper;
    this.neonWorld.visible = !paper;
    this.paperWorld.visible = paper;
    this.paper.setVisible(paper);
    const bg = paper ? PAPER_BG : BG;
    this.scene.background.setHex(bg);
    this.scene.fog.color.setHex(bg);
    this.scene.fog.density = paper ? 0.018 : 0.022;
    this.renderer.setClearColor(bg, 1);
    this.hemi.color.setHex(paper ? 0xffffff : 0x9c7bff);
    this.hemi.groundColor.setHex(paper ? 0x9a8f7a : 0x0a0018);
    this.hemi.intensity = paper ? 1.1 : 0.9;
    this.fx.confettiColors = PLAYERS.map((p) => p.hex).concat([paper ? 0xffd23f : 0xffffff]);
  }

  // Switch look. The caller rebuilds the board (build + sync) afterwards.
  setTheme(theme) {
    this.theme = theme;
    this._applyWorld();
  }

  _setupComposer() {
    this.composer = null;
    if (this.quality !== 'high') return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.62, 0.35, 0.78);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    this.composer?.dispose?.();
    this._setupComposer();
    this.resize();
  }

  // ---------------------------------------------------------------- board
  build(n) {
    this.gen = (this.gen || 0) + 1; // lets in-flight animations notice the board was rebuilt
    this.clearWinFx();
    this.removeGhost();
    for (const ch of [...this.board.children]) this._dispose(ch);
    this.board.clear();
    this.cells = Array.from({ length: n * n }, () => ({ seat: -1, obj: null }));
    this.n = n;
    const half = n / 2;
    this.frameMat = this.underMat = null;
    if (this.isPaper) {
      this.paper.buildBoard(n);
      this.setTurn(this.turnSeat, false);
      this.setView(this.view, false);
      return;
    }

    // dark glass slab
    const slab = new THREE.Mesh(
      new RoundedBoxGeometry(n + 0.7, 0.36, n + 0.7, 4, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x0d0822, roughness: 0.25, metalness: 0.7 }),
    );
    slab.position.y = -0.18;
    this.board.add(slab);

    // tiles (instanced so hover/highlight is cheap and picking returns the cell)
    this.tileBase = new THREE.Color(0x1a1238);
    const tiles = new THREE.InstancedMesh(
      new RoundedBoxGeometry(0.9, 0.08, 0.9, 2, 0.04),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.3 }),
      n * n,
    );
    const m = new THREE.Matrix4();
    for (let i = 0; i < n * n; i++) {
      const p = this.cellPos(i);
      m.makeTranslation(p.x, 0.02, p.z);
      tiles.setMatrixAt(i, m);
      tiles.setColorAt(i, this.tileBase);
    }
    tiles.instanceMatrix.needsUpdate = true;
    tiles.instanceColor.needsUpdate = true;
    this.tiles = tiles;
    this.board.add(tiles);
    this.tileGlow = new Float32Array(n * n); // 0..1 highlight per tile

    // glowing grid lines
    this.gridMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb59bff).multiplyScalar(0.95) });
    const lineGeoV = new THREE.BoxGeometry(0.045, 0.05, n - 0.1);
    const lineGeoH = new THREE.BoxGeometry(n - 0.1, 0.05, 0.045);
    for (let k = 1; k < n; k++) {
      const v = new THREE.Mesh(lineGeoV, this.gridMat);
      v.position.set(-half + k, 0.05, 0);
      const h = new THREE.Mesh(lineGeoH, this.gridMat);
      h.position.set(0, 0.05, -half + k);
      this.board.add(v, h);
    }

    // neon frame, takes the colour of the player to move
    this.frameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(NEUTRAL).multiplyScalar(1.25) });
    const w = n + 0.5, t = 0.08;
    const fH = new RoundedBoxGeometry(w + t, 0.09, t, 2, 0.03);
    const fV = new RoundedBoxGeometry(t, 0.09, w + t, 2, 0.03);
    [[0, -w / 2, fH], [0, w / 2, fH], [-w / 2, 0, fV], [w / 2, 0, fV]].forEach(([x, z, g]) => {
      const f = new THREE.Mesh(g, this.frameMat);
      f.position.set(x, 0.02, z);
      this.board.add(f);
    });

    // under-glow pooled on the floor
    this.underMat = new THREE.MeshBasicMaterial({
      map: softSprite(), color: NEUTRAL, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const under = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.underMat);
    under.scale.setScalar(n * 2.6);
    under.position.y = -6.95;
    this.board.add(under);

    this.setTurn(this.turnSeat, false);
    this.setView(this.view, false);
  }

  _makeTiles(n, visible) {
    this.tileBase = new THREE.Color(0x1a1238);
    const tiles = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.98, 0.02, 0.98),
      new THREE.MeshBasicMaterial({ color: 0xffffff, visible }),
      n * n,
    );
    const m = new THREE.Matrix4();
    for (let i = 0; i < n * n; i++) {
      const p = this.cellPos(i);
      m.makeTranslation(p.x, 0.0, p.z);
      tiles.setMatrixAt(i, m);
      tiles.setColorAt(i, this.tileBase);
    }
    tiles.instanceMatrix.needsUpdate = true;
    this.tiles = tiles;
    this.board.add(tiles);
    this.tileGlow = null;
  }

  cellPos(i, y = 0) {
    const n = this.n;
    const r = (i / n) | 0, c = i % n;
    return new THREE.Vector3(c - (n - 1) / 2, y, r - (n - 1) / 2);
  }

  _dispose(obj) {
    obj.traverse?.((o) => {
      if (o.geometry && !markGeo.flat().includes(o.geometry)) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => mm.dispose());
    });
  }

  // ---------------------------------------------------------------- marks
  _makeMark(seat, ghost = false) {
    if (this.isPaper) return this.paper.makeMark(seat, ghost);
    const g = new THREE.Group();
    const mat = markMaterial(seat, ghost);
    for (const geo of geometriesFor(seat)) g.add(new THREE.Mesh(geo, mat));
    g.userData.mat = mat;
    if (!ghost) {
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.35).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
        map: softSprite(), color: PLAYERS[seat].hex, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      halo.position.y = 0.07 - MARK_Y;
      g.add(halo);
      g.userData.halo = halo;
    }
    return g;
  }

  // Place a mark with a drop-in animation. Resolves when it lands.
  place(i, seat, animate = true) {
    const cell = this.cells[i];
    if (!cell) return Promise.resolve();
    if (cell.obj) this._removeMark(i);
    if (i === this.hoverCell) this.removeGhost();
    const mark = this._makeMark(seat);
    const p = this.cellPos(i, MARK_Y);
    mark.position.copy(p);
    mark.userData.phase = Math.random() * 6.28;
    mark.userData.baseY = MARK_Y;
    this.board.add(mark);
    cell.seat = seat;
    cell.obj = mark;
    if (mark.userData.paper) {
      mark.position.y = 0;
      if (!animate) return Promise.resolve();
      return this.paper.drawMark(mark, seat, this.cellPos(i));
    }
    if (!animate) return Promise.resolve();
    mark.position.y = 2.2;
    mark.scale.setScalar(0.2);
    mark.rotation.y = -Math.PI;
    const col = PLAYERS[seat].hex;
    const gen = this.gen;
    return tween(0.34, (k) => {
      mark.position.y = 2.2 + (MARK_Y - 2.2) * k;
      mark.rotation.y = -Math.PI * (1 - k);
      mark.scale.setScalar(0.2 + 0.8 * Math.min(1, k * 1.2));
    }, ease.in).then(() => {
      if (gen !== this.gen) return null; // board was rebuilt (e.g. theme switch) mid-drop
      this.fx.shockwave(p, col, 1.1);
      this.fx.burst(p, col, 26, false, { speed: 0.45, up: 0.45, life: 0.7, size: 0.09, gravity: 9, lift: 0.05 });
      this.flashTile(i, 1);
      return tween(0.22, (k) => mark.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.18), ease.out);
    });
  }

  _removeMark(i) {
    const cell = this.cells[i];
    if (!cell?.obj) return;
    this.board.remove(cell.obj);
    this._dispose(cell.obj);
    cell.obj = null;
    cell.seat = -1;
  }

  // Bring the 3D board in line with a board array. New marks animate.
  async sync(board, animate = true) {
    if (board.length !== this.cells.length) return;
    const jobs = [];
    board.forEach((s, i) => {
      if (this.cells[i].seat === s) return;
      if (s < 0) this._removeMark(i);
      else jobs.push(this.place(i, s, animate));
    });
    await Promise.all(jobs);
  }

  // Marks spin off and fade for a new round
  async clear(animate = true) {
    this.removeGhost();
    if (this.isPaper) return this.paper.clear(animate);
    this.clearWinFx();
    const live = this.cells.map((c, i) => [c, i]).filter(([c]) => c.obj);
    if (!animate || !live.length) { live.forEach(([, i]) => this._removeMark(i)); return; }
    await Promise.all(live.map(([c, i]) => {
      const o = c.obj;
      const p = this.cellPos(i);
      const delay = (Math.abs(p.x) + Math.abs(p.z)) * 0.04;
      if (o.userData.paper) {
        const mats = o.userData.mats;
        const o0 = mats.map((m) => m.opacity);
        return new Promise((res) => setTimeout(res, delay * 600)).then(() => tween(0.35, (k) => {
          mats.forEach((m, j) => { m.opacity = o0[j] * (1 - k); });
          o.position.x += (Math.random() - 0.5) * 0.01; // eraser jiggle
        }, ease.in)).then(() => { if (c.obj === o) this._removeMark(i); });
      }
      return new Promise((res) => setTimeout(res, delay * 1000)).then(() => tween(0.4, (k) => {
        o.position.y = MARK_Y + k * 1.6;
        o.rotation.y = k * Math.PI * 2;
        o.scale.setScalar(Math.max(0.001, 1 - k));
      }, ease.in)).then(() => { if (c.obj === o) this._removeMark(i); });
    }));
  }

  flashTile(i, v = 1) { if (this.tileGlow && i >= 0 && i < this.tileGlow.length) this.tileGlow[i] = Math.max(this.tileGlow[i], v); }

  // ---------------------------------------------------------------- turn + hover
  setTurn(seat, animate = true) {
    this.turnSeat = seat;
    if (this.isPaper) this.paper.setTurn(seat);
    if (this.ghost) this.removeGhost();
    if (!this.frameMat) return;
    const hex = seat == null ? NEUTRAL : PLAYERS[seat].hex;
    const target = new THREE.Color(hex).multiplyScalar(1.25);
    const from = this.frameMat.color.clone();
    const under = new THREE.Color(hex);
    const uFrom = this.underMat.color.clone();
    const apply = (k) => {
      this.frameMat.color.copy(from).lerp(target, k);
      this.underMat.color.copy(uFrom).lerp(under, k);
    };
    if (!animate) apply(1); else tween(0.4, apply, ease.out);
    if (this.ghost) this.removeGhost();
  }

  setInteractive(on) {
    this.interactive = on;
    if (!on) this.removeGhost();
    this.canvas.style.cursor = '';
  }

  removeGhost() {
    if (this.ghost) { this.board.remove(this.ghost); this._dispose(this.ghost); this.ghost = null; }
    if (this.hoverCell >= 0) this.flashTile(this.hoverCell, 0.45); // fade the hover tint out
    this.hoverCell = -1;
  }

  _showGhost(i) {
    if (i === this.hoverCell) return;
    this.removeGhost();
    if (i < 0 || this.turnSeat == null || !this.cells[i] || this.cells[i].seat >= 0) return;
    this.hoverCell = i;
    this.ghost = this._makeMark(this.turnSeat, true);
    this.ghost.position.copy(this.cellPos(i, this.isPaper ? 0.002 : MARK_Y + 0.05));
    this.board.add(this.ghost);
    this.flashTile(i, 0.6);
    this.onHover?.(i);
  }

  // ---------------------------------------------------------------- win / draw
  async showWin(line, seat, quiet = false) {
    if (this.isPaper) { this.clearWinFx(); return this.paper.win(line, seat, quiet); }
    const gen = this.gen;
    this.clearWinFx();
    const col = PLAYERS[seat].hex;
    const ends = runEnds(line, this.n);
    // non-winning marks dim down
    this.cells.forEach((c, i) => {
      if (!c.obj) return;
      if (line.includes(i)) { c.obj.userData.win = true; return; }
      const mat = c.obj.userData.mat;
      tween(0.5, (k) => { mat.emissiveIntensity = 1.5 - k * 1.15; if (c.obj?.userData.halo) c.obj.userData.halo.material.opacity = 0.5 * (1 - k); });
    });
    line.forEach((i) => this.flashTile(i, 1));

    if (ends) {
      // a laser beam strikes through the line
      const a = this.cellPos(ends[0], 0.36), b = this.cellPos(ends[1], 0.36);
      const dir = b.clone().sub(a);
      const ext = dir.clone().setLength(0.45);
      a.sub(ext); b.add(ext);
      const len = a.distanceTo(b);
      const grp = new THREE.Group();
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 12).translate(0, 0.5, 0),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(2) }));
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1, 16, 1, true).translate(0, 0.5, 0),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(1.5), transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }));
      grp.add(core, glow);
      grp.position.copy(a);
      grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      grp.scale.set(1, 0.001, 1);
      this.board.add(grp);
      this.winFx.push(grp);
      await tween(0.38, (k) => grp.scale.set(1, Math.max(0.001, k * len), 1), ease.out);
    } else {
      // square / wrap shapes: light pillars rise from each cell
      const tex = pillarTexture();
      await Promise.all(line.map((i, j) => {
        const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 3, 24, 1, true).translate(0, 1.5, 0),
          new THREE.MeshBasicMaterial({ map: tex, color: col, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
        pil.position.copy(this.cellPos(i));
        pil.scale.y = 0.001;
        this.board.add(pil);
        this.winFx.push(pil);
        return new Promise((r) => setTimeout(r, j * 90)).then(() => {
          if (gen !== this.gen) return null;
          this.fx.shockwave(this.cellPos(i), col, 1.4);
          return tween(0.4, (k) => { pil.scale.y = Math.max(0.001, k); }, ease.outBack);
        });
      }));
    }
    if (gen !== this.gen || quiet) return;
    // fireworks over the board
    const c = new THREE.Vector3(0, 0, 0);
    this.fx.fireworks(c, this.fx.shades(col), 4, 2.2 + this.n * 0.25);
    line.forEach((i) => this.fx.burst(this.cellPos(i), col, 30, false, { speed: 0.6, life: 0.9, size: 0.12 }));
  }

  showDraw(quiet = false) {
    if (this.isPaper) { this.clearWinFx(); return this.paper.draw(quiet); }
    // everything flickers like a failing neon sign, then dims
    const mats = this.cells.filter((c) => c.obj).map((c) => c.obj.userData.mat);
    return tween(0.9, (k, raw) => {
      const f = raw < 0.85 ? (Math.random() < 0.45 ? 0.25 : 1.5) : 0.7;
      mats.forEach((m) => { m.emissiveIntensity = f; });
    }, ease.linear);
  }

  clearWinFx() {
    for (const o of this.winFx) { this.board.remove(o); this._dispose(o); }
    this.winFx = [];
    this.cells.forEach((c) => { if (c.obj) c.obj.userData.win = false; });
  }

  celebrate(seat) {
    if (this.isPaper) { this.paper.celebrate(); return; }
    const col = seat == null ? NEUTRAL : PLAYERS[seat].hex;
    this.fx.confetti(220, this.n + 8);
    this.fx.fireworks(new THREE.Vector3(0, 0, 0), this.fx.shades(col), 6, 3 + this.n * 0.3);
  }

  // Shake a cell's tile when a tap is refused
  nope(i) { this.flashTile(i, 0.9); }

  // ---------------------------------------------------------------- camera
  setView(mode = this.view, animate = true) {
    this.view = mode;
    const n = this.n || 3;
    const aspect = this.camera.aspect || 1;
    const portrait = aspect < 1;
    const ext = n + (this.isPaper ? 1.5 : 1.3);
    const vf = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    // fit height and width, leaving room for the HUD (scoreboard on top, status at the bottom)
    // vertical fit leaves room for the scoreboard and status bar; width fit just needs a margin
    const hFit = (ext / 2) / Math.tan(vf) * (portrait ? 1.0 : 1.3);
    const wFit = (ext / 2) / (Math.tan(vf) * aspect) * 1.04;
    let dist = Math.max(hFit, wFit);
    const polar = mode === 'top' ? 0.0001 : portrait ? 0.5 : 0.62;
    if (mode !== 'top') dist *= portrait ? 1.0 : 1.05;
    this.controls.minDistance = dist * 0.45;
    this.controls.maxDistance = dist * 1.7;
    // on the menu the card covers the bottom of the screen, so lift the board up
    const target = new THREE.Vector3(0, 0, this.demo ? ext * (portrait ? 0.75 : 0.45) : portrait ? 0.15 : 0.1);
    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const endPos = new THREE.Vector3().setFromSpherical(new THREE.Spherical(dist, polar, 0)).add(target);
    const apply = (k) => {
      this.controls.target.lerpVectors(startTarget, target, k);
      // move along a sphere so the camera never dips through the board
      const s0 = new THREE.Spherical().setFromVector3(startPos.clone().sub(startTarget));
      const s1 = new THREE.Spherical().setFromVector3(endPos.clone().sub(target));
      let dTheta = s1.theta - s0.theta;
      if (dTheta > Math.PI) dTheta -= Math.PI * 2;
      if (dTheta < -Math.PI) dTheta += Math.PI * 2;
      const s = new THREE.Spherical(s0.radius + (s1.radius - s0.radius) * k, s0.phi + (s1.phi - s0.phi) * k, s0.theta + dTheta * k);
      this.camera.position.setFromSpherical(s).add(this.controls.target);
      this.camera.lookAt(this.controls.target);
    };
    this._still();
    if (!animate) { apply(1); this.controls.update(); return Promise.resolve(); }
    this._flying = true;
    return tween(0.8, apply, ease.inOut).then(() => { this._flying = false; this._still(); this.controls.update(); });
  }

  // drop any leftover orbit momentum (auto-rotate, a flick, a tap's tiny drag)
  _still() {
    const c = this.controls;
    c._sphericalDelta?.set(0, 0, 0);
    c._panOffset?.set(0, 0, 0);
    if ('_scale' in c) c._scale = 1;
  }

  setDemo(on) {
    this.demo = on;
    this.controls.autoRotate = on;
    this.controls.autoRotateSpeed = 0.6;
    this.controls.enabled = !on;
    this._still();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dprCap = this.quality === 'high' ? 2 : 1.25;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.n) this.paper.placePenRest();
    clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => this.setView(this.view, false), 60);
  }

  // ---------------------------------------------------------------- picking
  _initPointer() {
    const cv = this.canvas;
    const active = new Map();
    let down = null;
    cv.addEventListener('pointerdown', (e) => {
      active.set(e.pointerId, true);
      down = active.size === 1 ? { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId } : null;
    });
    const end = (e) => {
      active.delete(e.pointerId);
      if (!down || down.id !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = e.timeStamp - down.t < 900; // input timestamps, so a slow frame can't eat a tap
      down = null;
      if (e.type !== 'pointerup' || moved > 12 || !quick || !this.interactive) return;
      const i = this._pick(e);
      if (i >= 0) this.onTap?.(i);
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !this.interactive || active.size) return;
      const i = this._pick(e);
      this._showGhost(i);
      cv.style.cursor = i >= 0 && this.cells[i]?.seat < 0 ? 'pointer' : '';
    });
    cv.addEventListener('pointerleave', () => this.removeGhost());
  }

  _pick(e) {
    if (!this.tiles) return -1;
    const r = this.canvas.getBoundingClientRect();
    this._pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const hit = this._raycaster.intersectObject(this.tiles, false)[0];
    if (hit) return hit.instanceId;
    // forgiving: snap a near-miss in the gaps to the nearest cell
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.06);
    const p = new THREE.Vector3();
    if (!this._raycaster.ray.intersectPlane(plane, p)) return -1;
    const n = this.n, c = Math.round(p.x + (n - 1) / 2), rr = Math.round(p.z + (n - 1) / 2);
    if (c < 0 || rr < 0 || c >= n || rr >= n) return -1;
    return rr * n + c;
  }

  // ---------------------------------------------------------------- loop
  _loop(now) {
    const dt = Math.min(0.05, (now - this._clock) / 1000);
    this._clock = now;
    const t = now / 1000;
    updateTweens(now);
    if (!this._flying) this.controls.update();
    this.floorMat.uniforms.uTime.value = t;
    this.stars.rotation.y = t * 0.004;

    // idle neon life: bob, halo pulse, winners spin
    for (const c of this.cells) {
      const o = c.obj;
      if (!o || o.userData.paper) continue;
      const ph = o.userData.phase;
      if (o.userData.win) {
        o.rotation.y += dt * 2.4;
        o.position.y = MARK_Y + 0.12 + Math.sin(t * 5 + ph) * 0.06;
        if (o.userData.halo) o.userData.halo.material.opacity = 0.35 + Math.sin(t * 8 + ph) * 0.15;
      } else if (o.userData.halo && o.userData.halo.material.opacity > 0.05) {
        o.userData.halo.material.opacity = 0.2 + Math.sin(t * 2.2 + ph) * 0.06;
      }
    }
    if (this.ghost && !this.isPaper) this.ghost.position.y = MARK_Y + 0.08 + Math.sin(t * 6) * 0.03;
    if (this.isPaper) this.paper.update(dt);

    // tile highlights fade back to base
    if (this.tiles && this.tileGlow) {
      let dirty = false;
      const col = new THREE.Color();
      const tint = new THREE.Color(this.turnSeat == null ? NEUTRAL : PLAYERS[this.turnSeat].hex);
      for (let i = 0; i < this.tileGlow.length; i++) {
        const g = this.tileGlow[i];
        if (g <= 0 && !(i === this.hoverCell)) continue;
        const v = i === this.hoverCell ? Math.max(g, 0.45) : g;
        col.copy(this.tileBase).lerp(tint, v * 0.45);
        this.tiles.setColorAt(i, col);
        this.tileGlow[i] = Math.max(0, g - dt * 1.6);
        dirty = true;
      }
      if (dirty) this.tiles.instanceColor.needsUpdate = true;
    }

    this.fx.update(dt);
    if (this.composer && !this.isPaper) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
