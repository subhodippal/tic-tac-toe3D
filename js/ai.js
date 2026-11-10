// Computer opponent: perfect minimax on 2-player 3×3, a threat-scoring
// heuristic everywhere else. Skill sets how often it "slips".

import { patterns, winAt } from './rules.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const SLIP = { easy: 0.45, normal: 0.14, hard: 0 };

function outcome3(bd) {
  for (const p of patterns(3, 'r3')) if (bd[p[0]] > -1 && p.every((i) => bd[i] === bd[p[0]])) return bd[p[0]];
  return bd.every((v) => v > -1) ? 'D' : null;
}

function minimax(bd, turn, me, depth) {
  const o = outcome3(bd);
  if (o !== null) return o === 'D' ? 0 : o === me ? 10 - depth : depth - 10;
  const other = turn === 0 ? 1 : 0;
  let best = turn === me ? -Infinity : Infinity;
  for (let i = 0; i < 9; i++) {
    if (bd[i] > -1) continue;
    bd[i] = turn;
    const s = minimax(bd, other, me, depth + 1);
    bd[i] = -1;
    best = turn === me ? Math.max(best, s) : Math.min(best, s);
  }
  return best;
}

function bestMove3(bd, me) {
  const other = me === 0 ? 1 : 0;
  let best = -Infinity, picks = [];
  for (let i = 0; i < 9; i++) {
    if (bd[i] > -1) continue;
    bd[i] = me;
    const s = minimax(bd, other, me, 0);
    bd[i] = -1;
    if (s > best) { best = s; picks = [i]; } else if (s === best) picks.push(i);
  }
  return pick(picks);
}

function wouldWin(G, i, seat) {
  G.board[i] = seat;
  const w = !!winAt(G.board, G.n, G.rule, i, seat);
  G.board[i] = -1;
  return w;
}

function heuristic(G, me) {
  const open = [];
  G.board.forEach((v, i) => { if (v < 0) open.push(i); });
  if (!open.length) return -1;
  for (const i of open) if (wouldWin(G, i, me)) return i; // take the win
  for (let k = 1; k < G.np; k++) { // block, nearest threat first
    const op = (me + k) % G.np;
    for (const i of open) if (wouldWin(G, i, op)) return i;
  }
  const all = patterns(G.n, G.rule), N = G.n;
  let best = open[0], bs = -Infinity;
  for (const i of open) {
    let s = 0;
    for (const p of all) {
      if (!p.includes(i)) continue;
      let mine = 0, theirs = 0;
      for (const c of p) { const v = G.board[c]; if (v < 0) continue; if (v === me) mine++; else theirs++; }
      if (mine && theirs) continue; // dead shape
      if (theirs) s += [1, 4, 14][Math.min(theirs, 3) - 1];
      else s += [2, 9, 40][Math.min(mine + 1, 3) - 1];
    }
    const r = (i / N) | 0, c = i % N;
    s += (N - 1 - Math.abs(2 * r - (N - 1)) - Math.abs(2 * c - (N - 1))) * 0.6; // centre is worth a little
    s += Math.random() * 4;
    if (s > bs) { bs = s; best = i; }
  }
  return best;
}

export function chooseMove(G, me, level = 'normal') {
  const open = G.board.map((v, i) => (v > -1 ? -1 : i)).filter((i) => i > -1);
  if (!open.length) return -1;
  const slip = open.length > 1 && Math.random() < (SLIP[level] ?? 0.14);
  if (slip) {
    // even a slip still takes an immediate win most of the time
    if (Math.random() < 0.5) for (const i of open) if (wouldWin(G, i, me)) return i;
    return pick(open);
  }
  if (G.n === 3 && G.np === 2) return bestMove3(G.board.slice(), me);
  return heuristic(G, me);
}
