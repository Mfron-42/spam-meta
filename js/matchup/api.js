// The JSON contract of the site's "Draft" tab: one request object in, one response object out (docs/matchup_model.md, section
// "Site contract", lists every field). No I/O: the page loads the weights and the default field once and passes them in.
//
//   const M = loadModel(weights); handle(M, field, {kind: 'conquest.ban', mine: [...], theirs: [...]})
//
// Every p is response-aware (the owner's rule, 2026-10-27): talents are picked once the other deck is known, each side at its best
// response; a deck's own `talents` are not used, only `talentOptions` ([[levels] x 4]: the levels a side may pick, e.g. its unlocked
// ones) or the request's `myTalents` ({cardId: [levels]}, my side). Each p comes with its talent pair: `our_talents` and
// `their_best_response` (levels aligned with the deck's cards), and `model_only` when a chosen level never appeared in the data; per
// talent, `our_talents_model_only` / `their_best_response_model_only` (which level is the model's guess) and `..._full_games` (the
// card's full-AI games at that level), and `our_variant_full_games` / `their_variant_full_games` (0: that talent combination was never
// played, the model composes it).
// A deck is {cards: [4 card ids], order?: [4 card ids], talentOptions?}. Every response carries ok, kind and ms; an error is
// {ok: false, kind, error}.

import { orderAdvice, banAdvice, prep, matchValue, maskOf } from './conquest.js?v=813db21b65';
import { draftAdvice } from './draft.js?v=813db21b65';
import { ingameAdvice } from './deckpick.js?v=813db21b65';

export const KINDS = ['winprob', 'matrix', 'conquest.ban', 'conquest.order', 'conquest.prep', 'fearless_draft.next', 'ingame.fearless', 'ingame.draft'];

export function handle(model, defaultField, req) {
  const t0 = now();
  const kind = req && req.kind;
  try {
    const out = dispatch(model, defaultField, req);
    return Object.assign({ ok: true, kind }, out, { ms: round(now() - t0, 1) });
  } catch (e) {
    return { ok: false, kind, error: String(e && e.message ? e.message : e), ms: round(now() - t0, 1) };
  }
}

// The response-aware matchup of my deck a against their deck b, with the talent pair behind p.
function matchup(model, a, b, myTalents) {
  const A = Object.assign({}, a, { talentOptions: a.talentOptions || (myTalents ? a.cards.map((c) => myTalents[c] || null) : null) });
  const r = model.respond(A, b);
  return Object.assign({ p: r.p, our_talents: r.ours, their_best_response: r.theirs, model_only: r.modelOnly },
    model.talentFields(model.idx(a.cards), r.ours, 'our_talents'), model.talentFields(model.idx(b.cards), r.theirs, 'their_best_response'));
}

// The talent pair of one matrix cell: matchup()'s fields without p.
function talentPair(m) {
  const out = {};
  for (const k of Object.keys(m)) if (k !== 'p') out[k] = m[k];
  return out;
}

function matrixOf(model, mine, theirs, myTalents) {
  const P = [];
  const talents = [];
  let modelOnly = false;
  for (const a of mine) {
    const row = [];
    const trow = [];
    for (const b of theirs) {
      const m = matchup(model, a, b, myTalents);
      row.push(m.p);
      trow.push(talentPair(m));
      modelOnly = modelOnly || m.model_only;
    }
    P.push(row);
    talents.push(trow);
  }
  return { P, talents, model_only: modelOnly };
}

function dispatch(model, defaultField, req) {
  const dress = (d) => checkDeck(model, d);
  const myTalents = req.myTalents || null;
  switch (req.kind) {
    case 'winprob': {
      const a = dress(req.a);
      const b = dress(req.b);
      const m = matchup(model, a, b, myTalents);
      const out = Object.assign({}, m, { a: describe(model, a), b: describe(model, b) });
      if (req.a.talents && req.b.talents) out.p_stated_talents = model.winProb(Object.assign({}, a, { talents: req.a.talents }), Object.assign({}, b, { talents: req.b.talents }));
      return out;
    }
    case 'matrix':
      return matrixOf(model, req.a.map(dress), req.b.map(dress), myTalents);
    case 'conquest.ban': {
      const mine = req.mine.map(dress);
      const theirs = req.theirs.map(dress);
      checkConquest(mine, theirs);
      const M = matrixOf(model, mine, theirs, myTalents);
      const ban = banAdvice(M.P);
      return {
        P: M.P,
        talents: M.talents,
        model_only: M.model_only,
        recommend: { ban: ban.maximin.ban, deck: describe(model, theirs[ban.maximin.ban]), worstCase: ban.maximin.value },
        equilibrium: ban.equilibrium,
        options: ban.options.map((o) => Object.assign({}, o, { deck: describe(model, theirs[o.ban]) })),
        matrix: ban.matrix,
      };
    }
    case 'conquest.order': {
      const mine = req.mine.map(dress);
      const theirs = req.theirs.map(dress);
      const mineLeft = req.mineLeft || mine.map((_, i) => i);
      const theirsLeft = req.theirsLeft || theirs.map((_, i) => i);
      const M = matrixOf(model, mine, theirs, myTalents);
      const o = orderAdvice(M.P, mineLeft, theirsLeft);
      if (o.done) return { P: M.P, talents: M.talents, value: o.value, done: true };
      const best = o.play.reduce((b, x) => (x.prob > b.prob ? x : b), o.play[0]);
      return { P: M.P, talents: M.talents, model_only: M.model_only, value: o.value, recommend: { deck: best.deck, prob: best.prob },
        play: o.play, theirPlay: o.theirPlay, perDeck: o.perDeck, matrix: o.matrix };
    }
    case 'conquest.prep': {
      const field = req.field && req.field !== 'default' ? req.field : defaultField;
      return prep(model, { cards: req.cards || null, field, objective: req.objective, top: req.top, trios: req.trios,
        seed: req.seed, pool: req.pool, first: req.first, shortlist: req.shortlist, approx: req.approx, myTalents });
    }
    case 'fearless_draft.next':
      return draftAdvice(model, req, req.search || {});
    case 'ingame.fearless':
    case 'ingame.draft': {
      const field = req.field && req.field !== 'default' ? req.field : defaultField;
      return ingameAdvice(model, Object.assign({}, req, { mode: req.kind === 'ingame.fearless' ? 'fearless' : 'draft', field }));
    }
    default:
      throw new Error('unknown kind ' + req.kind + ' (one of ' + KINDS.join(', ') + ')');
  }
}

export function checkDeck(model, d) {
  if (!d || !Array.isArray(d.cards) || d.cards.length !== 4) throw new Error('a deck is 4 card ids');
  if (new Set(d.cards).size !== 4) throw new Error('a deck holds 4 different cards');
  for (const c of d.cards) if (!model.has(c)) throw new Error('unknown card ' + c);
  if (d.order && (d.order.length !== 4 || !d.order.every((c) => d.cards.includes(c)) || new Set(d.order).size !== 4)) {
    throw new Error('a deck order is its 4 cards in board order');
  }
  if (d.talentOptions) {
    if (d.talentOptions.length !== 4) throw new Error('talentOptions: one list of levels per card');
    d.talentOptions.forEach((o, q) => {
      if (o && !o.every((t) => model.legal[model.index.get(d.cards[q])].includes(t))) throw new Error('talentOptions: a level the card does not have');
    });
  }
  return { cards: d.cards.slice(), order: d.order ? d.order.slice() : null, talentOptions: d.talentOptions || null };
}

function checkConquest(mine, theirs) {
  for (const side of [mine, theirs]) {
    if (side.length !== 3) throw new Error('Conquest: 3 decks a side');
    const cards = new Set(side.flatMap((d) => d.cards));
    if (cards.size !== 12) throw new Error('Conquest: the 3 decks of a side hold 12 different cards');
  }
}

export function describe(model, d) {
  return { cards: d.cards, order: d.order || null, names: d.cards.map((c) => model.cards[model.index.get(c)].fr),
    full_games: model.fullGames(model.idx(d.cards)) };
}

function round(x, k) {
  const f = 10 ** k;
  return Math.round(x * f) / f;
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export { matchValue, maskOf };
