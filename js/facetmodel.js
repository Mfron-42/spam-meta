// The card search model: what each card offers to every filter group, the matching (any of / all of per group, AND across
// groups), the chip counts, the reasons a card matched, and the filter state as an address query. No DOM: the Codex and the
// Card tier list draw it with facets.js, and tools/check_facets.mjs runs it under node.
//
// Sources (docs/DATA.md "facets.json"): the facet index of tools/export_facets.py (hits, element bonuses, effects, tox,
// targets, each value with the entries that give it) and the card data itself (element, rarity, patch change, and the numbers:
// HP, gold per turn, and per ability its cooldown, hit, critical and echo chances). A reference is [part, index]: "a" an
// ability, "p" a passive, "t" a talent of the card in cards.json; "c" the card itself.

export const SET_GROUPS = ["el", "ra", "hit", "gen", "fx", "tox", "tgt", "pc"];
/** The groups where "all of" means something (a card has one element, one rarity, one patch class). */
export const OP_GROUPS = new Set(["hit", "gen", "fx", "tox", "tgt"]);
/** The groups a talent can feed: "Count talents" off leaves their talent references out. */
export const TALENT_GROUPS = new Set(["gen", "fx", "tox"]);
/** Numeric filters: per card (hp, gold) or per ability (cd, acc, crit, echo), with the step of their slider. */
export const NUMS = [
  { id: "hp", per: "card", step: 50 },
  { id: "gold", per: "card", step: 1 },
  { id: "cd", per: "ability", step: 1 },
  { id: "acc", per: "ability", step: 5, pct: true },
  { id: "crit", per: "ability", step: 5, pct: true },
  { id: "echo", per: "ability", step: 5, pct: true },
];
const ELEMENTS = ["fire", "water", "earth", "nature", "light", "shadow", "divine"];
const RARITIES = ["common", "rare", "epic", "legendary", "divine"];
const PATCH_CLASSES = ["mechanical", "talent", "text"];

/** The value a number filter reads on a card (per card) or on one ability (per ability). */
function numOf(id, c, a) {
  if (id === "hp") return c.hp;
  if (id === "gold") return c.gold_income;
  if (id === "cd") return a.cooldown ?? 0;
  if (id === "acc") return a.hit_chance ?? 100;
  if (id === "crit") return a.crit_chance ?? 0;
  if (id === "echo") return a.echo_chance ?? 0;
  return null;
}

/**
 * The index of every card: {key: {c, sets: {group: Map(value -> refs)}, nums: {id: [[value, ref]]}}}, and the vocabulary:
 * {group: [values in display order]}, {num id: [min, max]}. `facets` is facets.json (null when it failed: the card's own
 * groups still work).
 */
export function buildIndex(cards, facets) {
  const out = new Map();
  const seen = { el: new Set(), ra: new Set(), pc: new Set() };
  for (const c of cards) {
    const f = (facets && facets.cards[c.key]) || {};
    const sets = {};
    for (const g of ["hit", "gen", "fx", "tox", "tgt"]) sets[g] = new Map(Object.entries(f[g] || {}));
    sets.el = new Map([[c.element, [["c", 0]]]]);
    sets.ra = new Map([[c.rarity, [["c", 0]]]]);
    sets.pc = c.patch_change ? new Map([[c.patch_change.class, [["c", 0]]]]) : new Map();
    seen.el.add(c.element); seen.ra.add(c.rarity);
    if (c.patch_change) seen.pc.add(c.patch_change.class);
    const nums = {};
    for (const n of NUMS) {
      nums[n.id] = n.per === "card" ? [[numOf(n.id, c), ["c", 0]]]
        : c.abilities.map((a, i) => [numOf(n.id, c, a), ["a", i]]);
    }
    out.set(c.key, { c, sets, nums });
  }
  const values = {
    el: ELEMENTS.filter((v) => seen.el.has(v)),
    ra: RARITIES.filter((v) => seen.ra.has(v)),
    pc: PATCH_CLASSES.filter((v) => seen.pc.has(v)),
    hit: (facets && facets.values.hit) || [],
    gen: (facets && facets.values.gen) || [],
    fx: (facets && facets.values.fx) || [],
    tox: ((facets && facets.values.tox) || []).map((x) => x.id),
    tgt: (facets && facets.values.tgt) || [],
  };
  const ranges = {};
  for (const n of NUMS) {
    const all = [...out.values()].flatMap((x) => x.nums[n.id].map(([v]) => v)).filter((v) => typeof v === "number");
    let lo = Math.min(...all), hi = Math.max(...all);
    if (n.pct) { lo = Math.floor(lo / n.step) * n.step; hi = Math.ceil(hi / n.step) * n.step; }
    else if (n.step > 1) { lo = Math.floor(lo / n.step) * n.step; hi = Math.ceil(hi / n.step) * n.step; }
    ranges[n.id] = [lo, hi];
  }
  const tox = new Map(((facets && facets.values.tox) || []).map((x) => [x.id, x]));
  return { cards: out, values, ranges, tox };
}

/** A fresh filter state. */
export function emptyState() {
  const sel = {}, op = {};
  for (const g of SET_GROUPS) { sel[g] = []; op[g] = "any"; }
  return { q: "", sel, op, num: {}, tal: true, own: "all" };
}

/** True when nothing filters (the text search aside). */
export const noFilter = (S) => SET_GROUPS.every((g) => !S.sel[g].length) && !Object.keys(S.num).length && S.own === "all";

/** How many filters are on (each value, each range, the collection filter, talents off when a talent group is used). */
export const filterCount = (S) => SET_GROUPS.reduce((n, g) => n + S.sel[g].length, 0) + Object.keys(S.num).length + (S.own !== "all" ? 1 : 0);

const usable = (refs, S, g) => (S.tal || !TALENT_GROUPS.has(g) ? refs : refs.filter((r) => r[0] !== "t"));

/** The refs of one value of one group on a card, after the talents switch ([] when the card does not have it). */
export function refsOf(x, g, v, S) {
  const refs = x.sets[g].get(v);
  return refs ? usable(refs, S, g) : [];
}

/** Whether a card passes one set group with the given selection and operator. */
function passSet(x, g, sel, op, S) {
  if (!sel.length) return true;
  const has = (v) => refsOf(x, g, v, S).length > 0;
  return op === "all" ? sel.every(has) : sel.some(has);
}

/** Whether a card passes one number range: per card its value, per ability any ability's value. */
function passNum(x, id, [lo, hi]) {
  return x.nums[id].some(([v]) => typeof v === "number" && v >= lo && v <= hi);
}

/**
 * Whether a card passes every filter. `skip` leaves one group out (its chips count with the others applied); `owned(key)`
 * answers the collection filter; `text(x)` the text search (true when there is none).
 */
export function passes(x, S, { skip = null, owned = () => false, text = () => true } = {}) {
  for (const g of SET_GROUPS) if (g !== skip && !passSet(x, g, S.sel[g], S.op[g], S)) return false;
  for (const [id, r] of Object.entries(S.num)) if (id !== skip && !passNum(x, id, r)) return false;
  if (skip !== "own") {
    if (S.own === "owned" && !owned(x.c.key)) return false;
    if (S.own === "missing" && owned(x.c.key)) return false;
  }
  return text(x);
}

/**
 * The count a chip shows: the cards that would be shown with this value picked, the other groups as they are. In "any of"
 * that is the cards holding the value; in "all of" the cards holding it and every value already picked.
 */
export function chipCount(xs, S, g, v, opts) {
  const sel = S.op[g] === "all" ? [...new Set([...S.sel[g], v])] : [v];
  let n = 0;
  for (const x of xs) if (passSet(x, g, sel, S.op[g], S) && passes(x, S, { ...opts, skip: g })) n++;
  return n;
}

/**
 * Why a card matched: one line per active group that a card face does not already say (hits, bonuses, effects, tox, targets,
 * patch, the per-ability numbers), {g, values: [the picked values it holds], refs: [the entries behind them, unique]}.
 */
export function reasons(x, S) {
  const out = [];
  for (const g of ["hit", "gen", "fx", "tox", "tgt", "pc"]) {
    const sel = S.sel[g];
    if (!sel.length) continue;
    const vals = sel.filter((v) => refsOf(x, g, v, S).length);
    if (!vals.length) continue;
    const refs = [];
    for (const v of vals) for (const r of refsOf(x, g, v, S)) if (!refs.some((q) => q[0] === r[0] && q[1] === r[1])) refs.push(r);
    out.push({ g, values: vals, refs: refs.filter((r) => r[0] !== "c") });
  }
  for (const n of NUMS) {
    const r = S.num[n.id];
    if (!r || n.per === "card") continue;
    const hits = x.nums[n.id].filter(([v]) => typeof v === "number" && v >= r[0] && v <= r[1]);
    if (hits.length) out.push({ g: "num", id: n.id, values: hits.map(([v]) => v), refs: hits.map(([, ref]) => ref) });
  }
  return out;
}

/**
 * When nothing matches: the nearest searches that would show cards, nearest first (at most `max`): one group or range left out
 * ({kind: "drop", g, n}: g a set group, a number id, "own" or "q" for the text), or an "all of" group read as "any of"
 * ({kind: "or", g, n}). `opts` is passes()'s, with `text` the search (q is dropped by passing a text that always matches).
 */
export function relaxations(xs, S, opts, max = 3) {
  const out = [];
  const count = (T, o = opts) => xs.filter((x) => passes(x, T, o)).length;
  const copy = () => ({ ...S, sel: { ...S.sel }, op: { ...S.op }, num: { ...S.num } });
  for (const g of SET_GROUPS) {
    if (!S.sel[g].length) continue;
    const T = copy(); T.sel[g] = [];
    out.push({ kind: "drop", g, n: count(T) });
    if (S.op[g] === "all" && S.sel[g].length > 1) { const U = copy(); U.op[g] = "any"; out.push({ kind: "or", g, n: count(U) }); }
  }
  for (const id of Object.keys(S.num)) { const T = copy(); delete T.num[id]; out.push({ kind: "drop", g: id, n: count(T) }); }
  if (S.own !== "all") { const T = copy(); T.own = "all"; out.push({ kind: "drop", g: "own", n: count(T) }); }
  if (S.q.trim()) out.push({ kind: "drop", g: "q", n: count(S, { ...opts, text: () => true }) });
  // the nearest first: the change that lets the fewest cards back in keeps the search closest to what was asked
  return out.filter((r) => r.n > 0).sort((a, b) => a.n - b.n).slice(0, max);
}

// ---- the address: ?hit=shadow+fire (all of), ?fx=temporality,reset (any of), ?echo=50- (50 and up), ?hp=400-900, ?tal=0,
// ?own=owned, ?q=words. A "+" reads as a space in a query, so "all of" survives any copy of the link.
const NUM_RX = /^(-?\d+(?:\.\d+)?)?-(-?\d+(?:\.\d+)?)?$/;

/** The filter state an address query holds (unknown values are dropped). */
export function fromQuery(search, index) {
  const S = emptyState();
  const p = new URLSearchParams(search);
  S.q = p.get("q") || "";
  for (const g of SET_GROUPS) {
    const raw = p.get(g);
    if (!raw) continue;
    const all = /\s/.test(raw.trim());
    const vals = raw.split(/[\s,]+/).filter((v) => index.values[g].includes(v));
    S.sel[g] = [...new Set(vals)];
    if (all && OP_GROUPS.has(g)) S.op[g] = "all";
  }
  for (const n of NUMS) {
    const m = NUM_RX.exec(p.get(n.id) || "");
    if (!m || (m[1] == null && m[2] == null)) continue;
    const [lo0, hi0] = index.ranges[n.id];
    const lo = m[1] != null ? Math.max(lo0, Number(m[1])) : lo0, hi = m[2] != null ? Math.min(hi0, Number(m[2])) : hi0;
    if (lo <= hi && (lo > lo0 || hi < hi0)) S.num[n.id] = [lo, hi];
  }
  if (p.get("tal") === "0") S.tal = false;
  if (["owned", "missing"].includes(p.get("own"))) S.own = p.get("own");
  return S;
}

/** The address query of a filter state ("" when nothing is set), values in the order they were picked. */
export function toQuery(S, index, extra = {}) {
  const parts = [];
  const put = (k, v) => parts.push(`${k}=${v}`);
  if (S.q.trim()) put("q", encodeURIComponent(S.q.trim()).replace(/%20/g, "+"));
  for (const g of SET_GROUPS) {
    if (!S.sel[g].length) continue;
    put(g, S.sel[g].map(encodeURIComponent).join(S.op[g] === "all" && S.sel[g].length > 1 ? "+" : ","));
  }
  for (const n of NUMS) {
    const r = S.num[n.id];
    if (!r) continue;
    const [lo0, hi0] = index.ranges[n.id];
    put(n.id, `${r[0] > lo0 ? r[0] : ""}-${r[1] < hi0 ? r[1] : ""}`);
  }
  if (!S.tal) put("tal", "0");
  if (S.own !== "all") put("own", S.own);
  for (const [k, v] of Object.entries(extra)) if (v) put(k, encodeURIComponent(v));
  return parts.length ? "?" + parts.join("&") : "";
}
