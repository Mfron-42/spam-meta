// Best decks from a set of cards against a weighted field of likely opponent decks (pure functions over the matchup model).
//
// Every matchup is response-aware (the owner's rule, 2026-10-27): both sides pick their talents once the other deck is known, each
// at its best response (model.respondIdx); a field deck is a card set, its census talents are never used.
//
//   normaliseField(model, field)            field entries {cards, weight, ...} -> prepared opponents, weights summing to 1
//   candidatePool(model, {cards, field})    every 4-card deck of the allowed cards scored by a fast bound (its field-weighted mean
//                                           logit, each card at its best level), the best `approx` re-scored exactly (the
//                                           field-weighted response-aware win chance), best first
//   ingameAdvice(model, request)            the in-game tournament modes: Fearless (my played cards are banned for me; the
//                                           opponent's banned list filters their likely decks) and Draft (no bans)
//   sampleTrios(model, field, n, seed)      card-disjoint opponent trios drawn by meta weight (Conquest prep)
//   fieldMatrix(model, A, B)                {P, T}: P[i][j] = response-aware p(A[i] beats B[j]), T[i][j] = {ours, theirs} talents
//
// myTalents (optional, {cardId: [levels]}): the talent levels my side may use per card (the unlocked ones); default every level.

export function prepareDeck(model, d, myTalents = null) {
  const ci = model.idx(d.cards);
  const options = myTalents ? d.cards.map((c) => (myTalents[c] && myTalents[c].length ? myTalents[c] : null)) : null;
  return { cards: d.cards.slice(), ci, options, orderIdx: d.order ? model.idx(d.order) : null, weight: d.weight, name: d.name || null };
}

export function normaliseField(model, field) {
  const out = [];
  let total = 0;
  for (const f of field) {
    if (!f.cards || f.cards.length !== 4 || !f.cards.every((c) => model.has(c))) continue;
    const w = f.weight === undefined ? 1 : +f.weight;
    if (!(w > 0)) continue;
    const p = prepareDeck(model, { cards: f.cards, name: f.name });
    p.weight = w;
    p.key = [...p.ci].sort((a, b) => a - b).join('|');
    out.push(p);
    total += w;
  }
  for (const p of out) p.weight /= total;
  return out;
}

export function respondPrepared(model, A, B) {
  return model.respondIdx(A.ci, B.ci, A.options, B.options, A.orderIdx, B.orderIdx);
}

export function fieldMatrix(model, A, B) {
  const P = [];
  const T = [];
  for (const a of A) {
    const row = [];
    const trow = [];
    for (const b of B) {
      const r = respondPrepared(model, a, b);
      row.push(r.p);
      trow.push({ ours: r.ours, theirs: r.theirs });
    }
    P.push(row);
    T.push(trow);
  }
  return { P, T };
}

// The field-weighted response-aware win chance of a deck, and its talents most often chosen against the field (weighted).
export function fieldWin(model, deck, field) {
  let s = 0;
  const votes = [new Map(), new Map(), new Map(), new Map()];
  for (const o of field) {
    const r = respondPrepared(model, deck, o);
    s += o.weight * r.p;
    r.ours.forEach((t, q) => votes[q].set(t, (votes[q].get(t) || 0) + o.weight));
  }
  const talents = votes.map((m) => [...m.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0][0]);
  return { win: s, talents };
}

// Every 4-subset of the allowed cards, by a bound: its field-weighted mean logit with each card at its best level against the field
// (opposing cards at their best level on their own; the AoE board and the known-deck residuals left out); the best `approx` are
// re-scored exactly; returns the best `keep`, best first.
export function candidatePool(model, { cards = null, field, keep = 200, approx = 3000, myTalents = null } = {}) {
  const C = model.C;
  const allowed = cards ? cards.filter((c) => model.has(c)).map((c) => model.index.get(c)) : [...Array(C).keys()];
  const uniq = [...new Set(allowed)].sort((a, b) => a - b);
  const a = new Float64Array(C);
  const oppLevel = (j) => {
    const t = model.bestLevel(j);
    return t === null ? 0 : t;
  };
  for (const i of uniq) {
    const opts = myTalents && myTalents[model.ids[i]] && myTalents[model.ids[i]].length ? myTalents[model.ids[i]] : model.legal[i];
    let best = -Infinity;
    for (const t of opts) {
      let v = model.tokenValue(i, t);
      for (const o of field) {
        let x = 0;
        for (let j = 0; j < 4; j++) x += model.pairCross(i, t, o.ci[j], oppLevel(o.ci[j]));
        v += o.weight * x;
      }
      if (v > best) best = v;
    }
    a[i] = best;
  }
  const cs = uniq;
  const n = cs.length;
  const heap = new MinHeap(approx);
  const syn = model.syn;
  for (let i = 0; i < n; i++) {
    const ci = cs[i];
    const si = a[ci];
    for (let j = i + 1; j < n; j++) {
      const cj = cs[j];
      const sj = si + a[cj] + syn[ci * C + cj];
      for (let k = j + 1; k < n; k++) {
        const ck = cs[k];
        const sk = sj + a[ck] + syn[ci * C + ck] + syn[cj * C + ck];
        for (let l = k + 1; l < n; l++) {
          const cl = cs[l];
          const s = sk + a[cl] + syn[ci * C + cl] + syn[cj * C + cl] + syn[ck * C + cl];
          if (s > heap.min()) heap.push(s, [ci, cj, ck, cl]);
        }
      }
    }
  }
  const out = [];
  for (const { item } of heap.items()) {
    const p = prepareDeck(model, { cards: item.map((i) => model.ids[i]) }, myTalents);
    p.cardIdx = item;
    const fw = fieldWin(model, p, field);
    p.fieldWin = fw.win;
    p.talents = fw.talents;
    out.push(p);
  }
  out.sort((x, y) => y.fieldWin - x.fieldWin);
  return out.slice(0, keep);
}

// In-game tournament advice. request: {mode: 'fearless' | 'draft', available?: [ids] (default every card), myBanned?: [ids]
// (fearless: the cards I already played), oppBanned?: [ids] (fearless: the opponent's played cards), myTalents?, field: [...],
// top?: 10, minFieldWeight?: 0.2}. The opponent's likely decks are the field decks holding none of their banned cards; when those
// keep less than minFieldWeight of the field, the model's best decks from the opponent's remaining cards (against the full field)
// fill the rest.
export function ingameAdvice(model, req) {
  const t0 = now();
  const all = model.ids;
  const myBanned = new Set(req.mode === 'fearless' ? req.myBanned || [] : []);
  const oppBanned = new Set(req.mode === 'fearless' ? req.oppBanned || [] : []);
  const available = (req.available || all).filter((c) => !myBanned.has(c) && model.has(c));
  const field = normaliseField(model, req.field || []);
  if (!field.length) throw new Error('ingameAdvice needs a field');
  let likely = field.filter((d) => !d.cards.some((c) => oppBanned.has(c)));
  const kept = likely.reduce((s, d) => s + d.weight, 0);
  const minW = req.minFieldWeight === undefined ? 0.2 : req.minFieldWeight;
  let filled = 0;
  if (kept < minW) {
    const oppCards = all.filter((c) => !oppBanned.has(c));
    const extra = candidatePool(model, { cards: oppCards, field, keep: 10, approx: 1500 });
    const share = (minW - kept) / extra.length;
    for (const d of extra) {
      d.weight = share;
      d.key = [...d.ci].sort((x, y) => x - y).join('|');
      d.synthetic = true;
      likely.push(d);
    }
    filled = extra.length;
  }
  const total = likely.reduce((s, d) => s + d.weight, 0);
  likely = likely.map((d) => Object.assign(d, { weight: d.weight / total }));
  const pool = candidatePool(model, { cards: available, field: likely, keep: req.top || 10, approx: req.approx || 3000, myTalents: req.myTalents || null });
  const best = pool[0];
  const names = (cards) => cards.map((id) => model.cards[model.index.get(id)].fr);
  return {
    mode: req.mode,
    available: available.length,
    oppField: { decks: likely.length, keptWeight: kept, synthetic: filled },
    decks: pool.map((d) => ({ cards: d.cards, names: names(d.cards), win: d.fieldWin, talents: d.talents,
      order: model.boardIdx(d.ci, d.talents, null).board, full_games: model.fullGames(d.ci),
      talents_model_only: d.ci.map((i, q) => model.modelOnly([i], [d.talents[q]])), variant_full_games: model.variantGames(d.ci, d.talents) })),
    bestVsField: best ? likely.map((o) => {
      const r = respondPrepared(model, best, o);
      return Object.assign({ cards: o.cards, names: names(o.cards), weight: o.weight, synthetic: !!o.synthetic, win: r.p,
        our_talents: r.ours, their_best_response: r.theirs, model_only: model.modelOnly(best.ci, r.ours) || model.modelOnly(o.ci, r.theirs) },
        model.talentFields(best.ci, r.ours, 'our_talents'), model.talentFields(o.ci, r.theirs, 'their_best_response'));
    }).sort((x, y) => y.weight - x.weight) : [],
    ms: now() - t0,
  };
}

// Card-disjoint opponent trios by meta weight: deck 1 ~ weight, deck 2 ~ weight among decks disjoint from 1, deck 3 likewise.
export function sampleTrios(model, field, n = 96, seed = 126) {
  const rnd = mulberry32(seed);
  const out = [];
  for (let s = 0; s < n * 4 && out.length < n; s++) {
    const picked = [];
    for (let k = 0; k < 3; k++) {
      const ok = field.filter((d) => picked.every((p) => !d.ci.some((c) => p.ci.includes(c))));
      if (!ok.length) break;
      const tot = ok.reduce((x, d) => x + d.weight, 0);
      let r = rnd() * tot;
      let pick = ok[ok.length - 1];
      for (const d of ok) { r -= d.weight; if (r <= 0) { pick = d; break; } }
      picked.push(pick);
    }
    if (picked.length === 3) out.push({ decks: picked, weight: 1 });
  }
  for (const t of out) t.weight = 1 / out.length;
  return out;
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class MinHeap {
  constructor(cap) {
    this.cap = cap;
    this.v = [];
    this.it = [];
  }
  min() {
    return this.v.length < this.cap ? -Infinity : this.v[0];
  }
  push(val, item) {
    const v = this.v;
    const it = this.it;
    if (v.length < this.cap) {
      v.push(val);
      it.push(item);
      let i = v.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (v[p] <= v[i]) break;
        [v[p], v[i]] = [v[i], v[p]];
        [it[p], it[i]] = [it[i], it[p]];
        i = p;
      }
      return;
    }
    v[0] = val;
    it[0] = item;
    let i = 0;
    const n = v.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && v[l] < v[m]) m = l;
      if (r < n && v[r] < v[m]) m = r;
      if (m === i) break;
      [v[m], v[i]] = [v[i], v[m]];
      [it[m], it[i]] = [it[i], it[m]];
      i = m;
    }
  }
  items() {
    return this.v.map((val, i) => ({ val, item: this.it[i] }));
  }
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
