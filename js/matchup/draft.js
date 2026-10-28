// Fearless Draft (spamcup.online): both players draft 4 cards per game from a shared pool. Per game, with F the player picking first
// (alternating over the BO3) and S the other: F pick, S pick, F pick, S pick, F ban, S ban, S pick, F pick, S pick, F pick. A card
// picked by either player in an earlier game of the match is unavailable to both; a ban lasts one game.
//
//   draftAdvice(model, state, opts) -> the best next pick or ban for the side to act, with my win chance
//
// state: {first: 'me' | 'opp', used: [ids], picks: {me: [{card, talent?}], opp: [...]}, bans: [{by: 'me' | 'opp', card}],
//         pool?: [ids] (default every card of the model), myTalents?: {cardId: [levels]}}
// Search: minimax over the rest of this game's draft (I maximise p(my deck beats theirs), the opponent minimises it), alpha-beta,
// the candidates at each ply limited to a beam ranked by a one-step heuristic, plies past the depth finished by a greedy rollout
// (each side takes its best one-step card), every leaf scored by the full model with both sides at their best talent response.
// Single-game horizon: the value of keeping a card out of the later games of the BO3 is not searched (docs/matchup_model.md).

export const SEQUENCE = [
  ['F', 'pick'], ['S', 'pick'], ['F', 'pick'], ['S', 'pick'], ['F', 'ban'], ['S', 'ban'],
  ['S', 'pick'], ['F', 'pick'], ['S', 'pick'], ['F', 'pick'],
];

// Depth 7: from the 4th action of a game on, the search reaches the end of the draft (no rollout); about 0.1-0.35 s a call on the
// lab PC under full load (examples.js).
export const DEFAULT_SEARCH = { depth: 7, beams: [12, 6, 5, 4, 3, 3, 2, 2, 2, 2], likely: 24 };

export function draftAdvice(model, state, opts = {}) {
  const t0 = now();
  const search = Object.assign({}, DEFAULT_SEARCH, opts);
  const C = model.C;
  const first = state.first === 'opp' ? 'opp' : 'me';
  const who = (role) => (role === 'F' ? first : first === 'me' ? 'opp' : 'me');
  const used = new Set(state.used || []);
  const picksMe = (state.picks && state.picks.me) || [];
  const picksOpp = (state.picks && state.picks.opp) || [];
  const bans = state.bans || [];
  const step = picksMe.length + picksOpp.length + bans.length;
  if (step >= SEQUENCE.length) throw new Error('the draft of this game is complete');
  // The state must be a prefix of the sequence.
  let cm = 0, co = 0, bm = 0, bo = 0;
  for (let s = 0; s < step; s++) {
    const [role, kind] = SEQUENCE[s];
    const side = who(role);
    if (kind === 'pick') side === 'me' ? cm++ : co++;
    else side === 'me' ? bm++ : bo++;
  }
  const bansMe = bans.filter((b) => b.by === 'me').length;
  if (cm !== picksMe.length || co !== picksOpp.length || bm !== bansMe || bo !== bans.length - bansMe) {
    throw new Error('the picks and bans do not match the draft order at step ' + step);
  }
  // Talents are picked after the draft, each side at its best response to the other's deck (the leaves). A talent given with a
  // pick is held fixed; myTalents ({cardId: [levels]}) narrows my side to its unlocked levels. The heuristics rank cards with each
  // card at its best level on its own (lvl).
  const fixedLevel = new Map();
  const myTalents = state.myTalents || null;
  for (const p of picksMe.concat(picksOpp)) if (p.talent !== undefined && p.talent !== null) fixedLevel.set(model.index.get(p.card), p.talent);
  const lvl = (i) => {
    if (fixedLevel.has(i)) return fixedLevel.get(i);
    const t = model.bestLevel(i);
    return t === null ? 0 : t;
  };
  const taken = new Set([...used, ...picksMe.map((p) => p.card), ...picksOpp.map((p) => p.card), ...bans.map((b) => b.card)]);
  const poolIds = (state.pool || model.cards.map((c) => c.id)).filter((c) => model.has(c) && !taken.has(c));
  const pool = poolIds.map((c) => model.index.get(c));
  const tokv = new Float64Array(C);
  for (let i = 0; i < C; i++) tokv[i] = model.tokenValue(i, lvl(i));
  // The likely opponents of a card: the pool's best cards by their own value.
  const likely = [...pool].sort((a, b) => tokv[b] - tokv[a]).slice(0, search.likely);
  // pc[c * C + b]: card c (at its level) against card b (at its level), counters and talent-aware counters, precomputed for the pool
  // and the picked cards.
  const live = [...new Set(pool.concat(picksMe.map((p) => model.index.get(p.card)), picksOpp.map((p) => model.index.get(p.card))))];
  const pc = new Float64Array(C * C);
  for (const i of live) for (const j of live) if (i !== j) pc[i * C + j] = model.pairCross(i, lvl(i), j, lvl(j));
  const xbar = new Float64Array(C);
  for (const i of pool) {
    let s = 0;
    for (const j of likely) if (j !== i) s += pc[i * C + j];
    xbar[i] = s / Math.max(1, likely.length - 1);
  }
  const syn = model.syn;
  let leaves = 0;
  let nodes = 0;

  // One-step gain (in logit, from the adder's side) of adding card c to `own` against `other`, `fut` opponent cards still to come.
  function gain(c, own, other, fut) {
    let g = tokv[c] + fut * xbar[c];
    for (const a of own) g += syn[a * C + c];
    for (const b of other) g += pc[c * C + b];
    return g;
  }

  // A complete game: both sides at their best talent response (the owner's rule), a talent given in the state held fixed.
  const myOpts = (i) => (fixedLevel.has(i) ? [fixedLevel.get(i)] : myTalents && myTalents[model.ids[i]] && myTalents[model.ids[i]].length ? myTalents[model.ids[i]] : null);
  const oppOpts = (i) => (fixedLevel.has(i) ? [fixedLevel.get(i)] : null);
  function exact(me, opp) {
    leaves++;
    const r = model.respondIdx(me, opp, me.map(myOpts), opp.map(oppOpts), null, null);
    return { v: r.p, pv: [], leaf: { me, opp, ours: r.ours, theirs: r.theirs } };
  }

  function remainingPicks(s, side) {
    let n = 0;
    for (let k = s; k < SEQUENCE.length; k++) if (SEQUENCE[k][1] === 'pick' && who(SEQUENCE[k][0]) === side) n++;
    return n;
  }

  function ranked(s, me, opp, avail) {
    const [role, kind] = SEQUENCE[s];
    const actor = who(role);
    // A pick: the actor's own gain; a ban: the card the other side would gain most from.
    const target = kind === 'pick' ? actor : actor === 'me' ? 'opp' : 'me';
    const own = target === 'me' ? me : opp;
    const other = target === 'me' ? opp : me;
    const fut = remainingPicks(s + (kind === 'pick' ? 1 : 0), target === 'me' ? 'opp' : 'me');
    const scored = avail.map((c) => [c, gain(c, own, other, fut)]);
    scored.sort((x, y) => y[1] - x[1] || x[0] - y[0]);
    return { actor, kind, cards: scored.map((x) => x[0]) };
  }

  function apply(s, me, opp, avail, card) {
    const [role, kind] = SEQUENCE[s];
    const actor = who(role);
    const nav = avail.filter((c) => c !== card);
    if (kind === 'ban') return [me, opp, nav];
    return actor === 'me' ? [me.concat([card]), opp, nav] : [me, opp.concat([card]), nav];
  }

  function rollout(s, me, opp, avail) {
    const pv = [];
    while (s < SEQUENCE.length) {
      const r = ranked(s, me, opp, avail);
      pv.push(r.cards[0]);
      [me, opp, avail] = apply(s, me, opp, avail, r.cards[0]);
      s++;
    }
    const out = exact(me, opp);
    out.pv = pv;
    return out;
  }

  // Minimax with alpha-beta; returns {v, pv (the moves after this node), leaf (the predicted decks and talents)}.
  function minimax(s, me, opp, avail, depth, alpha, beta) {
    nodes++;
    if (s >= SEQUENCE.length) return exact(me, opp);
    if (depth <= 0) return rollout(s, me, opp, avail);
    const r = ranked(s, me, opp, avail);
    const width = search.beams[Math.min(search.beams.length - 1, search.depth - depth)] || 2;
    const cands = r.cards.slice(0, width);
    const maxing = r.actor === 'me';
    let best = null;
    for (const c of cands) {
      const [m2, o2, a2] = apply(s, me, opp, avail, c);
      const child = minimax(s + 1, m2, o2, a2, depth - 1, alpha, beta);
      if (best === null || (maxing ? child.v > best.v : child.v < best.v)) best = { v: child.v, pv: [c].concat(child.pv), leaf: child.leaf };
      if (maxing) alpha = Math.max(alpha, best.v);
      else beta = Math.min(beta, best.v);
      if (alpha >= beta) break;
    }
    return best;
  }

  const me0 = picksMe.map((p) => model.index.get(p.card));
  const opp0 = picksOpp.map((p) => model.index.get(p.card));
  const root = ranked(step, me0, opp0, pool);
  const width = search.beams[0];
  const describeLeaf = (leaf) => ({
    me: Object.assign({ cards: leaf.me.map((i) => model.ids[i]), names: leaf.me.map((i) => model.cards[i].fr), our_talents: leaf.ours },
      model.talentFields(leaf.me, leaf.ours, 'our_talents')),
    opp: Object.assign({ cards: leaf.opp.map((i) => model.ids[i]), names: leaf.opp.map((i) => model.cards[i].fr), their_best_response: leaf.theirs },
      model.talentFields(leaf.opp, leaf.theirs, 'their_best_response')),
    model_only: model.modelOnly(leaf.me, leaf.ours) || model.modelOnly(leaf.opp, leaf.theirs),
  });
  const options = root.cards.slice(0, width).map((c) => {
    const [m2, o2, a2] = apply(step, me0, opp0, pool, c);
    const res = minimax(step + 1, m2, o2, a2, search.depth - 1, -Infinity, Infinity);
    return { card: model.ids[c], name: model.cards[c].fr, win: res.v,
      line: [c].concat(res.pv).map((i, k) => ({ step: step + k, actor: who(SEQUENCE[step + k][0]), action: SEQUENCE[step + k][1], card: model.ids[i], name: model.cards[i].fr })),
      final: describeLeaf(res.leaf) };
  });
  options.sort((x, y) => (root.actor === 'me' ? y.win - x.win : x.win - y.win));
  return {
    step,
    actor: root.actor,
    action: root.kind,
    recommend: options[0],
    win: options[0].win,
    alternatives: options.slice(1).map(({ line, final, ...rest }) => rest),
    search: { depth: search.depth, beams: search.beams.slice(0, search.depth), nodes, leaves, pool: pool.length },
    ms: now() - t0,
  };
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
