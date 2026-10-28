// Conquest (spamcup.online): each player registers 3 decks of 4 cards (12 different cards); before the match each secretly bans one
// opponent deck (revealed together); then each must win one game with each of their 2 remaining decks (BO3: 2-0 or 2-1), choosing
// a deck from those still needing a win at the start of each game, both at once.
//
// Pure functions over a win-probability matrix P[i][j] = p(my deck i beats their deck j) (the matchup model's, or any):
//   matchValue(P, mine, theirs)  the exact value of the game sequence from a state (decks still needing a win), each game a
//                                simultaneous matrix game (mixed strategies allowed)
//   orderAdvice(P, mine, theirs) which deck to play now: my equilibrium mix, the opponent's, and each of my decks' worst case
//   banAdvice(P)                 which of their 3 decks to ban: the 3 x 3 ban game (their ban a best response or the equilibrium)
//   prep(model, opts)            the best 3 disjoint decks against a field of likely opponent trios (deckpick.js candidates)

import { solveZeroSum } from './game_theory.js?v=aa3c01bc6a';
import { candidatePool, fieldMatrix, sampleTrios, normaliseField } from './deckpick.js?v=aa3c01bc6a';

// State: bitmasks of the decks still needing a win. Value = P(I win the match), both sides playing the equilibrium.
export function matchValue(P, mine, theirs, memo = new Map()) {
  if (mine === 0) return { value: 1 };
  if (theirs === 0) return { value: 0 };
  const key = mine * 64 + theirs;
  const hit = memo.get(key);
  if (hit) return hit;
  const rows = bits(mine);
  const cols = bits(theirs);
  const A = rows.map((i) => cols.map((j) => {
    const p = P[i][j];
    return p * matchValue(P, mine & ~(1 << i), theirs, memo).value + (1 - p) * matchValue(P, mine, theirs & ~(1 << j), memo).value;
  }));
  const g = solveZeroSum(A);
  const out = { value: g.value, rows, cols, A, row: g.row, col: g.col };
  memo.set(key, out);
  return out;
}

export function bits(mask) {
  const out = [];
  for (let i = 0; mask >> i; i++) if ((mask >> i) & 1) out.push(i);
  return out;
}

export function maskOf(list) {
  return list.reduce((m, i) => m | (1 << i), 0);
}

// Which deck to play in this game. mine / theirs: indices (into P's rows / columns) of the decks still needing a win.
export function orderAdvice(P, mine, theirs) {
  const s = matchValue(P, maskOf(mine), maskOf(theirs));
  if (s.rows === undefined) return { value: s.value, done: true };
  const worst = s.rows.map((i, r) => ({ deck: i, worstCase: Math.min(...s.A[r]), vsTheirMix: s.A[r].reduce((x, v, c) => x + v * s.col[c], 0) }));
  return {
    value: s.value,
    play: s.rows.map((i, r) => ({ deck: i, prob: s.row[r] })),
    theirPlay: s.cols.map((j, c) => ({ deck: j, prob: s.col[c] })),
    perDeck: worst,
    matrix: s.A,
  };
}

// The ban game: row b = I ban their deck b, column a = they ban my deck a; payoff = the match value with the 2 + 2 decks left.
export function banAdvice(P) {
  const n = P.length;
  const m = P[0].length;
  const memo = new Map();
  const full = (1 << n) - 1;
  const fullT = (1 << m) - 1;
  const B = [];
  for (let b = 0; b < m; b++) {
    const row = [];
    for (let a = 0; a < n; a++) row.push(matchValue(P, full & ~(1 << a), fullT & ~(1 << b), memo).value);
    B.push(row);
  }
  const g = solveZeroSum(B);
  const options = B.map((row, b) => {
    let worst = Infinity;
    let resp = -1;
    row.forEach((v, a) => { if (v < worst - 1e-12) { worst = v; resp = a; } });
    return { ban: b, worstCase: worst, theirBestResponse: resp, vsTheirEquilibrium: row.reduce((x, v, a) => x + v * g.col[a], 0) };
  });
  const maximin = options.reduce((best, o) => (o.worstCase > best.worstCase + 1e-12 ? o : best), options[0]);
  return {
    matrix: B,
    equilibrium: { value: g.value, myBan: g.row, theirBan: g.col },
    maximin: { ban: maximin.ban, value: maximin.worstCase },
    options,
  };
}

// Prep: the best 3 card-disjoint decks from the allowed cards against a field of likely opponent decks.
//   model: loadModel(); opts.cards: allowed card ids (default every card of the model); opts.field: [{cards, talents, weight}];
//   opts.objective: 'worst' (default: my ban chosen first, their ban a best response: max_b min_a) or 'equilibrium' (the ban
//   game's value); opts.trios: opponent trios sampled from the field (default 96); opts.top: trios returned (default 5).
export function prep(model, opts = {}) {
  const t0 = now();
  const field = normaliseField(model, opts.field || []);
  if (!field.length) throw new Error('prep needs a field');
  const pool = candidatePool(model, { cards: opts.cards, field, keep: opts.pool || 1500, approx: opts.approx || 3000,
    myTalents: opts.myTalents || null });
  const q = pool.map((d) => d.fieldWin);
  const v2 = (a, b) => pairValue(a, b);
  // Stage 1: card-disjoint trios by the proxy "the opponent bans my best deck, I race with the other two at their field rates".
  const top = Math.min(pool.length, opts.first || 150);
  const proxy = [];
  const masks = pool.map((d) => d.cardIdx);
  for (let i = 0; i < top; i++) {
    for (let j = i + 1; j < top; j++) {
      if (overlap(masks[i], masks[j])) continue;
      for (let k = j + 1; k < pool.length; k++) {
        if (overlap(masks[i], masks[k]) || overlap(masks[j], masks[k])) continue;
        proxy.push({ ids: [i, j, k], score: v2(q[j], q[k]) });
        break; // pool is sorted by field win rate: the first disjoint k is the best third deck for (i, j)
      }
    }
  }
  proxy.sort((x, y) => y.score - x.score);
  const shortlist = proxy.slice(0, opts.shortlist || 200);
  // Stage 2: exact Conquest value against sampled opponent trios.
  const trios = sampleTrios(model, field, opts.trios || 96, opts.seed || 126);
  const used = new Set();
  shortlist.forEach((t) => t.ids.forEach((i) => used.add(i)));
  const usedList = [...used];
  const oppDecks = [];
  const oppIndex = new Map();
  for (const t of trios) for (const d of t.decks) if (!oppIndex.has(d.key)) { oppIndex.set(d.key, oppDecks.length); oppDecks.push(d); }
  const { P } = fieldMatrix(model, usedList.map((i) => pool[i]), oppDecks);
  const rowOf = new Map(usedList.map((i, r) => [i, r]));
  const objective = opts.objective || 'worst';
  const scored = shortlist.map((t) => {
    let total = 0;
    let worstSum = 0;
    for (const trio of trios) {
      const Pm = t.ids.map((i) => trio.decks.map((d) => P[rowOf.get(i)][oppIndex.get(d.key)]));
      const ban = banAdvice(Pm);
      total += trio.weight * (objective === 'worst' ? ban.maximin.value : ban.equilibrium.value);
      worstSum += trio.weight * ban.maximin.value;
    }
    return { ids: t.ids, value: total, worstCase: worstSum };
  });
  scored.sort((x, y) => y.value - x.value);
  const out = scored.slice(0, opts.top || 5).map((s) => ({
    value: s.value,
    worstCase: s.worstCase,
    decks: s.ids.map((i) => deckOut(model, pool[i])),
  }));
  return { objective, trios: trios.length, pool: pool.length, shortlist: shortlist.length, results: out, ms: now() - t0 };
}

// The 2 + 2 match value when my two decks win each game with fixed probabilities a and b, whoever they play.
export function pairValue(a, b) {
  return matchValue([[a, a], [b, b]], 3, 3).value;
}

function overlap(x, y) {
  for (const a of x) for (const b of y) if (a === b) return true;
  return false;
}

// A prep deck: its cards, the talents it most often picks against the field (talents are re-picked each game against the deck
// faced), the board for those talents when it is an AoE deck, its field win chance.
export function deckOut(model, d) {
  return {
    cards: d.cards,
    talents: d.talents,
    order: model.boardIdx(d.ci, d.talents, null).board,
    names: d.cards.map((id) => model.cards[model.index.get(id)].fr),
    fieldWin: d.fieldWin,
    full_games: model.fullGames(d.ci),
  };
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
