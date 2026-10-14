// Codex tab: every released card as a game card, with search, filters, sort and the Owned toggle on every card.
// A language change rebuilds the tab from the same state (search, filters, sort, open panels).

import { h, icon, norm, fmtInt, debounce } from "./util.js";
import { DB, dumpDay } from "./data.js";
import { on, isOwned, ownedCount, ownedKeys, addMany, replaceOwned, getLang, canPersist } from "./store.js";
import { keepLine, paintNoStore, inAppNotice } from "./keep.js";
import { gameCard, ownToggle, setOwnedView, cardName, ELEMENTS, RARITIES, elName, raName, unsize } from "./cards.js";
import { disclosure, flip, segmented, filterChip, setChip } from "./ui.js";
import { toast, openCollection } from "./dialogs.js";
import { t, STRINGS } from "./i18n.js";

// ---- traits, derived from the English texts and numbers of the data (no hand-made tags); names are "trait.<id>"
const anyText = (c, rx) => c.abilities.some((a) => rx.test(a.description_en)) || c.passives.some((p) => rx.test(p.description_en));
const TRAITS = [
  ["area", (c) => c.abilities.some((a) => /damage/i.test(a.description_en) && /to all enemy cards|\bAOE\b/i.test(a.description_en))],
  ["heal", (c) => anyText(c, /\b(heals?|healing|recovers|regenerates)\b/i)],
  ["crit", (c) => c.abilities.some((a) => a.crit_chance >= 20) || anyText(c, /critical/i)],
  ["taunt", (c) => anyText(c, /taunt/i)],
  ["freeze", (c) => anyText(c, /\b(freez\w*|frozen)\b/i)],
  ["protect", (c) => anyText(c, /\b(immune|immunity|absorbs?|reflects?)\b|resistances?\b/i)],
  ["revive", (c) => anyText(c, /\b(revives?|resurrect\w*)\b/i)],
  ["random", (c) => anyText(c, /random/i)],
  ["echo", (c) => c.abilities.some((a) => a.echo_chance) || anyText(c, /\becho\b/i)],
];

const S = { q: "", els: new Set(), ras: new Set(), traits: new Set(), own: "all", sort: "order", filtersOpen: false, traitsOpen: false };

const SORTS = {
  order: ["cx.sOrder", (a, b) => a.order - b.order],
  name: ["cx.sName", (a, b) => cardName(a).localeCompare(cardName(b), getLang())],
  rarity: ["cx.sRarity", (a, b) => rarityRank(b) - rarityRank(a) || a.order - b.order],
  hp: ["cx.sHp", (a, b) => b.hp - a.hp || a.order - b.order],
  gold: ["cx.sGold", (a, b) => b.gold_income - a.gold_income || a.order - b.order],
};
const rarityRank = (c) => RARITIES.indexOf(c.rarity);

let root, grid, cells = [], traitList = [], ui = {};

// element and rarity words of both languages, so "feu" and "fire" both find the fire cards
const both = (key) => [STRINGS.en[key], STRINGS.fr[key]];
function haystack(c) {
  const parts = [c.name_fr, c.name_en, ...both("el." + c.element), c.element, ...both("ra." + c.rarity)];
  for (const a of c.abilities) parts.push(a.name_fr, a.name_en, a.description_fr, a.description_en, a.element);
  for (const p of c.passives) parts.push(p.name_fr, p.name_en, p.description_fr, p.description_en);
  for (const tl of c.talents) parts.push(tl.name_fr, tl.name_en, tl.description_fr, tl.description_en);
  return norm(parts.filter(Boolean).join("\n"));
}

function terms() {
  const out = [];
  norm(S.q).replace(/"([^"]+)"|(\S+)/g, (_, phrase, word) => { const w = (phrase || word).trim(); if (w) out.push(w); });
  return out;
}

// ---- the filter predicate, with one facet left out so each chip can show "how many would I get"
function passes(x, ts, skip) {
  const c = x.c;
  if (skip !== "el" && S.els.size && !S.els.has(c.element)) return false;
  if (skip !== "ra" && S.ras.size && !S.ras.has(c.rarity)) return false;
  if (skip !== "own") {
    if (S.own === "owned" && !isOwned(c.key)) return false;
    if (S.own === "missing" && isOwned(c.key)) return false;
  }
  if (skip !== "trait") for (const tr of S.traits) if (!x.traits.has(tr)) return false;
  return ts.every((w) => x.hay.includes(w));
}

// ---- highlighting the matching effect under a card while a search is active
function snippet(x, ts) {
  const c = x.c;
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
    if (best) return h("p.snip", { lang }, [h("b", mark(best[0], ts)), " ", mark(best[1].replace(/\n/g, " "), ts, 110)]);
  }
  return null;
}

function mark(text, ts, max) {
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
  const out = [start ? "…" : ""];
  for (let i = start; i < end;) {
    let j = i;
    while (j < end && on_[j] === on_[i]) j++;
    const seg = text.slice(i, j);
    out.push(on_[i] ? h("mark", seg) : seg);
    i = j;
  }
  if (end < text.length) out.push("…");
  return out;
}

// ---- build
function buildCells() {
  cells.forEach((x) => unsize(x.el));
  cells = DB.cards.map((c) => {
    const tg = ownToggle(c);
    const cap = h("div.cap", { hidden: true });
    const el = h("div.cell", { "data-key": c.key }, [h("div.cw", [gameCard(c, { size: "full" }), tg]), cap]);
    return { c, el, tg, cap, hay: hayOf(c), traits: new Set(TRAITS.filter(([, test]) => test(c)).map(([id]) => id)) };
  });
}
const hayCache = new Map();
function hayOf(c) { if (!hayCache.has(c.key)) hayCache.set(c.key, haystack(c)); return hayCache.get(c.key); }

export function mount(el) {
  root = el;
  build();
  on("owned", (d) => syncOwned(d.keys));
  on("lang", () => {
    S.filtersOpen = ui.fbtn.getAttribute("aria-expanded") === "true";
    S.traitsOpen = !!ui.traitsBtn && ui.traitsBtn.getAttribute("aria-expanded") === "true";
    build();
  });
}

function build() {
  buildCells();
  traitList = TRAITS.filter(([id]) => cells.filter((x) => x.traits.has(id)).length >= 3).map(([id]) => id);
  ui = {};

  // collection bar: the visible link between Owned and My decks
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

  // toolbar
  ui.q = h("input#cx-q", { type: "search", autocomplete: "off", spellcheck: "false", enterkeyhint: "search", name: "q",
    placeholder: t("cx.searchPh"), "aria-label": t("cx.searchAria") });
  ui.q.value = S.q;
  ui.clear = h("button.field-clear", { type: "button", "aria-label": t("cx.clearSearch"), title: t("cx.clearSearch"), hidden: true, onclick: () => { ui.q.value = ""; S.q = ""; apply(); ui.q.focus(); } }, icon("close"));
  ui.q.addEventListener("input", debounce(() => { S.q = ui.q.value; apply(); }, 90));
  const search = h("div.field.search", [icon("search"), ui.q, ui.clear]);

  ui.sort = h("select#cx-sort", { "aria-label": t("cx.sortAria"), onchange: () => { S.sort = ui.sort.value; apply(); } },
    Object.entries(SORTS).map(([k, v]) => h("option", { value: k }, t(v[0]))));
  ui.sort.value = S.sort;
  const sortField = h("label.field.select", [h("span.sr", t("ct.sortBy")), ui.sort, icon("chevron")]);

  ui.fbtn = h("button.btn.ghost.fbtn", { type: "button", "aria-controls": "cx-filters" }, [icon("filters"), t("cx.filters"), h("span.fcount")]);

  ui.elChips = ELEMENTS.map((id) => Object.assign(filterChip(elName(id), "sp-el-" + id, () => { toggle(S.els, id); apply(); }), { id, label: elName(id) }));
  ui.raChips = RARITIES.map((id) => Object.assign(filterChip(raName(id), "sp-gem-" + id, () => { toggle(S.ras, id); apply(); }), { id, label: raName(id) }));
  ui.trChips = traitList.map((id) => Object.assign(filterChip(t("trait." + id), "", () => { toggle(S.traits, id); apply(); }), { id, hint: t("trait." + id + ".tip") }));

  ui.ownSeg = segmented([["all", t("cx.all")], ["owned", t("cx.owned")], ["missing", t("cx.missing")]], S.own, (v) => { S.own = v; apply(); }, t("cx.ownAria"));
  ui.traitsBtn = traitList.length ? h("button.btn.ghost", { type: "button", "aria-controls": "cx-traits" }, [h("span", t("cx.traits")), h("span.fcount.tcount"), icon("chevron")]) : null;
  const traitsRegion = traitList.length ? h("div#cx-traits", h("div.collapse-in", h("div.chips", { role: "group", "aria-label": t("cx.traitsAria") }, ui.trChips.map((c) => c.el)))) : null;
  if (traitsRegion) disclosure(ui.traitsBtn, traitsRegion, { open: S.traitsOpen });

  const filters = h("div#cx-filters.tb-filters.collapse", h("div.collapse-in", [
    h("div.tb-row.chips", { role: "group", "aria-label": t("card.element") }, ui.elChips.map((c) => c.el)),
    h("div.tb-row.chips", { role: "group", "aria-label": t("card.rarity") }, ui.raChips.map((c) => c.el)),
    h("div.tb-row.tb-own", [ui.ownSeg.el, ui.traitsBtn]),
    traitsRegion,
  ]));
  disclosure(ui.fbtn, filters, { open: S.filtersOpen });

  ui.result = h("p.result", { "aria-live": "polite" });
  ui.markAll = h("button.btn.soft", { type: "button", onclick: markShown }, [icon("check"), t("cx.markAll")]);
  ui.clearAll = h("button.btn.ghost", { type: "button", onclick: clearAll }, t("cx.clearAll"));
  const bar = h("div.tb-result", [ui.result, h("div.tb-bulk", [ui.markAll, ui.clearAll])]);

  grid = h("div.grid#cx-grid");
  ui.empty = h("div.empty", { hidden: true }, [
    h("h2", t("cx.emptyH")),
    h("p", t("cx.emptyP")),
    h("button.btn.primary", { type: "button", onclick: reset }, t("cx.reset")),
  ]);

  // where the card values come from, while some of them predate the current patch (cards.json `data_notice`)
  const notice = DB.dataNotice ? t("notice." + DB.dataNotice, { date: dumpDay(), patch: DB.patch }) : null;
  root.replaceChildren(...[
    h("div.vhead", [
      h("h1", t("cx.h1")),
      h("p.lede", t("cx.lede", { n: DB.cards.length, patch: DB.patch })),
    ]),
    inAppNotice(),
    cbar,
    h("div.tb-top", [search, sortField, ui.fbtn]), filters, bar,
    grid, ui.empty,
    notice ? h("p.note.cx-foot", [icon("info"), h("span", notice)]) : null,
  ].filter(Boolean));
  apply(true);
  syncOwned([]);
}

function toggle(set, v) { set.has(v) ? set.delete(v) : set.add(v); }

function reset() {
  S.q = ""; S.els.clear(); S.ras.clear(); S.traits.clear(); S.own = "all";
  ui.q.value = ""; ui.ownSeg.set("all");
  apply();
}

function apply(first) {
  const ts = terms();
  const shown = cells.filter((x) => passes(x, ts)).sort((a, b) => SORTS[S.sort][1](a.c, b.c));
  const order = shown.map((x) => x.el);
  for (const x of cells) {
    if (ts.length) {
      const s = snippet(x, ts);
      x.cap.replaceChildren(...(s ? [s] : []));
      x.cap.hidden = !s;
    } else x.cap.hidden = true;
  }
  const cur = grid.children;
  const same = cur.length === order.length && order.every((el, i) => cur[i] === el);
  const mutate = () => grid.replaceChildren(...order);
  if (!same) { if (first) mutate(); else flip(grid, mutate); }
  ui.empty.hidden = shown.length > 0;
  ui.clear.hidden = !S.q;
  ui.result.textContent = shown.length === cells.length ? t("cx.result", { n: shown.length }) : t("cx.resultOf", { n: shown.length, total: cells.length });
  ui.markAll.disabled = !shown.some((x) => !isOwned(x.c.key));
  ui.markAll.title = !shown.length ? t("cx.markNone") : ui.markAll.disabled ? t("cx.markDone") : t("cx.markN", { n: shown.filter((x) => !isOwned(x.c.key)).length });
  // live counts on the chips (each facet counts with the other facets applied)
  for (const c of ui.elChips) setChip(c, cells.filter((x) => x.c.element === c.id && passes(x, ts, "el")).length, S.els.has(c.id), t("filter.show", { label: c.label }), t("filter.none"));
  for (const c of ui.raChips) setChip(c, cells.filter((x) => x.c.rarity === c.id && passes(x, ts, "ra")).length, S.ras.has(c.id), t("filter.show", { label: c.label }), t("filter.none"));
  for (const c of ui.trChips) setChip(c, cells.filter((x) => x.traits.has(c.id) && passes(x, ts, "trait")).length, S.traits.has(c.id), c.hint, t("filter.none"));
  const nf = S.els.size + S.ras.size + S.traits.size + (S.own !== "all" ? 1 : 0);
  ui.fbtn.querySelector(".fcount").textContent = nf ? ` (${nf})` : "";
  const tc = ui.traitsBtn && ui.traitsBtn.querySelector(".tcount");
  if (tc) tc.textContent = S.traits.size ? ` (${S.traits.size})` : "";
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
  ui.go.hidden = n === 0;
  // the "Saved in this browser only" line takes the hint's place once a card is owned (the same row, so nothing jumps);
  // without storage the full-width warning says it instead
  const saved = n > 0 && canPersist();
  ui.hint.textContent = t(n ? "cx.hintSome" : "cx.hintNone");
  ui.hint.hidden = saved;
  ui.saved.el.hidden = !saved;
  ui.saved.paint();
  paintNoStore(ui.store);
  ui.clearAll.disabled = n === 0;
  ui.clearAll.title = t(n ? "cx.clearOn" : "cx.clearOff");
  apply(S.own === "all");
}

function markShown() {
  const ts = terms();
  const todo = cells.filter((x) => passes(x, ts) && !isOwned(x.c.key)).map((x) => x.c.key);
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
