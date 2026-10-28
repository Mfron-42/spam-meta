// The matchup model's scorer: p(deck A beats deck B) on game 1.26, from the exported weights (studies/matchup_model/export.py).
// Pure functions, no dependency, ES module for the browser and Node. Its Python twin is studies/matchup_model/scorer.py: both read the
// same JSON and sum in the same order (web/matchup/tests/parity.test.js and tests/test_matchup_model.py check them equal on 1,000
// pairs, fixed talents and talent responses).
//
//   const M = loadModel(weightsJson)
//   M.winProb(A, B)       p for the talents the decks state: {cards: [4 ids], talents: [4 levels], order?: [4 ids]}
//   M.respond(A, B)       the response-aware p: each side picks its talents once the other deck is known (the owner's rule,
//                         2026-10-27): {p, logit, ours, theirs, modelOnly}
//
// Talents are levels: 0 = none, 1..n = the card's n-th talent. In a response each card takes one of its legal levels (1..n; the
// deck's `talentOptions` [[levels] x 4] narrows them, e.g. to the unlocked ones). The logit is a sum of a part that depends only on
// A's talents and a part that depends only on B's (the counters between talents and opposing cards are per card), so the best
// response of each side does not depend on the other's choice: max over ours of min over theirs is a pure saddle point, the same
// whether the talents are picked at once or in turn. `order` (the board) is read only for an AoE deck, else the best board is used.

const TRIPLES = [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]];
const MAXLV = 16;

export function loadModel(json) {
  const C = json.cards.length;
  const index = new Map();
  json.cards.forEach((c, i) => index.set(c.id, i));
  const tokBase = json.cards.map((c) => c.tok_base || 0);
  // tok[i][t]: card i at talent level t; a level the data never saw is null in the JSON and scores the card's base.
  const tok = json.tok.map((row, i) => Float64Array.from(row.map((v) => (v === null ? tokBase[i] : v))));
  const seenLevel = json.tok.map((row) => row.map((v) => v !== null));
  const legal = json.cards.map((c, i) => {
    const n = (c.talents || []).length;
    const out = [];
    for (let t = 1; t <= n; t++) out.push(t);
    return out.length ? out : [0];
  });
  const syn = new Float64Array(C * C);
  const cross = new Float64Array(C * C);
  let k = 0;
  for (let i = 0; i < C; i++) {
    for (let j = i + 1; j < C; j++) {
      syn[i * C + j] = json.syn[k];
      syn[j * C + i] = json.syn[k];
      cross[i * C + j] = json.cross[k];
      cross[j * C + i] = -json.cross[k];
      k++;
    }
  }
  const adj = new Float64Array(C * C);
  for (const [p, q, v] of json.adj || []) adj[p * C + q] = v;
  const edge = new Float64Array(C);
  for (const [p, v] of json.edge || []) edge[p] = v;
  const slot = json.cards.map((c) => new Set(c.slot || []));
  const triRank = json.tri_rank || 0;
  const tri = triRank ? Float64Array.from(json.tri) : null;
  const decks = new Map(Object.entries(json.decks || {}));
  // the card sets that hold a known-deck residual (their talent responses are enumerated, not taken card by card), as numbers
  const residualSets = new Set();
  for (const key of decks.keys()) residualSets.add(csKey(key.split('@')[0].split('|').map((p) => +p.split(':')[0])));
  function csKey(ci) {
    const s = [...ci].sort((a, b) => a - b);
    return ((s[0] * C + s[1]) * C + s[2]) * C + s[3];
  }
  // talent-aware counters, dense: Y[token, card]
  const tokenIds = json.token_ids || [];
  const tokId = new Int32Array(C * MAXLV).fill(-1);
  tokenIds.forEach(([i, t], kk) => { tokId[i * MAXLV + t] = kk; });
  const hasT = !!(json.tcross && json.tcross.length);
  const tcross = hasT ? new Float64Array(tokenIds.length * C) : null;
  if (hasT) for (const [kt, b, v] of json.tcross) tcross[kt * C + b] = v;

  const tokenId = (i, t) => (t >= 0 && t < MAXLV ? tokId[i * MAXLV + t] : -1);

  function idx(cards) {
    return cards.map((id) => {
      const i = index.get(id);
      if (i === undefined) throw new Error('unknown card ' + id);
      return i;
    });
  }

  function tokenValue(i, t) {
    const row = tok[i];
    return t >= 0 && t < row.length ? row[t] : tokBase[i];
  }

  function slotCards(ci, tl) {
    const out = [];
    for (let q = 0; q < 4; q++) if (slot[ci[q]].has(tl[q])) out.push(ci[q]);
    return out;
  }

  function boardValue(b, slots) {
    let s = 0;
    for (let pos = 0; pos < 4; pos++) {
      const p = b[pos];
      if (!slots.includes(p)) continue;
      if (pos === 0 || pos === 3) s += edge[p];
      if (pos > 0) s += adj[p * C + b[pos - 1]];
      if (pos < 3) s += adj[p * C + b[pos + 1]];
    }
    return s;
  }

  const PERMS = permutations([0, 1, 2, 3]);
  const ids = json.cards.map((c) => c.id);

  // The board term and the canonical board (card ids) of a deck given as indices; null board when no card's own slot matters.
  function boardIdx(ci, tl, orderIdx) {
    const slots = slotCards(ci, tl);
    if (!slots.length) return { value: 0, board: null };
    if (orderIdx) return { value: boardValue(orderIdx, slots), board: canonicalBoard(orderIdx.map((i) => ids[i])) };
    let best = -Infinity;
    let bestPerm = null;
    for (const perm of PERMS) {
      const v = boardValue(perm.map((q) => ci[q]), slots);
      if (v > best + 1e-15) {
        best = v;
        bestPerm = perm;
      }
    }
    return { value: best, board: canonicalBoard(bestPerm.map((q) => ids[ci[q]])) };
  }

  // A known deck's key in the export: its card indices (sorted) with talents, plus the canonical board's indices for an AoE deck.
  function keyIdx(ci, tl, boardIds) {
    const pairs = ci.map((i, q) => [i, tl[q]]).sort((x, y) => x[0] - y[0]);
    let s = pairs.map(([i, t]) => i + ':' + t).join('|');
    if (boardIds) s += '@' + boardIds.map((id) => index.get(id)).join('>');
    return s;
  }

  function strengthIdx(ci, tl, orderIdx) {
    let s = 0;
    for (let q = 0; q < 4; q++) s += tokenValue(ci[q], tl[q]);
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) s += syn[ci[i] * C + ci[j]];
    if (tri) {
      let t = 0;
      for (const [x, y, z] of TRIPLES) {
        const ex = ci[x] * triRank;
        const ey = ci[y] * triRank;
        const ez = ci[z] * triRank;
        for (let q = 0; q < triRank; q++) t += tri[ex + q] * tri[ey + q] * tri[ez + q];
      }
      s += t;
    }
    const b = boardIdx(ci, tl, orderIdx);
    s += b.value;
    if (residualSets.has(csKey(ci))) {
      const r = decks.get(keyIdx(ci, tl, b.board));
      if (r !== undefined) s += r;
    }
    return s;
  }

  function crossIdx(ca, ta, cb, tb) {
    let x = 0;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) x += cross[ca[i] * C + cb[j]];
    if (hasT) {
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          const ka = ta[i];
          const kb = tb[j];
          x += (ka >= 0 ? tcross[ka * C + cb[j]] : 0) - (kb >= 0 ? tcross[kb * C + ca[i]] : 0);
        }
      }
    }
    return x;
  }

  const tokensOf = (ci, tl) => tl.map((t, q) => tokenId(ci[q], t));

  function strength(deck) {
    return strengthIdx(idx(deck.cards), deck.talents, deck.order ? idx(deck.order) : null);
  }

  function crossTerm(A, B) {
    const ca = idx(A.cards);
    const cb = idx(B.cards);
    return crossIdx(ca, tokensOf(ca, A.talents), cb, tokensOf(cb, B.talents));
  }

  function logit(A, B) {
    return strength(A) - strength(B) + crossTerm(A, B);
  }

  function winProb(A, B) {
    return 1 / (1 + Math.exp(-logit(A, B)));
  }

  // The talent-dependent part of a side's logit against the opposing card set `opp`: the talents' own values (strength) plus their
  // counters against the opposing cards. The best response maximises it.
  function sideValue(ci, tl, opp, orderIdx) {
    let v = strengthIdx(ci, tl, orderIdx);
    if (hasT) {
      for (let i = 0; i < 4; i++) {
        const ka = tokenId(ci[i], tl[i]);
        if (ka < 0) continue;
        for (let j = 0; j < 4; j++) v += tcross[ka * C + opp[j]];
      }
    }
    return v;
  }

  // The best talents of the card set ci against the opposing card set opp. options: null or [[levels] x 4] (legal levels by default).
  function bestTalents(ci, opp, options, orderIdx) {
    const opts = ci.map((i, q) => (options && options[q] && options[q].length ? options[q] : legal[i]));
    const enumerate = residualSets.has(csKey(ci)) ||
      ci.some((i, q) => opts[q].some((t) => slot[i].has(t)));
    if (!enumerate) {
      const tl = [];
      for (let q = 0; q < 4; q++) {
        const i = ci[q];
        let best = -Infinity;
        let bt = opts[q][0];
        for (const t of opts[q]) {
          let v = tokenValue(i, t);
          const ka = tokenId(i, t);
          if (hasT && ka >= 0) for (let j = 0; j < 4; j++) v += tcross[ka * C + opp[j]];
          if (v > best) {
            best = v;
            bt = t;
          }
        }
        tl.push(bt);
      }
      return tl;
    }
    // Enumerated: each combination's strength does not depend on the opponent, so it is cached per card set, options and board;
    // the talent-aware counters are added in sideValue's order (the same doubles).
    const ck = ci.join(',') + '|' + opts.map((o) => o.join('.')).join(',') + '|' + (orderIdx ? orderIdx.join(',') : '');
    let combos = comboCache.get(ck);
    if (!combos) {
      combos = [];
      for (const t0 of opts[0]) for (const t1 of opts[1]) for (const t2 of opts[2]) for (const t3 of opts[3]) {
        const tl = [t0, t1, t2, t3];
        combos.push({ tl, s: strengthIdx(ci, tl, orderIdx), tk: tl.map((t, q) => tokenId(ci[q], t)) });
      }
      if (comboCache.size > 20000) comboCache.clear();
      comboCache.set(ck, combos);
    }
    let best = -Infinity;
    let bestTl = null;
    for (const c of combos) {
      let v = c.s;
      if (hasT) {
        for (let i = 0; i < 4; i++) {
          const ka = c.tk[i];
          if (ka < 0) continue;
          for (let j = 0; j < 4; j++) v += tcross[ka * C + opp[j]];
        }
      }
      if (v > best) {
        best = v;
        bestTl = c.tl;
      }
    }
    return bestTl.slice();
  }
  const comboCache = new Map();

  // The response-aware matchup: each side at its best talents against the other's card set.
  function respondIdx(ca, cb, optA, optB, orderA, orderB) {
    const ta = bestTalents(ca, cb, optA, orderA);
    const tb = bestTalents(cb, ca, optB, orderB);
    const z = strengthIdx(ca, ta, orderA) - strengthIdx(cb, tb, orderB) + crossIdx(ca, tokensOf(ca, ta), cb, tokensOf(cb, tb));
    return { logit: z, p: 1 / (1 + Math.exp(-z)), ours: ta, theirs: tb };
  }

  function respond(A, B) {
    const ca = idx(A.cards);
    const cb = idx(B.cards);
    const r = respondIdx(ca, cb, A.talentOptions || null, B.talentOptions || null, A.order ? idx(A.order) : null, B.order ? idx(B.order) : null);
    r.modelOnly = modelOnly(ca, r.ours) || modelOnly(cb, r.theirs);
    return r;
  }

  // Per talent, what the data holds for a side's chosen levels: `<side>_model_only` [4 booleans] (that card's level never appeared in
  // the training cells: modelOnly per card), `<side>_full_games` [4] (the card's full-AI games at that level, any deck) and the exact
  // combination's full-AI games (`our_variant_full_games` / `their_variant_full_games`: 0 = these four talents were never played
  // together; the model composes them from levels read in other decks). side: 'our_talents' or 'their_best_response'.
  const variants = new Map(Object.entries(json.variant_games || {}));
  function variantGames(ci, tl) {
    const key = ci.map((i, q) => [i, tl[q]]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map((p) => p[0] + ':' + p[1]).join('|');
    return variants.get(key) || 0;
  }
  function talentFields(ci, tl, side) {
    const out = {};
    out[side + '_model_only'] = ci.map((i, q) => !seenLevel[i][tl[q]]);
    out[side + '_full_games'] = ci.map((i, q) => (json.cards[i].games_by_level || [])[tl[q]] || 0);
    out[side === 'our_talents' ? 'our_variant_full_games' : 'their_variant_full_games'] = variantGames(ci, tl);
    return out;
  }

  // True when a chosen talent level never appeared in the training cells (under any pilot): its value is the card's base and its
  // talent-aware counters are 0, the model's guess, not a reading.
  function modelOnly(ci, tl) {
    return ci.some((i, q) => !seenLevel[i][tl[q]]);
  }

  // The talent level the model rates best for a card on its own (legal levels the data saw; null when none was seen).
  function bestLevel(i) {
    let best = null;
    for (const t of legal[i]) if (seenLevel[i][t] && (best === null || tok[i][t] > tok[i][best])) best = t;
    if (best === null && seenLevel[i][0]) best = 0;
    return best;
  }

  // The full-AI games of a card set in the training data (any talents): 0 for a deck the data never played, whose p is the model's
  // composition of its cards, pairs and counters (validated on unseen decks, docs/matchup_model.md).
  const known = new Map(Object.entries(json.known_sets || {}));
  function fullGames(ci) {
    return known.get([...ci].sort((a, b) => a - b).join('|')) || 0;
  }

  // The counter of card i at level ti against card j at level tj (the search heuristics' unit; logit, i's side).
  function pairCross(i, ti, j, tj) {
    let x = cross[i * C + j];
    if (hasT) {
      const ka = tokenId(i, ti);
      const kb = tokenId(j, tj);
      x += (ka >= 0 ? tcross[ka * C + j] : 0) - (kb >= 0 ? tcross[kb * C + i] : 0);
    }
    return x;
  }

  return {
    json, C, index, ids, tok, syn, cross, adj, edge, slot, decks, legal, cards: json.cards,
    idx, tokenValue, tokenId, strength, strengthIdx, crossTerm, crossIdx, logit, winProb, keyIdx, boardIdx,
    bestTalents, respondIdx, respond, modelOnly, bestLevel, pairCross, fullGames, variantGames, talentFields,
    has: (id) => index.has(id),
  };
}

export function canonicalBoard(order) {
  const fwd = order.join('>');
  const rev = [...order].reverse().join('>');
  return fwd <= rev ? [...order] : [...order].reverse();
}

export function permutations(xs) {
  if (xs.length <= 1) return [xs.slice()];
  const out = [];
  xs.forEach((x, i) => {
    for (const rest of permutations(xs.slice(0, i).concat(xs.slice(i + 1)))) out.push([x, ...rest]);
  });
  return out;
}

export function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}
