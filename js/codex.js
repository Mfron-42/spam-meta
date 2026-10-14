// Codex tab: every released card as a game card, with search, filters, sort and the Owned toggle on every card.

import { h, $, icon, norm, plural, fmtInt, debounce } from "./util.js";
import { DB } from "./data.js";
import { on, isOwned, ownedCount, ownedKeys, addMany, replaceOwned, getLang, canPersist } from "./store.js";
import { gameCard, ownToggle, setOwnedView, cardName, L, ELEMENTS, ELEMENT_NAME, RARITIES, RARITY_NAME, unsize } from "./cards.js";
import { disclosure, flip, segmented, filterChip, setChip } from "./ui.js";
import { toast, openCollection } from "./dialogs.js";

// ---- traits, derived from the English texts and numbers of the data (no hand-made tags)
const anyText = (c, rx) => c.abilities.some((a) => rx.test(a.description_en)) || c.passives.some((p) => rx.test(p.description_en));
const TRAITS = [
  ["area", "Hits all enemies", "Deals damage to all enemy cards", (c) => c.abilities.some((a) => /damage/i.test(a.description_en) && /to all enemy cards|\bAOE\b/i.test(a.description_en))],
  ["heal", "Heals", "Heals itself or allies", (c) => anyText(c, /\b(heals?|healing|recovers|regenerates)\b/i)],
  ["crit", "Critical hits", "Mentions critical hits, or has an ability with a critical chance of 20% or more", (c) => c.abilities.some((a) => a.crit_chance >= 20) || anyText(c, /critical/i)],
  ["taunt", "Taunt", "Forces enemies to target a card", (c) => anyText(c, /taunt/i)],
  ["freeze", "Freeze", "Freezes cards", (c) => anyText(c, /\b(freez\w*|frozen)\b/i)],
  ["protect", "Protection", "Absorbs, reflects, grants immunity or raises resistances", (c) => anyText(c, /\b(immune|immunity|absorbs?|reflects?)\b|resistances?\b/i)],
  ["revive", "Revive", "Brings a card back", (c) => anyText(c, /\b(revives?|resurrect\w*)\b/i)],
  ["random", "Random targets", "Picks its targets at random", (c) => anyText(c, /random/i)],
  ["echo", "Echo", "Can repeat an ability", (c) => c.abilities.some((a) => a.echo_chance) || anyText(c, /\becho\b/i)],
];

const S = { q: "", els: new Set(), ras: new Set(), traits: new Set(), own: "all", sort: "order" };

const SORTS = {
  order: ["Game order", (a, b) => a.order - b.order],
  name: ["Name", (a, b) => cardName(a).localeCompare(cardName(b), getLang())],
  rarity: ["Rarity", (a, b) => rarityRank(b) - rarityRank(a) || a.order - b.order],
  hp: ["Health, high to low", (a, b) => b.hp - a.hp || a.order - b.order],
  gold: ["Gold per turn", (a, b) => b.gold_income - a.gold_income || a.order - b.order],
};
const rarityRank = (c) => RARITIES.findIndex((r) => r[0] === c.rarity);

let root, grid, cells = [], traitList = [], ui = {};

function haystack(c) {
  const parts = [c.name_fr, c.name_en, ELEMENT_NAME[c.element], c.element, RARITY_NAME[c.rarity]];
  for (const a of c.abilities) parts.push(a.name_fr, a.name_en, a.description_fr, a.description_en, a.element);
  for (const p of c.passives) parts.push(p.name_fr, p.name_en, p.description_fr, p.description_en);
  for (const t of c.talents) parts.push(t.name_fr, t.name_en, t.description_fr, t.description_en);
  return norm(parts.filter(Boolean).join("\n"));
}

function terms() {
  const out = [];
  norm(S.q).replace(/"([^"]+)"|(\S+)/g, (_, phrase, word) => { const t = (phrase || word).trim(); if (t) out.push(t); });
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
  if (skip !== "trait") for (const t of S.traits) if (!x.traits.has(t)) return false;
  return ts.every((t) => x.hay.includes(t));
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
      ...c.talents.map((t) => [f(t, "name"), f(t, "description")]),
    ];
    let best = null, bestN = 0;
    for (const it of items) {
      const hay = norm(it[0] + "\n" + it[1]);
      const n = ts.filter((t) => hay.includes(t)).length;
      if (n > bestN) { best = it; bestN = n; }
    }
    if (best) return h("p.snip", { lang }, [h("b", mark(best[0], ts)), " ", mark(best[1].replace(/\n/g, " "), ts, 110)]);
  }
  return null;
}

function mark(text, ts, max) {
  // normalised copy with an index map so an accent-free match can be marked in the original text
  let n = "", map = [];
  for (let i = 0; i < text.length; i++) { const f = norm(text[i]); for (let j = 0; j < f.length; j++) { n += f[j]; map.push(i); } }
  const on_ = new Array(text.length).fill(false);
  for (const t of ts) {
    for (let from = 0, at; (at = n.indexOf(t, from)) !== -1; from = at + t.length) for (let k = at; k < at + t.length; k++) on_[map[k]] = true;
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
    return { c, el, tg, cap, hay: x_hay(c), traits: new Set(TRAITS.filter((t) => t[3](c)).map((t) => t[0])) };
  });
}
const hayCache = new Map();
function x_hay(c) { if (!hayCache.has(c.key)) hayCache.set(c.key, haystack(c)); return hayCache.get(c.key); }

export function mount(el) {
  root = el;
  buildCells();
  traitList = TRAITS.filter((t) => cells.filter((x) => x.traits.has(t[0])).length >= 3);

  // collection bar: the visible link between Owned and My decks
  ui.count = h("span.cb-n");
  ui.total = h("span.cb-t", ` of ${DB.cards.length} owned`);
  ui.fill = h("span.track-fill");
  ui.go = h("a.btn.primary", { href: "#decks", "data-goto": "decks", hidden: true }, [h("span.go-l"), icon("arrow")]);
  ui.hint = h("p.cb-txt");
  ui.store = h("p.note", { hidden: true }, "This browser cannot save your collection, so it lasts until you close the page. Use Export to keep it.");
  const cbar = h("div.cbar.panel", [
    h("div.cb-main", [
      h("div.cb-fig", [h("p.cb-h", [ui.count, ui.total]), h("div.track", { role: "presentation" }, ui.fill)]),
      ui.hint,
    ]),
    h("div.cb-act", [
      ui.go,
      h("button.btn.ghost", { type: "button", onclick: openCollection }, [icon("copy"), "Export or import"]),
    ]),
    ui.store,
  ]);

  // toolbar
  ui.q = h("input#cx-q", { type: "search", autocomplete: "off", spellcheck: "false", enterkeyhint: "search", name: "q",
    placeholder: "Search cards…", "aria-label": "Search cards by name, ability or effect" });
  ui.clear = h("button.field-clear", { type: "button", "aria-label": "Clear the search", title: "Clear the search", hidden: true, onclick: () => { ui.q.value = ""; S.q = ""; apply(); ui.q.focus(); } }, icon("close"));
  ui.q.addEventListener("input", debounce(() => { S.q = ui.q.value; apply(); }, 90));
  const search = h("div.field.search", [icon("search"), ui.q, ui.clear]);

  ui.sort = h("select#cx-sort", { "aria-label": "Sort cards", onchange: () => { S.sort = ui.sort.value; apply(); } },
    Object.entries(SORTS).map(([k, v]) => h("option", { value: k }, v[0])));
  const sortField = h("label.field.select", [h("span.sr", "Sort by"), ui.sort, icon("chevron")]);

  ui.fbtn = h("button.btn.ghost.fbtn", { type: "button", "aria-controls": "cx-filters" }, [icon("filters"), "Filters", h("span.fcount")]);

  ui.elChips = ELEMENTS.map(([id, label]) => { const c = filterChip(label, "sp-el-" + id, () => { toggle(S.els, id); apply(); }); c.id = id; c.label = label; return c; });
  ui.raChips = RARITIES.map(([id, label]) => { const c = filterChip(label, "sp-gem-" + id, () => { toggle(S.ras, id); apply(); }); c.id = id; c.label = label; return c; });
  ui.trChips = traitList.map(([id, label, hint]) => { const c = filterChip(label, "", () => { toggle(S.traits, id); apply(); }); c.id = id; c.label = label; c.hint = hint; return c; });

  ui.ownSeg = segmented([["all", "All"], ["owned", "Owned"], ["missing", "Not owned"]], "all", (v) => { S.own = v; apply(); }, "Show owned cards");
  ui.traitsBtn = h("button.btn.ghost", { type: "button", "aria-controls": "cx-traits" }, [h("span", "Traits"), h("span.fcount.tcount"), icon("chevron")]);
  const traitsRegion = h("div#cx-traits", h("div.collapse-in", h("div.chips", { role: "group", "aria-label": "Ability traits" }, ui.trChips.map((c) => c.el))));
  disclosure(ui.traitsBtn, traitsRegion, { open: false });

  const filters = h("div#cx-filters.tb-filters.collapse", h("div.collapse-in", [
    h("div.tb-row.chips", { role: "group", "aria-label": "Element" }, ui.elChips.map((c) => c.el)),
    h("div.tb-row.chips", { role: "group", "aria-label": "Rarity" }, ui.raChips.map((c) => c.el)),
    h("div.tb-row.tb-own", [ui.ownSeg.el, traitList.length ? ui.traitsBtn : null]),
    traitList.length ? traitsRegion : null,
  ]));
  disclosure(ui.fbtn, filters, { open: false });

  ui.result = h("p.result", { "aria-live": "polite" });
  ui.markAll = h("button.btn.soft", { type: "button", onclick: markShown }, [icon("check"), "Mark shown as owned"]);
  ui.clearAll = h("button.btn.ghost", { type: "button", onclick: clearAll }, "Clear collection");
  const bar = h("div.tb-result", [ui.result, h("div.tb-bulk", [ui.markAll, ui.clearAll])]);

  grid = h("div.grid#cx-grid");
  ui.empty = h("div.empty", { hidden: true }, [
    h("h2", "No card matches"),
    h("p", "Try a single word, with or without accents, or remove a filter."),
    h("button.btn.primary", { type: "button", onclick: reset }, "Reset search and filters"),
  ]);

  root.replaceChildren(
    h("div.vhead", [
      h("h1", "Codex"),
      h("p.lede", `All ${DB.cards.length} cards of patch ${DB.patch}, drawn like in the game. Press a card for everything it does.`),
    ]),
    cbar,
    h("div.tb-top", [search, sortField, ui.fbtn]), filters, bar,
    grid, ui.empty,
    // where the card values come from, while some of them predate the current patch (cards.json `data_notice`)
    DB.dataNotice ? h("p.note.cx-foot", [icon("info"), h("span", DB.dataNotice)]) : null,
  );

  on("owned", (d) => syncOwned(d.keys));
  on("lang", () => rebuild());
  apply(true);
  syncOwned([]);
}

function toggle(set, v) { set.has(v) ? set.delete(v) : set.add(v); }

function reset() {
  S.q = ""; S.els.clear(); S.ras.clear(); S.traits.clear(); S.own = "all";
  ui.q.value = ""; ui.ownSeg.set("all");
  apply();
}

function rebuild() {
  if (!root) return;
  ui.sort.querySelectorAll("option").forEach((o) => { o.textContent = SORTS[o.value][0]; });
  buildCells();
  apply(true);
  syncOwned([]);
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
  ui.result.textContent = shown.length === cells.length ? `${plural(shown.length, "card")}` : `${shown.length} of ${cells.length} cards`;
  ui.markAll.disabled = !shown.some((x) => !isOwned(x.c.key));
  ui.markAll.title = !shown.length ? "No card is shown" : ui.markAll.disabled ? "Every card shown is already owned" : `Mark the ${plural(shown.filter((x) => !isOwned(x.c.key)).length, "card")} shown as owned`;
  // live counts on the chips (each facet counts with the other facets applied)
  for (const c of ui.elChips) setChip(c, cells.filter((x) => x.c.element === c.id && passes(x, ts, "el")).length, S.els.has(c.id), `Show ${c.label} cards`, `No ${c.label} card matches the current search`);
  for (const c of ui.raChips) setChip(c, cells.filter((x) => x.c.rarity === c.id && passes(x, ts, "ra")).length, S.ras.has(c.id), `Show ${c.label} cards`, `No ${c.label} card matches the current search`);
  for (const c of ui.trChips) setChip(c, cells.filter((x) => x.traits.has(c.id) && passes(x, ts, "trait")).length, S.traits.has(c.id), c.hint, `No card with this trait matches the current search`);
  const nf = S.els.size + S.ras.size + S.traits.size + (S.own !== "all" ? 1 : 0);
  ui.fbtn.querySelector(".fcount").textContent = nf ? ` (${nf})` : "";
  const tc = ui.traitsBtn.querySelector(".tcount");
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
  ui.total.textContent = ` of ${total} owned`;
  ui.fill.style.transform = `scaleX(${n / total})`;
  ui.go.querySelector(".go-l").textContent = "See the decks you can build";
  ui.go.hidden = n === 0;
  ui.hint.textContent = n ? "My decks builds from these cards." : "Press the round button on each card you own. My decks then finds the best decks you can build.";
  ui.store.hidden = canPersist();
  ui.clearAll.disabled = n === 0;
  ui.clearAll.title = n ? "Remove every card from your collection" : "Your collection is already empty";
  apply(S.own === "all");
}

function markShown() {
  const ts = terms();
  const todo = cells.filter((x) => passes(x, ts) && !isOwned(x.c.key)).map((x) => x.c.key);
  if (!todo.length) return;
  const before = ownedKeys();
  addMany(todo);
  toast(`${plural(todo.length, "card")} marked as owned.`, { label: "Undo", run: () => replaceOwned(before) });
}

function clearAll() {
  const before = ownedKeys();
  if (!before.size) return;
  replaceOwned([]);
  toast(`Collection cleared (${plural(before.size, "card")}).`, { label: "Undo", run: () => replaceOwned(before) });
}
