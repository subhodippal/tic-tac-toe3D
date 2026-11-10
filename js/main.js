// Game controller: menus, setup, turns, CPU, online sync, celebrations.

import { Arena } from './scene.js';
import * as R from './rules.js';
import { chooseMove } from './ai.js';
import { sfx } from './audio.js';
import * as bg from './bgfx.js';
import { HostNet, ClientNet } from './net.js';
import { flushTweens } from './anim.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SAVE_KEY = 'ttt3d-save';
const SET_KEY = 'ttt3d-settings';
const SETUP_KEY = 'ttt3d-setup';
const NAME_KEY = 'ttt3d-name';
const EMOJIS = ['👏', '😂', '😮', '🔥', '😭', '😎', '🤯', '💀'];

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const lowEnd = (navigator.hardwareConcurrency || 4) <= 2;
const settings = Object.assign({ sound: true, vibrate: true, quality: lowEnd ? 'low' : 'high', view: 'tilt', theme: 'neon' }, store.get(SET_KEY) || {});
if (!settings.themeChosen || !['neon', 'paper'].includes(settings.theme)) settings.theme = 'neon';
R.usePalette(settings.theme);
document.documentElement.dataset.theme = settings.theme;
const isPaper = () => settings.theme === 'paper';
const neutralCss = () => (isPaper() ? '#55556a' : '#8a5cff');
sfx.enabled = settings.sound;
sfx.vibrate = settings.vibrate;

// ---------------------------------------------------------------- glyphs
const GLYPH = [
  '<path d="M6 6l12 12M18 6L6 18"/>',
  '<circle cx="12" cy="12" r="7"/>',
  '<path d="M12 4.5l8.5 14.5h-17z"/>',
  '<rect x="5.5" y="5.5" width="13" height="13" rx="1.5"/>',
];
const glyph = (s) => `<svg class="glyph" viewBox="0 0 24 24" style="color:${R.PLAYERS[s].css}" aria-label="${R.PLAYERS[s].sym}"><g stroke="currentColor">${GLYPH[s]}</g></svg>`;

// ---------------------------------------------------------------- arena
const arena = new Arena($('#c'), { quality: settings.quality, theme: settings.theme });
arena.view = settings.view;

// ---------------------------------------------------------------- screens
const SCREENS = ['scrMenu', 'scrSetup', 'scrOnline', 'scrLobby', 'scrPause', 'scrSettings', 'scrHelp', 'scrMsg'];
let current = 'scrMenu';
let overlayBack = null;
function show(id) {
  current = id;
  SCREENS.forEach((s) => $('#' + s).classList.toggle('hidden', s !== id));
}
function hideScreens() { current = null; SCREENS.forEach((s) => $('#' + s).classList.add('hidden')); }
function overlay(id) { overlayBack = current; show(id); }
function closeOverlay() { if (overlayBack) show(overlayBack); else hideScreens(); overlayBack = null; }

let toastTimer = null;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function message(title, text, after) {
  $('#msgTitle').textContent = title;
  $('#msgText').textContent = text;
  show('scrMsg');
  $('#btnMsgOk').onclick = () => { sfx.click(); after ? after() : goMenu(); };
}

// ---------------------------------------------------------------- setup
const setup = Object.assign({
  mode: 'cpu', n: 3, rule: 'r3', np: 2, level: 'normal',
  kinds: ['human', 'cpu', 'cpu', 'cpu'], names: ['', '', '', ''],
}, store.get(SETUP_KEY) || {});

function defaultName(s, kind, kinds) {
  if (kind === 'cpu') return kinds.filter((k) => k === 'cpu').length > 1 ? `CPU ${s + 1}` : 'CPU';
  if (setup.mode === 'cpu' && kinds.filter((k) => k === 'human').length === 1) return 'You';
  return `Player ${s + 1}`;
}

function openSetup(mode) {
  setup.mode = mode;
  if (mode === 'cpu') setup.kinds = ['human', 'cpu', 'cpu', 'cpu'];
  if (mode === 'local') setup.kinds = ['human', 'human', 'human', 'human'];
  $('#setupTitle').textContent = mode === 'host' ? 'Room settings' : mode === 'cpu' ? 'Play vs computer' : 'Pass & play';
  $('#btnStart').textContent = mode === 'host' ? 'Create room' : 'Start game';
  $('#setupErr').textContent = '';
  renderSetup();
  show('scrSetup');
}

function renderSetup() {
  const c = R.normalizeCfg(setup);
  Object.assign(setup, c);
  $('#pickBoard').innerHTML = R.SIZES.map((n) => `<button data-v="${n}" class="${n === setup.n ? 'on' : ''}"><b>${n}×${n}</b></button>`).join('');
  $('#pickRule').innerHTML = Object.entries(R.RULES).map(([k, r]) =>
    `<button data-v="${k}" class="${k === setup.rule ? 'on' : ''}" ${R.ruleOK(setup.n, k) ? '' : 'disabled'}><b>${r.short}</b><small>${r.label}</small></button>`).join('');
  const max = R.maxPlayers(setup.n);
  $$('#pickPlayers button').forEach((b) => {
    const v = +b.dataset.v;
    b.disabled = v > max;
    b.classList.toggle('on', v === setup.np);
  });
  $('#playersNote').textContent = max < 4 ? `${setup.n}×${setup.n} fits ${max}` : '';
  const local = setup.mode !== 'host';
  $('#seatRows').classList.toggle('hidden', !local);
  if (local) {
    $('#seatRows').innerHTML = Array.from({ length: setup.np }, (_, s) => {
      const k = setup.kinds[s];
      return `<div class="seat" style="--c:${R.PLAYERS[s].css}">${glyph(s)}
        <input data-seat="${s}" maxlength="12" value="${esc(setup.names[s] || '')}" placeholder="${esc(defaultName(s, k, setup.kinds.slice(0, setup.np)))}" aria-label="Player ${s + 1} name">
        <div class="kind" data-seat="${s}"><button data-k="human" class="${k === 'human' ? 'on' : ''}">Human</button><button data-k="cpu" class="${k === 'cpu' ? 'on' : ''}">CPU</button></div></div>`;
    }).join('');
  }
  const anyCpu = setup.mode === 'host' || setup.kinds.slice(0, setup.np).includes('cpu');
  $('#levelBox').classList.toggle('hidden', !anyCpu);
  $('#levelBox .optlbl').textContent = setup.mode === 'host' ? 'Computer skill (empty seats)' : 'Computer skill';
  $$('#segLevel button').forEach((b) => b.classList.toggle('on', b.dataset.v === setup.level));
}

function saveSetup() { store.set(SETUP_KEY, { n: setup.n, rule: setup.rule, np: setup.np, level: setup.level, names: setup.names }); }

$('#pickBoard').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  sfx.click(); setup.n = +b.dataset.v;
  if (!R.ruleOK(setup.n, setup.rule)) setup.rule = 'r3';
  // bigger boards are more fun with 4-in-a-row, suggest it once
  if (setup.n >= 6 && setup.rule === 'r3') setup.rule = 'r4';
  renderSetup();
});
$('#pickRule').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  sfx.click(); setup.rule = b.dataset.v; renderSetup();
});
$('#pickPlayers').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  sfx.click(); setup.np = +b.dataset.v; renderSetup();
});
$('#seatRows').addEventListener('click', (e) => {
  const b = e.target.closest('.kind button'); if (!b) return;
  sfx.click();
  setup.kinds[+b.parentElement.dataset.seat] = b.dataset.k;
  renderSetup();
});
$('#seatRows').addEventListener('input', (e) => {
  const i = e.target.closest('input'); if (!i) return;
  setup.names[+i.dataset.seat] = i.value.trim().slice(0, 12);
});
$('#segLevel').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  sfx.click(); setup.level = b.dataset.v; renderSetup();
});

$('#btnStart').addEventListener('click', () => {
  sfx.unlock(); sfx.click();
  saveSetup();
  if (setup.mode === 'host') return hostCreate();
  const cfg = R.normalizeCfg(setup);
  const kinds = setup.kinds.slice(0, cfg.np);
  const seats = kinds.map((k, s) => ({ name: (k === 'human' && setup.names[s]) || defaultName(s, k, kinds), kind: k }));
  startSession({ mode: 'local', cfg, seats, level: setup.level, G: R.newGame(cfg, 0) });
});

// ---------------------------------------------------------------- session
let S = null;      // current game session
let paused = false;
let cpuTimer = null;
let shown = { round: 0, over: false };
let chain = Promise.resolve();
let guestMoveTimer = null;

const humans = () => S.seats.filter((s) => s.kind === 'human').length;

function isMyTurn(G) {
  if (!S || !G || G.over) return false;
  if (S.mode === 'local') return S.seats[G.turn]?.kind === 'human';
  return G.turn === S.mySeat;
}

function startSession(sess) {
  S = { mySeat: -1, ...sess };
  if (S.mode === 'local') persist();
  enterGame();
}

const ambientFx = () => bg.ambient(isPaper() ? null : () => R.PLAYERS[Math.floor(Math.random() * 4)].css);

// ---------------------------------------------------------------- theme
function setTheme(theme) {
  if (theme === settings.theme) return;
  settings.theme = theme;
  settings.themeChosen = true;
  store.set(SET_KEY, settings);
  R.usePalette(theme);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'paper' ? '#efe6d0' : '#05020f');
  arena.setTheme(theme);
  syncThemeButtons();
  if (current === 'scrSetup') renderSetup();
  if (S?.G) {
    present(S.G, true);
  } else {
    startDemo();
    ambientFx();
  }
}
function syncThemeButtons() {
  $$('[data-theme-pick] button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.theme));
  const t = $('#themeToggle');
  t.dataset.on = settings.theme;
  t.setAttribute('aria-checked', String(settings.theme === 'neon'));
  t.querySelectorAll('span').forEach((s) => s.classList.toggle('on', s.dataset.v === settings.theme));
}
$('#themeToggle').addEventListener('click', () => {
  sfx.unlock(); sfx.click();
  setTheme(settings.theme === 'paper' ? 'neon' : 'paper');
});
$$('[data-theme-pick]').forEach((el) => el.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  sfx.unlock(); sfx.click();
  setTheme(b.dataset.v);
}));
syncThemeButtons();
if (isPaper()) document.querySelector('meta[name="theme-color"]').setAttribute('content', '#efe6d0');

function enterGame() {
  stopDemo();
  bg.ambient(null);
  paused = false;
  hideScreens();
  $('#hud').classList.remove('hidden');
  hideBanner();
  const online = S.mode !== 'local';
  $('#roomTag').classList.toggle('hidden', !online);
  if (online) $('#roomTag').textContent = 'ROOM ' + S.code;
  $('#btnEmoji').classList.toggle('hidden', !online);
  $('#emojiPanel').classList.add('hidden');
  chain = Promise.resolve();
  present(S.G, true);
}

function persist() {
  if (S?.mode !== 'local') return;
  store.set(SAVE_KEY, { cfg: S.cfg, seats: S.seats, level: S.level, G: S.G });
}

// Host / local authority: apply a move, then share and show it
function commit(i, seat) {
  if (!R.play(S.G, i, seat)) return false;
  persist();
  broadcastState();
  present(S.G);
  return true;
}

function doNextRound() {
  if (!S?.G?.over) return;
  R.nextRound(S.G);
  persist();
  broadcastState();
  present(S.G);
}

function restartMatch() {
  if (!S || S.mode === 'guest') return;
  S.G = R.newGame(S.cfg, 0);
  persist();
  if (S.mode === 'host') S.net.broadcast({ t: 'start', cfg: S.cfg, seats: pubSeats(), G: S.G, code: S.code });
  present(S.G, true);
}

// Serialise presentation so animations never overlap
function present(G, fresh = false) {
  const snap = clone(G);
  chain = chain.then(() => doPresent(snap, fresh)).catch((e) => console.error(e));
  return chain;
}

async function doPresent(G, fresh) {
  if (!S) return;
  arena.setInteractive(false);
  if (fresh || arena.n !== G.n) {
    arena.build(G.n);
    arena.setView(settings.view, false);
    shown = { round: G.round, over: false };
    await arena.sync(G.board, false);
    hideBanner();
    if (G.over) { // e.g. continuing a saved game or switching theme after a round ended
      shown.over = true;
      if (G.over.line) arena.showWin(G.over.line, G.over.winner, true);
      else arena.showDraw(true);
    }
  }
  if (G.round !== shown.round) {
    hideBanner();
    $('#btnNext').classList.add('hidden');
    if (isPaper()) sfx.flip(); else sfx.sweep();
    await arena.clear(true);
    shown = { round: G.round, over: false };
  }
  const fresh1 = G.board.map((s, i) => [s, i]).filter(([s, i]) => s >= 0 && arena.cells[i]?.seat !== s);
  if (fresh1.length === 1) {
    if (isPaper()) sfx.scribble(fresh1[0][0] === 0 ? 0.5 : 0.45);
    else sfx.place(fresh1[0][0]);
  }
  await arena.sync(G.board, true);
  if (!S) return;
  renderScore(G);
  if (G.over && !shown.over) {
    shown.over = true;
    await showOutcome(G);
  } else if (G.over) {
    showOverUI(G);
  } else {
    setTurnUI(G);
  }
  maybeCpu();
}

function setTurnUI(G) {
  const prev = arena.turnSeat;
  arena.setTurn(G.turn);
  document.documentElement.style.setProperty('--turn', R.PLAYERS[G.turn].css);
  $('#btnNext').classList.add('hidden');
  const mine = isMyTurn(G);
  arena.setInteractive(mine);
  const seat = S.seats[G.turn];
  let text, thinking = false;
  if (S.mode === 'local') {
    if (seat.kind === 'cpu') { text = `${seat.name} is thinking`; thinking = true; } else text = humans() === 1 ? 'Your turn' : `${seat.name}'s turn`;
  } else if (G.turn === S.mySeat) text = 'Your turn';
  else if (seat.kind === 'cpu') { text = `${seat.name} is thinking`; thinking = true; } else { text = `Waiting for ${seat.name}`; thinking = true; }
  $('#status').innerHTML = `${glyph(G.turn)}<span class="${thinking ? 'dots' : ''}">${esc(text)}</span>`;
  if (mine && prev !== G.turn && (S.mode !== 'local' || humans() > 1) && G.moves > 0) { sfx.turn(); sfx.buzz(25); }
}

function winnerTitle(w) {
  if (S.mode === 'local') {
    if (humans() === 1 && S.seats[w].kind === 'human') return 'You win!';
    return `${S.seats[w].name} wins`;
  }
  return w === S.mySeat ? 'You win!' : `${S.seats[w].name} wins`;
}

async function showOutcome(G) {
  const w = G.over.winner;
  $('#status').innerHTML = '';
  if (w == null) {
    sfx.draw();
    await arena.showDraw();
    if (isPaper()) showBanner('Cat’s game!', 'It’s a draw', null);
    else showBanner('Draw', 'Board full', null);
  } else {
    const css = R.PLAYERS[w].css;
    const iWon = S.mode === 'local' ? (S.seats[w].kind === 'human') : w === S.mySeat;
    const lost = !iWon && (S.mode !== 'local' || humans() === 1);
    if (isPaper()) sfx.scribble(0.55); else sfx.zap();
    showBanner(winnerTitle(w), `Round ${G.round} · ${R.PLAYERS[w].name}`, w);
    const bump = $(`#score .chip[data-seat="${w}"]`);
    bump?.classList.remove('bump'); void bump?.offsetWidth; bump?.classList.add('bump');
    const winFx = arena.showWin(G.over.line, w);
    if (lost) {
      setTimeout(() => sfx.lose(), 350);
      if (!isPaper()) bg.launch(css, 3, 0.75, true);
    } else {
      setTimeout(() => sfx.win(), isPaper() ? 600 : 300);
      if (isPaper()) setTimeout(() => bg.confettiRain(css, 150), 500);
      else bg.party(css, 3);
      arena.celebrate(w);
    }
    await winFx;
  }
  showOverUI(G);
  // CPU-only tables keep themselves going
  if (S.mode === 'local' && humans() === 0) setTimeout(() => { if (S?.G.over && !paused) doNextRound(); }, 3200);
}

function showOverUI(G) {
  const w = G.over.winner;
  arena.setInteractive(false);
  arena.setTurn(w);
  document.documentElement.style.setProperty('--turn', w == null ? neutralCss() : R.PLAYERS[w].css);
  $('#status').innerHTML = w == null ? '<span>Draw</span>' : `${glyph(w)}<span>${esc(winnerTitle(w))}</span>`;
  const nb = $('#btnNext');
  nb.classList.remove('hidden');
  nb.disabled = false;
  nb.textContent = 'Next round';
}

let bannerTimer = null;
function showBanner(title, sub, seat) {
  const b = $('#banner');
  clearTimeout(bannerTimer);
  b.classList.remove('hidden', 'out');
  b.querySelector('b').textContent = title;
  b.querySelector('b').style.setProperty('--c', seat == null ? neutralCss() : R.PLAYERS[seat].css);
  b.querySelector('small').textContent = sub || '';
  // restart the entry animation
  const bb = b.querySelector('b');
  bb.style.animation = 'none'; void bb.offsetWidth; bb.style.animation = '';
  bannerTimer = setTimeout(() => { b.classList.add('out'); bannerTimer = setTimeout(() => b.classList.add('hidden'), 500); }, 2600);
}
function hideBanner() { clearTimeout(bannerTimer); $('#banner').classList.add('hidden'); }

function renderScore(G) {
  const el = $('#score');
  el.classList.toggle('many', G.np >= 3);
  const chips = S.seats.map((seat, s) => {
    let sub = '';
    if (S.mode === 'local') sub = seat.kind === 'cpu' ? 'Computer' : R.PLAYERS[s].name;
    else sub = s === S.mySeat ? 'You' : seat.left ? 'Left · CPU' : seat.kind === 'cpu' ? 'Computer' : 'Online';
    const on = G.over ? G.over.winner === s : G.turn === s;
    return `<div class="chip ${on ? 'on' : ''} ${seat.left ? 'gone' : ''}" data-seat="${s}" style="--c:${R.PLAYERS[s].css}">
      ${glyph(s)}<div class="who"><b>${esc(seat.name)}</b><small>${esc(sub)}</small></div><span class="pts">${G.scores[s]}</span></div>`;
  }).join('');
  el.innerHTML = chips + `<div class="draws">DRAW<b>${G.draws}</b></div>`;
}

// ---------------------------------------------------------------- CPU
function maybeCpu() {
  clearTimeout(cpuTimer);
  if (!S || S.mode === 'guest' || paused) return;
  const G = S.G;
  if (!G || G.over || S.seats[G.turn]?.kind !== 'cpu') return;
  const delay = 420 + Math.random() * 480 + (G.n > 5 ? 160 : 0);
  cpuTimer = setTimeout(() => {
    if (!S || paused || S.G.over || S.seats[S.G.turn]?.kind !== 'cpu') return;
    const seat = S.G.turn;
    const i = chooseMove(S.G, seat, S.level);
    if (i >= 0) commit(i, seat);
  }, delay);
}

// ---------------------------------------------------------------- input
arena.onTap = (i) => {
  sfx.unlock();
  if (!S || !S.G) return;
  const G = S.G;
  if (G.over) return;
  if (!isMyTurn(G)) { sfx.error(); return; }
  if (G.board[i] >= 0) { sfx.error(); arena.nope(i); return; }
  arena.setInteractive(false);
  if (S.mode === 'guest') {
    S.net.send({ t: 'move', i });
    clearTimeout(guestMoveTimer);
    guestMoveTimer = setTimeout(() => { if (S && isMyTurn(S.G)) arena.setInteractive(true); }, 4000);
  } else {
    commit(i, G.turn);
  }
};

$('#btnNext').addEventListener('click', () => {
  sfx.unlock(); sfx.click();
  if (!S) return;
  if (S.mode === 'guest') {
    S.net.send({ t: 'next' });
    $('#btnNext').disabled = true;
    $('#btnNext').textContent = 'Starting…';
  } else doNextRound();
});

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input')) return;
  if (e.key === 'Escape') {
    if (current === 'scrPause') resume();
    else if (S && !current) openPause();
  } else if ((e.key === 'v' || e.key === 'V') && S && !current) {
    toggleView();
  } else if ((e.key === 'Enter' || e.key === ' ') && S && !current && !$('#btnNext').classList.contains('hidden')) {
    e.preventDefault();
    $('#btnNext').click();
  }
});

// ---------------------------------------------------------------- HUD buttons
function syncSoundBtn() { $('#btnSound').classList.toggle('muted', !settings.sound); }
syncSoundBtn();
$('#btnSound').addEventListener('click', () => {
  settings.sound = !settings.sound;
  sfx.enabled = settings.sound;
  sfx.unlock();
  store.set(SET_KEY, settings);
  syncSoundBtn();
  sfx.click();
});

function toggleView() {
  settings.view = arena.view === 'top' ? 'tilt' : 'top';
  store.set(SET_KEY, settings);
  arena.setView(settings.view, true);
  toast(settings.view === 'top' ? 'Top-down view' : '3D view', 1200);
}
$('#btnView').addEventListener('click', () => { sfx.click(); toggleView(); });

$('#btnPause').addEventListener('click', () => { sfx.click(); openPause(); });
function openPause() {
  if (!S) return;
  if (S.mode === 'local') { paused = true; clearTimeout(cpuTimer); }
  $('#pauseRule').textContent = `${R.describe(S.cfg)} · Round ${S.G?.round || 1}`;
  $('#btnRestart').classList.toggle('hidden', S.mode === 'guest');
  $('#btnQuit').textContent = S.mode === 'local' ? 'Quit to menu' : 'Leave game';
  show('scrPause');
}
function resume() {
  hideScreens();
  paused = false;
  maybeCpu();
  if (S?.G?.over && S.mode === 'local' && humans() === 0) doNextRound();
}
$('#btnResume').addEventListener('click', () => { sfx.click(); resume(); });
$('#btnRestart').addEventListener('click', () => { sfx.click(); hideScreens(); paused = false; restartMatch(); });
$('#btnQuit').addEventListener('click', () => { sfx.click(); goMenu(); });
$('#btnPauseSettings').addEventListener('click', () => { sfx.click(); openSettings(); });
$('#btnPauseHelp').addEventListener('click', () => { sfx.click(); openHelp(S?.cfg); });

$('#roomTag').addEventListener('click', () => shareRoom());

// emoji reactions (online)
$('#emojiPanel').innerHTML = EMOJIS.map((e) => `<button data-e="${e}">${e}</button>`).join('');
$('#btnEmoji').addEventListener('click', () => { sfx.click(); $('#emojiPanel').classList.toggle('hidden'); });
$('#emojiPanel').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || !S) return;
  $('#emojiPanel').classList.add('hidden');
  const em = b.dataset.e;
  if (S.mode === 'guest') S.net.send({ t: 'emoji', e: em });
  else if (S.mode === 'host') S.net.broadcast({ t: 'emoji', seat: S.mySeat, e: em });
  flyEmoji(S.mySeat, em);
});
function flyEmoji(seat, e) {
  if (!EMOJIS.includes(e)) return;
  sfx.pop();
  const chip = $(`#score .chip[data-seat="${seat}"]`);
  const r = chip?.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = 'fly-emoji';
  el.textContent = e;
  el.style.left = (r ? r.left + r.width / 2 : innerWidth / 2) + 'px';
  el.style.top = (r ? r.bottom : 100) + 'px';
  $('#fx').appendChild(el);
  setTimeout(() => el.remove(), 1900);
}

// ---------------------------------------------------------------- menu
function goMenu() {
  clearTimeout(cpuTimer);
  clearTimeout(guestMoveTimer);
  if (S?.net) { try { S.net.close(); } catch { /* ignore */ } }
  S = null;
  paused = false;
  chain = Promise.resolve();
  $('#hud').classList.add('hidden');
  hideBanner();
  document.documentElement.style.setProperty('--turn', neutralCss());
  if (location.search) history.replaceState(null, '', location.pathname);
  refreshMenu();
  show('scrMenu');
  startDemo();
  ambientFx();
}

function refreshMenu() {
  const sv = store.get(SAVE_KEY);
  $('#btnContinue').classList.toggle('hidden', !sv?.G);
  if (sv?.G) $('#btnContinue').textContent = `Continue · ${R.describe(sv.cfg)}`;
}

$('#btnVsCpu').addEventListener('click', () => { sfx.unlock(); sfx.click(); openSetup('cpu'); });
$('#btnLocal').addEventListener('click', () => { sfx.unlock(); sfx.click(); openSetup('local'); });
$('#btnOnline').addEventListener('click', () => { sfx.unlock(); sfx.click(); openOnline(); });
$('#btnContinue').addEventListener('click', () => {
  sfx.unlock(); sfx.click();
  const sv = store.get(SAVE_KEY);
  if (!sv?.G) return refreshMenu();
  startSession({ mode: 'local', cfg: R.normalizeCfg(sv.cfg), seats: sv.seats, level: sv.level || 'normal', G: sv.G });
});
$$('[data-back]').forEach((b) => b.addEventListener('click', () => { sfx.click(); show('scrMenu'); }));

// settings
function openSettings() {
  $('#setSound').checked = settings.sound;
  $('#setVibrate').checked = settings.vibrate;
  $$('#segQuality button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.quality));
  $$('#segView button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.view));
  overlay('scrSettings');
}
$('#btnSettings').addEventListener('click', () => { sfx.unlock(); sfx.click(); openSettings(); });
$('#setSound').addEventListener('change', (e) => { settings.sound = e.target.checked; sfx.enabled = settings.sound; store.set(SET_KEY, settings); syncSoundBtn(); sfx.click(); });
$('#setVibrate').addEventListener('change', (e) => { settings.vibrate = e.target.checked; sfx.vibrate = settings.vibrate; store.set(SET_KEY, settings); sfx.buzz(30); });
$('#segQuality').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  sfx.click();
  settings.quality = b.dataset.v;
  store.set(SET_KEY, settings);
  arena.setQuality(settings.quality);
  $$('#segQuality button').forEach((x) => x.classList.toggle('on', x === b));
});
$('#segView').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  sfx.click();
  settings.view = b.dataset.v;
  store.set(SET_KEY, settings);
  arena.setView(settings.view, true);
  $$('#segView button').forEach((x) => x.classList.toggle('on', x === b));
});
$('#btnSettingsClose').addEventListener('click', () => { sfx.click(); closeOverlay(); });

// help
function miniShape(n, on, cap) {
  let h = `<figure><span class="mini" style="grid-template-columns:repeat(${n},1fr)">`;
  for (let i = 0; i < n * n; i++) h += `<i class="${on.includes(i) ? 'on' : ''}"></i>`;
  return h + `</span><figcaption>${cap}</figcaption></figure>`;
}
function openHelp(cfg) {
  const c = R.normalizeCfg(cfg || setup);
  const n = c.n, Rr = R.RULES[c.rule];
  $('#helpTitle').textContent = `How to win · ${n}×${n}`;
  let body;
  if (Rr.kmap) {
    const k = Math.max(n, 4);
    body = `<p>Claim any <b>four squares</b> that make one of these shapes. The grid <b>wraps at the edges</b> like a Karnaugh map, so the far left and far right columns are neighbours, and so are the top and bottom rows.</p>
      <div class="shapes">${miniShape(k, [0, 1, 2, 3], 'Row of four')}${miniShape(k, [0, 1, k, k + 1], 'Two by two')}${miniShape(k, [0, k - 1, k * (k - 1), k * k - 1], 'Four corners')}${miniShape(k, [k, 2 * k - 1, 2 * k, 3 * k - 1], 'Left + right')}</div>
      <p>Columns of four, wrapped rows and straight diagonals count too.</p>`;
  } else {
    const L = Rr.len;
    const k = Math.max(n, L);
    body = `<p>Take turns placing your neon mark. First to line up <b>${L} in a row</b> (across, down or diagonally) wins the round.</p>
      <div class="shapes">${miniShape(Math.min(k, 5), Array.from({ length: L }, (_, i) => i), 'Across')}${miniShape(Math.min(k, 5), Array.from({ length: L }, (_, i) => i * Math.min(k, 5)), 'Down')}${miniShape(Math.min(k, 5), Array.from({ length: L }, (_, i) => i * (Math.min(k, 5) + 1)), 'Diagonal')}</div>`;
  }
  body += `<p><b>Players:</b> 3×3 fits 2, 4×4 fits 3, 5×5 and up fit 4. Each round the first move passes to the next player. Scores add up across rounds.</p>
    <p><b>Controls:</b> tap a square to play. Drag to orbit, pinch or scroll to zoom. The layers button switches between 3D and top-down view.</p>`;
  $('#helpBody').innerHTML = body;
  overlay('scrHelp');
}
$('#btnHelp').addEventListener('click', () => { sfx.unlock(); sfx.click(); openHelp(setup); });
$('#btnHow').addEventListener('click', () => { sfx.click(); openHelp(setup); });
$('#btnHelpClose').addEventListener('click', () => { sfx.click(); closeOverlay(); });

// ---------------------------------------------------------------- online
function myName() {
  const v = $('#inpName').value.trim().slice(0, 12) || 'Player';
  store.set(NAME_KEY, v);
  return v;
}
function openOnline(code = '') {
  $('#inpName').value = store.get(NAME_KEY) || '';
  $('#inpCode').value = code;
  $('#onlineMsg').textContent = '';
  show('scrOnline');
}
$('#btnCreate').addEventListener('click', () => { sfx.click(); myName(); openSetup('host'); });
$('#btnJoin').addEventListener('click', () => { sfx.unlock(); sfx.click(); guestJoin(); });
$('#inpCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') guestJoin(); });

const pubSeats = () => S.seats.map((s) => ({ name: s.name, kind: s.kind === 'remote' ? 'human' : s.kind, host: !!s.host, left: !!s.left }));

function roomLink() { return location.origin + location.pathname + '?room=' + S.code; }
async function shareRoom() {
  if (!S?.code) return;
  const url = roomLink();
  if (navigator.share) {
    try { await navigator.share({ title: 'Tic Tac Toe 3D', text: `Join my neon tic tac toe room ${S.code}`, url }); return; } catch { /* cancelled */ }
  }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast(url, 4000); }
}
$('#btnShare').addEventListener('click', () => { sfx.click(); shareRoom(); });
$('#btnCopy').addEventListener('click', async () => {
  sfx.click();
  try { await navigator.clipboard.writeText(S.code); $('#btnCopy').textContent = 'Copied!'; } catch { $('#btnCopy').textContent = S.code; }
  setTimeout(() => { $('#btnCopy').textContent = 'Copy code'; }, 1400);
});
$('#btnLobbyLeave').addEventListener('click', () => { sfx.click(); goMenu(); });

function renderLobby() {
  if (!S) return;
  $('#lobbyCode').textContent = S.code;
  $('#lobbyRule').textContent = `${R.describe(S.cfg)} · ${S.cfg.np} players`;
  $('#lobbySeats').innerHTML = S.seats.map((s, i) => {
    const open = s.kind === 'open';
    const tag = i === S.mySeat ? 'You' : s.host ? 'Host' : open ? 'Waiting…' : s.kind === 'cpu' ? 'CPU' : 'Joined';
    return `<div class="seat ${open ? 'open' : ''}" style="--c:${R.PLAYERS[i].css}">${glyph(i)}<span class="name">${esc(open ? 'Empty seat' : s.name)}</span><span class="tag">${tag}</span></div>`;
  }).join('');
  const isHost = S.mode === 'host';
  const empty = S.seats.filter((s) => s.kind === 'open').length;
  $('#btnLobbyStart').classList.toggle('hidden', !isHost);
  $('#lobbyNote').textContent = isHost
    ? (empty ? `Share the code. ${empty === 1 ? 'An empty seat' : 'Empty seats'} will be played by the computer.` : 'Everyone is here!')
    : 'Waiting for the host to start…';
}

// ----- host
async function hostCreate() {
  const btn = $('#btnStart');
  btn.disabled = true;
  btn.textContent = 'Creating…';
  $('#setupErr').textContent = '';
  const net = new HostNet();
  try {
    const code = await net.start();
    const cfg = R.normalizeCfg(setup);
    const seats = Array.from({ length: cfg.np }, (_, i) => (i === 0 ? { name: store.get(NAME_KEY) || 'Host', kind: 'human', host: true } : { name: '', kind: 'open' }));
    S = { mode: 'host', net, code, cfg, seats, level: setup.level, mySeat: 0, started: false, G: null };
    wireHost(net);
    renderLobby();
    show('scrLobby');
  } catch (e) {
    net.close();
    $('#setupErr').textContent = e.message || 'Could not create room';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create room';
  }
}

function wireHost(net) {
  const seatOf = (peer) => S?.seats.findIndex((s) => s.peer === peer) ?? -1;
  net.on('message', (peer, msg) => {
    if (!S || S.net !== net || !msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      if (S.started) { net.send(peer, { t: 'reject', msg: 'That game has already started.' }); setTimeout(() => net.kick(peer), 300); return; }
      const k = S.seats.findIndex((s) => s.kind === 'open');
      if (k < 0) { net.send(peer, { t: 'reject', msg: 'That room is full.' }); setTimeout(() => net.kick(peer), 300); return; }
      const name = String(msg.name || '').trim().slice(0, 12) || `Player ${k + 1}`;
      S.seats[k] = { name, kind: 'remote', peer };
      net.send(peer, { t: 'welcome', seat: k, cfg: S.cfg, seats: pubSeats(), code: S.code });
      net.broadcast({ t: 'lobby', cfg: S.cfg, seats: pubSeats() });
      sfx.pop();
      renderLobby();
      return;
    }
    const seat = seatOf(peer);
    if (seat < 0) return;
    if (msg.t === 'move' && S.started) {
      if (!commit(+msg.i, seat)) net.send(peer, { t: 'state', G: S.G, seats: pubSeats() });
    } else if (msg.t === 'next' && S.started) {
      doNextRound();
    } else if (msg.t === 'emoji') {
      net.broadcast({ t: 'emoji', seat, e: msg.e });
      flyEmoji(seat, msg.e);
    }
  });
  net.on('leave', (peer) => {
    if (!S || S.net !== net) return;
    const k = seatOf(peer);
    if (k < 0) return;
    const name = S.seats[k].name;
    if (S.started) {
      S.seats[k] = { name, kind: 'cpu', left: true };
      toast(`${name} left. The computer takes over.`, 3000);
      broadcastState();
      renderScore(S.G);
      if (!S.G.over) setTurnUI(S.G);
      maybeCpu();
    } else {
      S.seats[k] = { name: '', kind: 'open' };
      net.broadcast({ t: 'lobby', cfg: S.cfg, seats: pubSeats() });
      renderLobby();
    }
  });
  net.on('error', (m) => toast(m, 3000));
}

$('#btnLobbyStart').addEventListener('click', () => {
  sfx.unlock(); sfx.click();
  if (S?.mode !== 'host') return;
  S.seats = S.seats.map((s, i) => (s.kind === 'open' ? { name: `CPU ${i + 1}`, kind: 'cpu' } : s));
  S.started = true;
  S.G = R.newGame(S.cfg, 0);
  S.net.broadcast({ t: 'start', cfg: S.cfg, seats: pubSeats(), G: S.G, code: S.code });
  enterGame();
});

function broadcastState() {
  if (S?.mode === 'host' && S.started) S.net.broadcast({ t: 'state', G: S.G, seats: pubSeats() });
}

// ----- guest
async function guestJoin() {
  const code = $('#inpCode').value.trim().toUpperCase();
  if (code.length !== 5) { $('#onlineMsg').textContent = 'Enter the 5-letter room code.'; return; }
  const name = myName();
  const btn = $('#btnJoin');
  btn.disabled = true;
  btn.textContent = '…';
  $('#onlineMsg').textContent = '';
  const net = new ClientNet();
  try {
    await net.join(code);
    S = { mode: 'guest', net, code, cfg: null, seats: [], mySeat: -1, G: null };
    wireGuest(net);
    net.send({ t: 'hello', name });
  } catch (e) {
    net.close();
    $('#onlineMsg').textContent = e.message || 'Could not join';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Join';
  }
}

function wireGuest(net) {
  net.on('message', (msg) => {
    if (!S || S.net !== net || !msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'welcome':
        S.mySeat = msg.seat; S.cfg = R.normalizeCfg(msg.cfg); S.seats = msg.seats;
        sfx.pop();
        renderLobby(); show('scrLobby');
        break;
      case 'lobby':
        S.cfg = R.normalizeCfg(msg.cfg); S.seats = msg.seats;
        if (current === 'scrLobby') renderLobby();
        break;
      case 'start':
        S.cfg = R.normalizeCfg(msg.cfg); S.seats = msg.seats; S.G = msg.G;
        if (!$('#hud').classList.contains('hidden')) { present(S.G, true); toast('New match'); } else enterGame();
        break;
      case 'state':
        clearTimeout(guestMoveTimer);
        S.seats = msg.seats || S.seats;
        S.G = msg.G;
        present(S.G);
        break;
      case 'emoji':
        if (msg.seat !== S.mySeat) flyEmoji(msg.seat, msg.e);
        break;
      case 'reject':
        S.net.close();
        S = null;
        message('Can’t join', msg.msg || 'Room unavailable', () => openOnline());
        break;
      default:
    }
  });
  net.on('close', () => {
    if (!S || S.net !== net) return;
    S = null;
    $('#hud').classList.add('hidden');
    message('Room closed', 'The host left the game.');
  });
  net.on('error', (m) => toast(m, 3000));
}

// ---------------------------------------------------------------- menu demo
// The menu background plays itself: the board shows off 3×3, 4×4 and 5×5.
let demoToken = 0;
const DEMOS = [{ n: 3, rule: 'r3', np: 2 }, { n: 4, rule: 'r3', np: 3 }, { n: 5, rule: 'r4', np: 4 }];
async function startDemo() {
  const tok = ++demoToken;
  arena.setDemo(true);
  arena.setInteractive(false);
  let d = 0;
  const alive = () => tok === demoToken;
  const pause = async (ms) => { do { await sleep(ms); } while (document.hidden && alive()); return alive(); };
  while (alive()) {
    const G = R.newGame(DEMOS[d % DEMOS.length], 0);
    arena.build(G.n);
    arena.setTurn(null, false);
    arena.setView('tilt', false);
    while (alive() && !G.over) {
      if (!(await pause(700))) return;
      const seat = G.turn;
      const i = chooseMove(G, seat, 'easy');
      R.play(G, i, seat);
      arena.setTurn(seat);
      await arena.place(i, seat, true);
    }
    if (!alive()) return;
    if (G.over.winner != null) await arena.showWin(G.over.line, G.over.winner);
    if (!(await pause(2200))) return;
    await arena.clear(true);
    d++;
  }
}
function stopDemo() {
  demoToken++;
  arena.setDemo(false);
}

// ---------------------------------------------------------------- PWA + boot
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#btnInstall').classList.remove('hidden'); });
$('#btnInstall').addEventListener('click', async () => {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice.catch(() => {});
  installEvt = null;
  $('#btnInstall').classList.add('hidden');
});
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !new URLSearchParams(location.search).has('nosw')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
document.addEventListener('visibilitychange', () => { if (document.hidden) flushTweens(); });
window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

ambientFx();
refreshMenu();
show('scrMenu');
startDemo();

const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) openOnline(roomParam.toUpperCase().slice(0, 5));

// handy for debugging from the console
window.__ttt = { arena, get S() { return S; } };
