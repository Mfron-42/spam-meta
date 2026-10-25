// Codex tab: every released card as a game card, with the card search (a text field and the filters of facets.js: element,
// rarity, hits, element bonuses, effects, tox, targets, numbers, patch and collection), a sort and the Owned toggle on every
// card. Each card shown under a filter or a search says why it matched. The filters live in the address (facetmodel.js
// toQuery), so a search can be shared. A language change rebuilds the tab from the same state.

import { h, icon, norm, fmtInt } from "./util.js?v=41989ff170";
import { searchField, terms as searchTerms, hasAll, announcer } from "./search.js?v=41989ff170";
import { DB, loadFacets } from "./data.js?v=41989ff170";
import { on, isOwned, ownedCount, ownedKeys, addMany, replaceOwned, getLang, canPersist } from "./store.js?v=41989ff170";
import { keepLine, paintNoStore, inAppNotice } from "./keep.js?v=41989ff170";
import { cardTile, ownToggle, setOwnedView, cardName, RARITIES, unsize } from "./cards.js?v=41989ff170";
import { flip, band } from "./ui.js?v=41989ff170";
import { toast, openCollection } from "./dialogs.js?v=41989ff170";
import { cardText } from "./cardtext.js?v=41989ff170";
import { t, STRINGS } from "./i18n.js?v=41989ff170";
import { GAME_PATCH, DECK_TABLE_SHOWN } from "./patch.js?v=41989ff170";
import { buildIndex, fromQuery, toQuery, passes as facetPasses, noFilter, relaxations, NUMS } from "./facetmodel.js?v=41989ff170";
import { facetFilters, ownAddress, writeAddress, hashTab } from "./facets.js?v=41989ff170";

// the toolbar's filter triggers, in order, and the groups each one opens
const TRIGGERS = [["el", ["el"]], ["ra", ["ra"]], ["hit", ["hit"]], ["gen", ["gen"]], ["fx", ["fx"]], ["tox", ["tox"]], ["tgt", ["tgt"]],
  ["num", ["num"]], ["more", ["pc", "own"]]];

let S = null;                // the filter state (facetmodel.js), read from the address once
let sort = "order";
const NUM_IDS = new Set(NUMS.map((n) => n.id));

const SORTS = {
  order: ["cx.sOrder", (a, b) => a.order - b.order],
  name: ["cx.sName", (a, b) => cardName(a).localeCompare(cardName(b), getLang())],
  rarity: ["cx.sRarity", (a, b) => rarityRank(b) - rarityRank(a) || a.order - b.order],
  hp: ["cx.sHp", (a, b) => b.hp - a.hp || a.order - b.order],
  gold: ["cx.sGold", (a, b) => b.gold_income - a.gold_income || a.order - b.order],
};
const rarityRank = (c) => RARITIES.indexOf(c.rarity);

let root, grid, cells = [], index = null, F = null, ui = {};

// element and rarity words of both languages, so "feu" and "fire" both find the fire cards
const both = (key) => [STRINGS.en[key], STRINGS.fr[key]];
function haystack(c) {
  const parts = [c.name_fr, c.name_en, ...both("el." + c.element), c.element, ...both("ra." + c.rarity)];
  for (const a of c.abilities) parts.push(a.name_fr, a.name_en, a.description_fr, a.description_en, a.element);
  for (const p of c.passives) parts.push(p.name_fr, p.name_en, p.description_fr, p.description_en);
  for (const tl of c.talents) parts.push(tl.name_fr, tl.name_en, tl.description_fr, tl.description_en);
  return norm(parts.filter(Boolean).join("\n"));
}
const hayCache = new Map();
function hayOf(c) { if (!hayCache.has(c.key)) hayCache.set(c.key, haystack(c)); return hayCache.get(c.key); }

const terms = () => searchTerms(S.q);
const opts = (ts = terms()) => ({ owned: isOwned, text: (x) => hasAll(hayOf(x.c), ts) });
const pass = (x, ts) => facetPasses(x, S, opts(ts));

// ---- the matching effect quoted under a card while a search is active
function snippet(c, ts) {
  // the text of the current language first; when the search only matches the other language, quote that one
  for (const lang of [getLang(), getLang() === "fr" ? "en" : "fr"]) {
    const f = (o, k) => o[`${k}_${lang}`] || "";
    const items = [
      ...c.abilities.map((a) => [f(a, "name"), f(a, "description")]),
      ...c.passives.map((p) => [f(p, "name"), f(p, "description")]),
      ...c.talents.map((tl) => [f(tl, "name"), f(tl, "description")]),
    ];
    let best = null, bestN = 0;
    for (const it of items) {
      const hay = norm(it[0] + "\n" + it[1]);
      const n = ts.filter((w) => hay.includes(w)).length;
      if (n > bestN) { best = it; bestN = n; }
    }
    if (best) return h("p.snip", { lang }, [h("b", mark(best[0], ts)), " ", excerpt(best[1].replace(/\n/g, " "), ts, 110)]);
  }
  return null;
}

/** Which characters of `text` the search terms mark (accent-free), and the window of at most `max` characters around the first. */
function markRange(text, ts, max) {
  // normalised copy with an index map so an accent-free match can be marked in the original text
  let n = "";
  const map = [];
  for (let i = 0; i < text.length; i++) { const f = norm(text[i]); for (let j = 0; j < f.length; j++) { n += f[j]; map.push(i); } }
  const on_ = new Array(text.length).fill(false);
  for (const w of ts) {
    for (let from = 0, at; (at = n.indexOf(w, from)) !== -1; from = at + w.length) for (let k = at; k < at + w.length; k++) on_[map[k]] = true;
  }
  let start = 0, end = text.length;
  if (max && text.length > max) {
    const first = on_.indexOf(true);
    start = Math.max(0, (first < 0 ? 0 : first) - 30);
    end = Math.min(text.length, start + max);
  }
  return { on_, start, end };
}

/** A name with the search terms marked. */
function mark(text, ts) {
  const { on_ } = markRange(text, ts);
  const out = [];
  for (let i = 0; i < text.length;) {
    let j = i;
    while (j < text.length && on_[j] === on_[i]) j++;
    out.push(on_[i] ? h("mark", text.slice(i, j)) : text.slice(i, j));
    i = j;
  }
  return out;
}

/** An excerpt of a card text, the search terms marked, drawn by the card-text renderer: element words and keyword chips,
 * without tooltips (the excerpt points at the card, whose dialog explains the keywords). */
function excerpt(text, ts, max) {
  const r = markRange(text, ts, max);
  const { nodes, from, to } = cardText(text, { tips: false, marks: r.on_, from: r.start, to: r.end });
  return [from ? "…" : "", ...nodes, to < text.length ? "…" : ""];
}

// ---- build
function buildCells() {
  cells.forEach((x) => unsize(x.el));
  cells = DB.cards.map((c) => {
    const tg = ownToggle(c);
    const cap = h("div.cap", { hidden: true });
    const el = cardTile(c, { toggle: tg, cap });
    return { ...index.cards.get(c.key), el, tg, cap };
  });
}

export async function mount(el) {
  root = el;
  await loadFacets();
  index = buildIndex(DB.cards, DB.facets);
  // the address's filters are the Codex's only when it opens on the Codex (another tab's would not mean the same)
  const q = hashTab() === "codex" ? location.search : "";
  S = fromQuery(q, index);
  const sp = new URLSearchParams(q).get("sort");
  if (sp && SORTS[sp]) sort = sp;
  // the address holds the Codex's filters and sort while the Codex is shown, so a search can be shared; they come back with it
  ownAddress("codex", () => toQuery(S, index, { sort: sort !== "order" ? sort : "" }));
  build();
  on("owned", (d) => syncOwned(d.keys));
  on("lang", () => { if (F) F.destroy(); build(); });
}

function build() {
  buildCells();
  ui = {};

  // collection bar: the visible link between Owned and My decks (no link while My decks is not shown, patch.js)
  ui.count = h("span.cb-n");
  ui.total = h("span.cb-t");
  ui.fill = h("span.track-fill");
  ui.go = h("a.btn.primary", { href: "#decks", "data-goto": "decks", hidden: true }, [h("span.go-l", t("cx.goDecks")), icon("arrow")]);
  // one line under the count: how to mark cards, then (once a card is owned) where they are kept and the backup button
  ui.hint = h("p.cb-txt");
  ui.saved = keepLine("saved");
  ui.store = keepLine("nostore");
  const cbar = h("div.cbar.panel", [
    h("div.cb-main", [
      h("div.cb-fig", [h("p.cb-h", [ui.count, ui.total]), h("div.track", { role: "presentation" }, ui.fill)]),
      h("div.cb-say", [ui.hint, ui.saved.el]),
    ]),
    h("div.cb-act", [
      ui.go,
      h("button.btn.ghost", { type: "button", onclick: openCollection }, [icon("copy"), t("cx.export")]),
    ]),
    ui.store.el,
  ]);

  // toolbar: the search, the sort and (on a phone) the Filters button; under them the filter triggers (from 760px)
  ui.search = searchField({ id: "cx-q", placeholder: t("cx.searchPh"), label: t("cx.searchAria"), clearLabel: t("cx.clearSearch"), value: S.q,
    onChange: (v) => { S.q = v; apply(); F.refresh(); } });

  ui.sort = h("select#cx-sort", { "aria-label": t("cx.sortAria"), onchange: () => { sort = ui.sort.value; apply(); } },
    Object.entries(SORTS).map(([k, v]) => h("option", { value: k }, t(v[0]))));
  ui.sort.value = sort;
  const sortField = h("label.field.select", [h("span.sr", t("ct.sortBy")), ui.sort, icon("chevron")]);

  ui.result = h("p.result", { tabindex: "-1" });
  ui.voice = announcer();          // the count, spoken once the typing or clicking pauses
  ui.markAll = h("button.btn.soft", { type: "button", onclick: markShown }, [icon("check"), t("cx.markAll")]);
  ui.clearAll = h("button.btn.ghost", { type: "button", onclick: clearAll }, t("cx.clearAll"));

  grid = h("div.grid#cx-grid");
  // nothing matches: the nearest searches that have cards, each one press away (facetmodel.js relaxations), then the reset
  ui.emptyP = h("p", t("cx.emptyP"));
  ui.emptyNearT = h("p", t("fg.near"));
  ui.emptyNear = h("div.empty-act");
  ui.emptyReset = h("button.btn", { type: "button", onclick: reset }, t("cx.reset"));
  ui.empty = h("div.empty", { hidden: true }, [h("h2", t("cx.emptyH")), ui.emptyP, ui.emptyNearT, ui.emptyNear, ui.emptyReset]);

  F = facetFilters({
    id: "cx", index, S, triggers: TRIGGERS, patch: DB.patch,
    items: () => cells, opts: () => opts(), shown: () => ui.shown || 0,
    onChange: () => apply(),
  });

  root.replaceChildren(...[
    h("div.vhead", [
      h("h1", t("cx.h1")),
      h("p.lede", t("cx.lede", { n: DB.cards.length, patch: DB.patch, game: GAME_PATCH.patch })),
    ]),
    inAppNotice(),
    cbar,
    band(h("div.tb-top", [ui.search.el, sortField, F.sheetBtn, F.bar])),
    h("div.tb-result", [h("div.tb-q", [ui.result, F.sentence]), h("div.tb-bulk", [ui.markAll, ui.clearAll]), ui.voice.el]),
    grid, ui.empty,
  ].filter(Boolean));
  apply(true);
  syncOwned([]);
}

function reset() {
  Object.assign(S, fromQuery("", index));
  ui.search.set("");
  apply();
  F.refresh();
}

function apply(first) {
  const ts = terms();
  const shown = cells.filter((x) => pass(x, ts)).sort((a, b) => SORTS[sort][1](a.c, b.c));
  ui.shown = shown.length;
  const order = shown.map((x) => x.el);
  const filtering = !noFilter(S);
  for (const x of cells) {
    const lines = [];
    if (filtering) lines.push(...F.reasonsFor(x));
    if (ts.length) { const s = snippet(x.c, ts); if (s) lines.push(s); }
    x.cap.replaceChildren(...lines);
    x.cap.hidden = !lines.length;
  }
  const cur = grid.children;
  const same = cur.length === order.length && order.every((el, i) => cur[i] === el);
  const mutate = () => grid.replaceChildren(...order);
  if (!same) { if (first) mutate(); else flip(grid, mutate); }
  ui.empty.hidden = shown.length > 0;
  if (!shown.length) paintEmpty();
  const line =shown.length === cells.length ? t("cx.result", { n: shown.length }) : t("cx.resultOf", { n: shown.length, total: cells.length });
  ui.result.textContent = line;
  if (!first) ui.voice.say(line);
  ui.markAll.disabled = !shown.some((x) => !isOwned(x.c.key));
  ui.markAll.title = !shown.length ? t("cx.markNone") : ui.markAll.disabled ? t("cx.markDone") : t("cx.markN", { n: shown.filter((x) => !isOwned(x.c.key)).length });
  writeAddress();
}

/** The empty result: up to three nearest searches with their card counts ("Without Targets: 9 cards", "Hits with “or”: 44
 * cards"), else the plain advice; the reset is the main button only when nothing nearer exists. */
function paintEmpty() {
  const near = relaxations(cells, S, opts());
  const name = (g) => (g === "own" ? t("fg.own") : NUM_IDS.has(g) ? t("fn." + g) : t("fg." + g));
  ui.emptyNear.replaceChildren(...near.map((r) => {
    const cards = t("cx.result", { n: r.n });
    const label = r.kind === "or" ? t("fg.withOr", { group: name(r.g), cards })
      : r.g === "q" ? t("fg.withoutQ", { cards }) : t("fg.without", { group: name(r.g), cards });
    return h("button.btn", { type: "button", onclick: () => relax(r) }, label);
  }));
  ui.emptyNear.hidden = ui.emptyNearT.hidden = !near.length;
  ui.emptyP.hidden = near.length > 0;
  ui.emptyReset.className = near.length ? "btn ghost" : "btn primary";
}

/** One of the nearest searches, taken: the group, range or words left out, or the group read as "any of". */
function relax(r) {
  if (r.kind === "or") S.op[r.g] = "any";
  else if (r.g === "q") { S.q = ""; ui.search.set(""); }
  else if (r.g === "own") S.own = "all";
  else if (NUM_IDS.has(r.g)) delete S.num[r.g];
  else S.sel[r.g] = [];
  apply();
  F.refresh();
  ui.result.focus({ preventScroll: true });
}

function syncOwned(keys) {
  const n = ownedCount(), total = DB.cards.length;
  const all = !keys.length;
  for (const x of cells) {
    if (!all && !keys.includes(x.c.key)) continue;
    const own = isOwned(x.c.key);
    x.el.dataset.owned = own ? "1" : "0";
    setOwnedView(x.tg, x.c, own);
  }
  grid.classList.toggle("has-owned", n > 0);
  ui.count.textContent = fmtInt(n);
  ui.total.textContent = t("cx.ofOwned", { total });
  ui.fill.style.transform = `scaleX(${n / total})`;
  ui.go.hidden = n === 0 || !DECK_TABLE_SHOWN;
  // the "Saved in this browser only" line takes the hint's place once a card is owned (the same row, so nothing jumps);
  // without storage the full-width warning says it instead
  const saved = n > 0 && canPersist();
  ui.hint.textContent = t(n && DECK_TABLE_SHOWN ? "cx.hintSome" : "cx.hintNone");
  ui.hint.hidden = saved;
  ui.saved.el.hidden = !saved;
  ui.saved.paint();
  paintNoStore(ui.store);
  ui.clearAll.disabled = n === 0;
  ui.clearAll.title = t(n ? "cx.clearOn" : "cx.clearOff");
  apply(S.own === "all");
  F.refresh();
}

function markShown() {
  const ts = terms();
  const todo = cells.filter((x) => pass(x, ts) && !isOwned(x.c.key)).map((x) => x.c.key);
  if (!todo.length) return;
  const before = ownedKeys();
  addMany(todo);
  toast(t("cx.marked", { n: todo.length }), { label: t("ui.undo"), run: () => replaceOwned(before) });
}

function clearAll() {
  const before = ownedKeys();
  if (!before.size) return;
  replaceOwned([]);
  toast(t("cx.cleared", { n: before.size }), { label: t("ui.undo"), run: () => replaceOwned(before) });
}
