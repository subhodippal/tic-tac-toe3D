// Pure rules engine: board sizes 3–10, three win rules, 2–4 players.
// Ported from the XO multiplayer game (same variants and win shapes).

export const SIZES = [3, 4, 5, 6, 7, 8, 9, 10];

export const RULES = {
  r3: { len: 3, kmap: false, label: '3 in a row', short: '3×' },
  r4: { len: 4, kmap: false, label: '4 in a row', short: '4×' },
  rk: { len: 4, kmap: true, label: 'Square & wrap', short: '4□' },
};

// Player colours per theme. PLAYERS is updated in place by usePalette(),
// so everything that reads PLAYERS[seat] follows the active theme.
export const PALETTES = {
  neon: [
    { name: 'Cyan', hex: 0x00f0ff, css: '#00f0ff' },
    { name: 'Pink', hex: 0xff2bd6, css: '#ff2bd6' },
    { name: 'Lime', hex: 0x7dff3a, css: '#7dff3a' },
    { name: 'Amber', hex: 0xffb21e, css: '#ffb21e' },
  ],
  paper: [ // ballpoint pens
    { name: 'Blue', hex: 0x1d47c4, css: '#1d47c4' },
    { name: 'Red', hex: 0xd42a2a, css: '#d42a2a' },
    { name: 'Green', hex: 0x1d8a3a, css: '#1d8a3a' },
    { name: 'Yellow', hex: 0xe8a900, css: '#e0a100' },
  ],
};
const SYMS = ['X', 'O', '▲', '■'];
export const PLAYERS = PALETTES.neon.map((p, i) => ({ sym: SYMS[i], ...p }));
export function usePalette(theme) {
  (PALETTES[theme] || PALETTES.neon).forEach((p, i) => Object.assign(PLAYERS[i], p));
}

// A rule only makes sense if the run fits, and wrapping needs a 4-wide grid
export function ruleOK(n, rule) {
  const R = RULES[rule];
  if (!R || R.len > n) return false;
  if (R.kmap && n < 4) return false;
  return true;
}

// 3×3 holds 2 players, 4×4 three, 5×5 and bigger four
export const maxPlayers = (n) => (n <= 3 ? 2 : n === 4 ? 3 : 4);

export function normalizeCfg(cfg) {
  const n = SIZES.includes(+cfg.n) ? +cfg.n : 3;
  let rule = RULES[cfg.rule] ? cfg.rule : 'r3';
  if (!ruleOK(n, rule)) rule = 'r3';
  const np = Math.max(2, Math.min(maxPlayers(n), +cfg.np || 2));
  return { n, rule, np };
}

// ---------------------------------------------------------------- patterns
const patCache = new Map();
export function patterns(n, rule) {
  const key = n + rule;
  if (patCache.has(key)) return patCache.get(key);
  const R = RULES[rule];
  const L = R.len;
  const out = [];
  const seen = new Set();
  const at = (r, c) => r * n + c;
  const add = (a) => {
    const s = a.slice().sort((x, y) => x - y);
    const k = s.join(',');
    if (!seen.has(k)) { seen.add(k); out.push(s); }
  };
  if (R.kmap) {
    // rows and columns of four that wrap round the edges, like a Karnaugh map
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      add([0, 1, 2, 3].map((k) => at(r, (c + k) % n)));
      add([0, 1, 2, 3].map((k) => at((r + k) % n, c)));
    }
    // two-by-two blocks, wrapping too: four corners count, and left+right pairs
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      add([at(r, c), at(r, (c + 1) % n), at((r + 1) % n, c), at((r + 1) % n, (c + 1) % n)]);
    }
    // straight diagonals of four, no wrapping
    for (let r = 0; r + 3 < n; r++) for (let c = 0; c + 3 < n; c++) {
      add([0, 1, 2, 3].map((k) => at(r + k, c + k)));
      add([0, 1, 2, 3].map((k) => at(r + k, c + 3 - k)));
    }
  } else {
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (c + L <= n) add(Array.from({ length: L }, (_, k) => at(r, c + k)));
      if (r + L <= n) add(Array.from({ length: L }, (_, k) => at(r + k, c)));
      if (r + L <= n && c + L <= n) add(Array.from({ length: L }, (_, k) => at(r + k, c + k)));
      if (r + L <= n && c - L + 1 >= 0) add(Array.from({ length: L }, (_, k) => at(r + k, c - k)));
    }
  }
  patCache.set(key, out);
  return out;
}

const thruCache = new Map();
export function through(n, rule, cell) {
  const key = n + rule + ':' + cell;
  if (!thruCache.has(key)) thruCache.set(key, patterns(n, rule).filter((p) => p.includes(cell)));
  return thruCache.get(key);
}

export function winAt(board, n, rule, cell, seat) {
  for (const p of through(n, rule, cell)) if (p.every((i) => board[i] === seat)) return p;
  return null;
}

// A straight, non-wrapping run can be struck through with a line.
// Returns [startCell, endCell] or null.
export function runEnds(p, n) {
  const r = p.map((i) => (i / n) | 0), c = p.map((i) => i % n);
  const consecutive = (a) => { const s = a.slice().sort((x, y) => x - y); return s.every((x, i) => i === 0 || x === s[i - 1] + 1); };
  const same = (a) => a.every((x) => x === a[0]);
  const asc = p.slice().sort((x, y) => x - y);
  if (same(r) && consecutive(c)) return [asc[0], asc[asc.length - 1]];
  if (same(c) && consecutive(r)) return [asc[0], asc[asc.length - 1]];
  if (consecutive(r) && consecutive(c)) {
    const d1 = asc.every((x, i) => i === 0 || x === asc[i - 1] + n + 1);
    const d2 = asc.every((x, i) => i === 0 || x === asc[i - 1] + n - 1);
    if (d1 || d2) return [asc[0], asc[asc.length - 1]];
  }
  return null;
}

// ---------------------------------------------------------------- game state
export function newGame(cfg, starter = 0) {
  const { n, rule, np } = normalizeCfg(cfg);
  return {
    n, rule, np,
    board: Array(n * n).fill(-1),
    turn: starter, starter,
    round: 1,
    over: null, // { winner: seat|null, line: [...]|null }
    last: -1,
    moves: 0,
    scores: [0, 0, 0, 0],
    draws: 0,
  };
}

export function legal(G, i, seat) {
  return !!G && !G.over && G.turn === seat && i >= 0 && i < G.board.length && G.board[i] < 0;
}

// Mutates G. Returns true if the move was applied.
export function play(G, i, seat) {
  if (!legal(G, i, seat)) return false;
  G.board[i] = seat;
  G.last = i;
  G.moves++;
  const line = winAt(G.board, G.n, G.rule, i, seat);
  if (line) {
    G.over = { winner: seat, line };
    G.scores[seat]++;
  } else if (G.board.every((v) => v >= 0)) {
    G.over = { winner: null, line: null };
    G.draws++;
  } else {
    G.turn = (G.turn + 1) % G.np;
  }
  return true;
}

// Next round: starter rotates so nobody always goes first
export function nextRound(G) {
  G.starter = (G.starter + 1) % G.np;
  G.turn = G.starter;
  G.board = Array(G.n * G.n).fill(-1);
  G.over = null;
  G.last = -1;
  G.moves = 0;
  G.round++;
}

export function describe(cfg) {
  const { n, rule } = normalizeCfg(cfg);
  return `${n}×${n} · ${RULES[rule].label}`;
}
