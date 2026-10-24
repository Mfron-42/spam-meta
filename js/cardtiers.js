// Card tier list tab: every card ranked on two separate measurements of the deck ranking run (competitive decks: the race;
// all tested decks: the first sort), one at a time, as classic tier rows S+ to E plus "Not measured". A toggle switches the
// measurement without moving the page (each row keeps the height the larger of its two lists needs, and the icons slide to
// their new place). A dot on a card says its tier differs on the other measurement beyond noise; the rings (different tier,
// within noise) are off by default and a secondary toggle in the filters shows them (owner's decision, 2026-10-14). Hover,
// focus or tap shows the card's tier and score on both measurements; a click pins its numbers and its presence in the decks
// of the deck ranking, and links to the card dialog. A Details view lists every card in a sortable table. Data:
// data/cardtiers.json (tools/export_cardtiers.py, from the run's deck table); presence is counted here from ranking.json and
// ranking-decks.json, the files the other tabs already read. No counter is shown per card.
// A language change rebuilds the page from the same state (measurement, view, filters, rings, open panels).

import { h, $, $$, icon, fmtInt, pct, pct1, dec, reducedMotion } from "./util.js?v=ba817a7942";
import { searchField, announcer, terms, hasAll, nameHay } from "./search.js?v=ba817a7942";
import { DB, loadCardTiers, loadRanking, loadDecks } from "./data.js?v=ba817a7942";
import { on, getLang } from "./store.js?v=ba817a7942";
import { cardName, otherName, chip, L, ELEMENTS, RARITIES, elName, raName } from "./cards.js?v=ba817a7942";
import { disclosure, filterChip, setChip, cascade, band } from "./ui.js?v=ba817a7942";
import { t, tx, ord } from "./i18n.js?v=ba817a7942";
import { changeOf, glyph, patchTag, patchDetail, oldNumbersNote, introLine, provBanner, suggestedTalent } from "./patch.js?v=ba817a7942";
import { textNodes, hideTip } from "./cardtext.js?v=ba817a7942";

const AXK = { c: "ct.axC", r: "ct.axR" };
const ax = (a) => t(AXK[a]);
const KEY = { c: "competitive", r: "pool" };          // the measurement's key in cardtiers.json
const TC = { "S+": "sp", S: "s", A: "a", B: "b", C: "c", D: "d", E: "e", nm: "nm" };
const LEVEL = { 3: "final", 2: "race", 1: "screen" };  // ranking-decks.json `level`: the furthest stage a deck reached
const level = (l) => (LEVEL[l] ? t("st." + LEVEL[l]).toLocaleLowerCase(getLang()) : String(l));
const AGK = { same: "ct.agSame", noise: "ct.agNoise", apart: "ct.agApart" };
const thumb = (c) => `assets/thumbs/s/${c.key}.webp`;
const other = (a) => (a === "c" ? "r" : "c");
/** A score (a win-rate difference, a fraction) in points to one decimal, signed: "+9.4"; with its unit, "+9.4 pts". */
const pt = (x) => (x > 0.0005 ? "+" : x < -0.0005 ? "−" : "") + dec(Math.abs(x) * 100, 1);
const pts = (x) => t("ct.pts", { v: pt(x) });

let root, T, TIERS, rows = [], P, N = {};
// the default measurement is all tested decks (2026-10-24): 101 cards measured there against 69 in competitive decks
const S = { axis: "r", view: "list", q: "", ra: new Set(), el: new Set(), tier: new Set(), sort: "score", rings: false, filtersOpen: false };
let ui = {};

export async function mount(el) {
  root = el;
  [T] = await Promise.all([loadCardTiers(), loadRanking(), loadDecks()]);
  TIERS = T.tiers.concat(["nm"]);
  presence();
  // the measurement and the view live in the address: #card-tiers (all tested decks), #card-tiers/competitive,
  // #card-tiers/details, #card-tiers/competitive-details; "all" and the 1.22 page's "random" open the default measurement
  const start = (location.hash.split("/")[0] === "#card-tiers" && location.hash.split("/")[1]) || "";
  // whole words only: a card key in the address (#card-tiers/<key>, a card view) never picks a measurement
  S.axis = /^competitive(-|$)/.test(start) ? "c" : "r";
  S.view = /(^|-)details$/.test(start) ? "details" : "list";
  wireOnce();
  build();
  // the one load sequence of this tab: the first time it is shown, the tier rows on screen arrive in rank order
  cascade(root, () => [...ui.list.children]);
  on("lang", () => { S.filtersOpen = ui.fbtn.getAttribute("aria-expanded") === "true"; build(); });
  // the tab is left: a pinned card closes, so it is not waiting there when the visitor comes back
  window.addEventListener("hashchange", () => hidePop(true));
  if ("ResizeObserver" in window) {
    let raf = 0;
    new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(sizeRows); }).observe(root);
  }
  if (document.fonts) document.fonts.ready.then(sizeRows);
}

const tierOf = (x, a) => (x.ax[a] ? x.ax[a].tier : "nm");

// ---------------------------------------------------------------- presence in the decks of the deck ranking
// the Deck tier list's 30 decks by win rate (ranking.json; its top 10 by rank) and every deck of the run's deck table
// (ranking-decks.json, in its canonical order: the furthest stage first, then the score there)
function presence() {
  const top = DB.ranking.by_score.decks;
  N = { top10: top.filter((d) => d.rank <= 10).length, top30: top.length, listed: DB.decks.rows.length };
  P = new Map();
  const get = (id) => { if (!P.has(id)) P.set(id, { t10: 0, t30: 0, all: 0, bt: null, br: null, bl: null, wr: [] }); return P.get(id); };
  for (const d of top) {
    for (const id of d.cards) {
      const p = get(id);
      p.t30++;
      if (d.rank <= 10) p.t10++;
      p.bt = p.bt == null ? d.rank : Math.min(p.bt, d.rank);
      p.wr.push(d.score);
    }
  }
  DB.decks.rows.forEach((r, k) => {
    for (const c of r.cards) {
      if (!c) continue;
      const p = get(c.id);
      p.all++;
      if (p.br == null) { p.br = k + 1; p.bl = r.level; }
    }
  });
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  for (const p of P.values()) p.vw = mean(p.wr);
}
const presOf = (x) => P.get(x.c.id) || { t10: 0, t30: 0, all: 0, bt: null, br: null, bl: null, vw: null };

/** Why a card has no score on measurement `a` ("15 race decks, 30 needed"), or null when it has one. A card that is not
 * measured in all tested decks is not measured in competitive decks either: the first sort's rule comes first. */
function nmWhy(x, a) {
  if (x.ax[a]) return null;
  if (!x.ax.r) return t("ct.nmPool", { n: fmtInt(x.dk.pool), min: fmtInt(T.min_decks.pool) });
  return t("ct.nmRace", { n: fmtInt(x.dk.competitive), min: fmtInt(T.min_decks.competitive) });
}

/**
 * What "About the numbers" opens (the caveats live there since 2026-10-24, so nothing stands between the intro line and the
 * tier rows but the toolbar): why the ranking is temporary, how a card is scored, then the caveats as a short list: the two
 * measurements, how they disagree (the two cards they disagree on most), how fragile the tiers are, when a card is not
 * measured, the AI's caveat. Every figure comes from cardtiers.json.
 */
function methodLines() {
  const f = T.facts, m = T.measurements;
  const ex = [];
  f.examples.forEach((e) => {
    const c = DB.byId.get(e.id);
    if (!c) return;
    if (ex.length) ex.push(t("ui.sep"));
    ex.push(...tx("ct.cavEx", { card: chip(c), a: ord(e.competitive_rank), b: ord(e.pool_rank) }));
  });
  return [
    T.final ? null : h("p", [...tx("rk.mWhy"), " ", t("rk.mBench", { n: m.pool.opponents })]),
    t("ct.mHow", { n: m.pool.opponents }),
    h("ul.vinfo-l", [
      h("li", tx("ct.cavTwo", { cdecks: fmtInt(m.competitive.decks), cgames: fmtInt(m.competitive.games), ai: m.competitive.ai,
        pdecks: fmtInt(m.pool.decks), pgames: fmtInt(m.pool.games), n: m.pool.opponents })),
      h("li", tx("ct.cavSyn", { examples: h("span", ex), share: pct(f.same_tier_share, 0) })),
      h("li", tx("ct.cavFragile", { n: f.straddling.competitive, m: T.measured.competitive })),
      h("li", t("ct.mNm", { pool: fmtInt(T.min_decks.pool), race: fmtInt(T.min_decks.competitive) })),
      h("li", t("rk.limit.plan_decks")),
    ]),
  ];
}

// ---------------------------------------------------------------- page
function build() {
  hidePop(true);
  ui = { notes: {} };
  roving = null;
  rows = T.cards.map((r, i) => ({ i, c: r.card, ax: { c: r[KEY.c], r: r[KEY.r] }, ag: r.agreement, dk: r.decks, tal: r.talent }));
  ui.announce = h("p.sr", { "aria-live": "polite" });
  ui.list = h("div.ct-list", { id: "ct-list", tabindex: "-1" });
  ui.pop = h("div.ct-pop#ct-pop", { "aria-hidden": "true" });
  ui.tbody = h("tbody");
  root.classList.toggle("ct-rings", S.rings);
  root.replaceChildren(
    h("div.vhead.ct-head", [
      h("h1", t("ct.h1")),
      // the card tiers come from the temporary deck ranking's run: the same banner as the views that list its decks
      T.final ? null : provBanner("card-tiers", { sentence: "ct.bannerP" }),
      ...introLine("card-tiers", h("p.lede", t("ct.lede")), { method: methodLines(), patch: T.patch }),
    ]),
    toolbar(),
    filtersRegion(),
    findRow(),
    ui.announce,
    axisNotes(),
    h("section.ct-view", { id: "ct-view-list", role: "tabpanel", "aria-labelledby": "ct-tab-list" }, [
      h("h2.sr", t("ct.vTiers")),
      ui.list,
      ui.pop,
    ]),
    details(),
  );
  tierRows();
  icons();
  wireList();
  tableRows();
  const view = S.view;
  S.view = "list";
  setAxis(S.axis, false);
  if (view === "details") setView("details", false, true);
  sizeRows();
}

function toolbar() {
  ui.axisBtns = ["r", "c"].map((a) => h("button", { type: "button", "data-axis": a, "aria-pressed": String(a === S.axis), onclick: () => setAxis(a, true) }, ax(a)));
  ui.fbtn = h("button.btn.ghost.disc.ct-fbtn", { type: "button", "aria-controls": "ct-filters", title: t("ct.filtersTitle") },
    [h("span", t("ct.filters")), h("span.tab-n.ct-fn", { hidden: true }), icon("chevron")]);
  ui.tabs = [["list", t("ct.vTiers")], ["details", t("ct.vDetails")]].map(([v, label]) => h("button", {
    type: "button", role: "tab", id: "ct-tab-" + v, "aria-controls": "ct-view-" + v, "aria-selected": String(v === "list"), tabindex: v === "list" ? null : "-1",
    onclick: () => setView(v),
    onkeydown: (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); setView(S.view === "list" ? "details" : "list", true); } },
  }, label));
  return band(h("div.ct-bar", [
    h("div.seg.ct-seg", { role: "group", "aria-label": t("ct.measure") }, ui.axisBtns),
    h("div.ct-bar-r", [ui.fbtn, h("div.seg.ct-seg.ct-tabs", { role: "tablist", "aria-label": t("ct.view") }, ui.tabs)]),
  ]));
}

function filtersRegion() {
  const toggle = (set, v) => { if (set.has(v)) set.delete(v); else set.add(v); applyFilters(); };
  ui.raChips = RARITIES.map((id) => Object.assign(filterChip(raName(id), "sp-gem-" + id, () => toggle(S.ra, id)), { id, label: raName(id) }));
  ui.elChips = ELEMENTS.map((id) => Object.assign(filterChip(elName(id), "sp-el-" + id, () => toggle(S.el, id)), { id, label: elName(id) }));
  ui.fcount = h("p.ct-fcount", { "aria-live": "polite" });
  ui.clear = h("button.btn.ghost.ct-clear", { type: "button", disabled: true, title: t("ct.clearOff"), onclick: clearAll }, t("ct.clear"));
  // a display option, not a filter: Clear filters leaves it as it is
  const rings = h("button.chip.ct-rings-btn", { type: "button", "aria-pressed": String(S.rings), title: t("ct.ringsTitle"),
    onclick: () => { S.rings = !S.rings; rings.setAttribute("aria-pressed", String(S.rings)); root.classList.toggle("ct-rings", S.rings); } },
    [h("i.ct-ring-ic", { "aria-hidden": "true" }), h("span.chip-l", t("ct.rings"))]);
  const group = (key, kids) => h("div.ct-fgroup", { role: "group", "aria-label": t(key) }, [h("span.ct-fgroup-l", { "aria-hidden": "true" }, t(key)), ...kids]);
  const region = h("div", { id: "ct-filters" }, h("div.collapse-in", h("div.ct-filters", { role: "group", "aria-label": t("ct.filters") }, [
    group("ct.gRarity", ui.raChips.map((c) => c.el)),
    group("ct.gElement", ui.elChips.map((c) => c.el)),
    group("ct.gDots", [rings]),
    h("div.ct-fstatus", [ui.fcount, ui.clear]),
  ])));
  disclosure(ui.fbtn, region, { open: S.filtersOpen });
  return region;
}

/** "A dot: different tier in <other> decks." The ring part shows only while the rings are on. */
function legend(o) {
  return [
    ...tx("ct.dot", { dot: h("span.ct-legend", h("i", { "aria-hidden": "true" })), other: t(o === "r" ? "ct.otherR" : "ct.otherC") }),
    h("span.ct-ring-only", tx("ct.ring", { ring: h("span.ct-legend", h("i.ring", { "aria-hidden": "true" })) })),
    t("ct.hint"),
  ];
}

function axisNotes() {
  const m = T.measurements;
  ui.notes.c = h("p", { "data-note": "c" }, [t("ct.noteC", { decks: fmtInt(m.competitive.decks), ai: m.competitive.ai }),
    h("span.ct-list-only", legend("r"))]);
  ui.notes.r = h("p", { "data-note": "r", "aria-hidden": "true" }, [t("ct.noteR", { decks: fmtInt(m.pool.decks) }),
    h("span.ct-list-only", legend("c"))]);
  return h("div.ct-notes", [ui.notes.c, ui.notes.r]);
}

// ---------------------------------------------------------------- tier rows and card icons
function tierRows() {
  ui.rows = {};
  ui.rowN = {};
  ui.list.replaceChildren(...TIERS.map((tr) => {
    const nm = tr === "nm";
    const id = "ct-t-" + TC[tr];
    ui.rowN[tr] = h("span.ct-tl-n");
    const cards = h("div.ct-cards", h("p.ct-empty", t(nm ? "ct.emptyNm" : "ct.empty")));
    ui.rows[tr] = cards;
    return h("div.ct-row", { role: "group", "aria-labelledby": id }, [
      h("div.ct-tl.tc-" + TC[tr], { id }, h("div.ct-tl-in", [nm ? h("span.ct-tl-word", t("ct.nm")) : h("span.ct-tl-k", [h("span.sr", t("tl.tier", { tier: "" })), tr]), ui.rowN[tr]])),
      cards,
    ]);
  }));
}

function icons() {
  for (const x of rows) {
    x.ic = h("button.ct-ic", { type: "button", "data-i": x.i, "aria-expanded": "false", "aria-controls": "ct-pop", tabindex: "-1" }, [
      h("img", { class: "ct-ic-art", loading: "lazy", decoding: "async", alt: "", width: 112, height: 160, src: thumb(x.c) }),
      h("i.ct-ic-orb.sp-el-" + x.c.element, { "aria-hidden": "true" }),
      h("i.ct-ic-dot", { "aria-hidden": "true" }),
      // no patch mark on the icon (one marker less per card, owner 2026-10-18 "pas trop surchargé"): the change is in the
      // icon's label, the hover preview, the pinned card and the Details row
    ]);
  }
  ui.order = {};
  for (const a of ["c", "r"]) {
    const by = Object.fromEntries(TIERS.map((tr) => [tr, []]));
    rows.forEach((x) => by[tierOf(x, a)].push(x));
    TIERS.forEach((tr) => by[tr].sort((p, q) => (q.ax[a] ? q.ax[a].score : -9) - (p.ax[a] ? p.ax[a].score : -9)));
    ui.order[a] = by;
  }
}

function label(x, a) {
  const tierWord = (k) => (x.ax[k] ? t("ct.tierN", { tier: x.ax[k].tier }) : t("ct.nmLow"));
  const o = other(a);
  return t("ct.icLabel", { name: cardName(x.c), a: tierWord(a), ax: ax(a).toLocaleLowerCase(getLang()), b: tierWord(o), ox: ax(o).toLocaleLowerCase(getLang()) })
    + (x.ag === "noise" ? t("ct.icNoise") : "") + (changeOf(x.c) ? t("ui.sep") + t("pc." + changeOf(x.c).class, { patch: DB.patch }) : "")
    + (x.dim ? t("ct.icDim") : "");
}

function place(a) {
  const by = ui.order[a];
  for (const tr of TIERS) {
    const row = ui.rows[tr], empty = row.querySelector(".ct-empty");
    by[tr].forEach((x) => row.insertBefore(x.ic, empty));
    row.classList.toggle("is-empty", by[tr].length === 0);
    ui.rowN[tr].textContent = t("ct.cards", { n: by[tr].length });
  }
  for (const x of rows) {
    // the dot compares two tiers: a card measured on one side only carries none ("Not measured" is not a tier)
    x.ic.classList.toggle("diff", !!(x.ax.c && x.ax.r) && x.ax.c.tier !== x.ax.r.tier);
    x.ic.classList.toggle("noise", x.ag === "noise");
    x.ic.setAttribute("aria-label", label(x, a));
  }
  rove(roving && roving.isConnected ? roving : ui.list.querySelector(".ct-ic"));
}

// rows keep the height the larger of the two lists needs, so switching the measurement never moves the page
function sizeRows() {
  const any = rows[0] && rows[0].ic;
  if (!any || !any.offsetWidth) return;
  const w = any.offsetWidth, ht = any.offsetHeight;
  for (const tr of TIERS) {
    const row = ui.rows[tr], cs = getComputedStyle(row);
    const gap = parseFloat(cs.columnGap) || 0, rgap = parseFloat(cs.rowGap) || 0;
    const inner = row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const per = Math.max(1, Math.floor((inner + gap) / (w + gap)));
    const lines = Math.max(1, Math.ceil(Math.max(ui.order.c[tr].length, ui.order.r[tr].length) / per));
    row.style.minHeight = (lines * ht + (lines - 1) * rgap + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)) + "px";
  }
}

// one card of the list is in the tab order; arrow keys move between cards (left/right in order, up/down by line)
let roving = null;
function rove(b) {
  if (roving) roving.tabIndex = -1;
  roving = b;
  if (b) b.tabIndex = 0;
}
function step(b, key) {
  const all = $$(".ct-ic", ui.list).filter((x) => x.offsetParent), i = all.indexOf(b);   // cards a search hides are skipped
  if (key === "ArrowRight") return all[i + 1];
  if (key === "ArrowLeft") return all[i - 1];
  if (key === "Home") return all[0];
  if (key === "End") return all[all.length - 1];
  const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, down = key === "ArrowDown";
  const rects = all.map((x) => x.getBoundingClientRect());
  const line = rects.map((x) => x.top).filter((tp) => (down ? tp > r.top + 4 : tp < r.top - 4));
  if (!line.length) return null;
  const target = down ? Math.min(...line) : Math.max(...line);
  let best = null, dist = Infinity;
  all.forEach((x, k) => {
    if (Math.abs(rects[k].top - target) > 4) return;
    const d = Math.abs(rects[k].left + rects[k].width / 2 - cx);
    if (d < dist) { dist = d; best = x; }
  });
  return best;
}

function setAxis(a, animate) {
  if (a === S.axis && animate) return;
  const keep = pinned ? cur : null;            // a pinned card follows its icon to the other list
  hidePop(true);
  const play = animate && !reducedMotion() && S.view === "list";
  const first = new Map();
  if (play) rows.forEach((x) => first.set(x.ic, x.ic.getBoundingClientRect()));
  S.axis = a;
  place(a);
  ui.axisBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.axis === a)));
  for (const k of ["c", "r"]) ui.notes[k].setAttribute("aria-hidden", String(k !== a));
  $$("th[data-ax]", root).forEach((th) => th.classList.toggle("on", th.dataset.ax === a));
  if (play) {
    const vh = innerHeight;
    for (const x of rows) {
      const f = first.get(x.ic), l = x.ic.getBoundingClientRect();
      const dx = f.left - l.left, dy = f.top - l.top;
      if (!dx && !dy) continue;
      if ((f.bottom < -200 || f.top > vh + 200) && (l.bottom < -200 || l.top > vh + 200)) continue;   // off screen both ways
      x.ic.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 280, easing: "cubic-bezier(.4, 0, .2, 1)" });
    }
  }
  renderTable();
  applyFilters();
  if (animate) { say(t("ct.sayAxis", { axis: ax(a) })); saveState(); }
  if (keep && S.view === "list") setTimeout(() => showPop(keep, true), play ? 300 : 0);
}
const say = (s) => { ui.announce.textContent = s; };

/** Keeps the measurement and the view in the address without a history entry, only while this tab is shown. A card key
 * never collides with these words, so main.js still reads the tab and ignores the rest. */
function saveState() {
  if (location.hash.split("/")[0] !== "#card-tiers") return;
  const parts = [S.axis === "c" ? "competitive" : "", S.view === "details" ? "details" : ""].filter(Boolean).join("-");
  const next = "#card-tiers" + (parts ? "/" + parts : "");
  if (location.hash !== next) { try { history.replaceState(history.state, "", next); } catch (e) { /* the address stays as it is */ } }
}

// ---------------------------------------------------------------- filters: dim on the tier rows, hide in the table
let TS = [];                                       // the words of the card search (search.js), set by applyFilters
const found = (x) => hasAll(nameHay(x.c), TS);
const matches = (x) => found(x) && (!S.ra.size || S.ra.has(x.c.rarity)) && (!S.el.size || S.el.has(x.c.element));
const matchesTier = (x) => !S.tier.size || S.tier.has(tierOf(x, S.axis));

function applyFilters() {
  TS = terms(S.q);
  const on_ = TS.length > 0 || S.ra.size + S.el.size + (S.view === "details" ? S.tier.size : 0) > 0;
  let shown = 0;
  for (const x of rows) {
    const ok = matches(x);
    if (!!x.dim === ok) { x.dim = !ok; x.ic.classList.toggle("dim", !ok); x.ic.setAttribute("aria-label", label(x, S.axis)); }
    const okT = ok && matchesTier(x);
    x.tr.hidden = !okT;
    if (S.view === "list" ? ok : okT) shown++;
  }
  const total = rows.length;
  ui.fcount.textContent = !on_ ? t("ct.countAll", { n: total }) : shown === 0
    ? t(S.view === "list" ? "ct.countNone" : "ct.countNoneT", { total })
    : t("ct.countSome", { n: shown, total });
  // each rarity or element chip counts the cards it would show with the other group's filter on
  for (const c of ui.raChips) setChip(c, rows.filter((x) => found(x) && x.c.rarity === c.id && (!S.el.size || S.el.has(x.c.element))).length, S.ra.has(c.id), t("filter.show", { label: c.label }), t("filter.none"));
  for (const c of ui.elChips) setChip(c, rows.filter((x) => found(x) && x.c.element === c.id && (!S.ra.size || S.ra.has(x.c.rarity))).length, S.el.has(c.id), t("filter.show", { label: c.label }), t("filter.none"));
  const counts = {};
  rows.forEach((x) => { if (matches(x)) { const tr = tierOf(x, S.axis); counts[tr] = (counts[tr] || 0) + 1; } });
  for (const c of ui.tierChips) setChip(c, counts[c.id] || 0, S.tier.has(c.id), t("filter.show", { label: c.label }), t("ct.tierChipOff"));
  const nOn = S.ra.size + S.el.size;               // the search has its own field, outside the filters
  const fn = ui.fbtn.querySelector(".ct-fn");
  fn.hidden = nOn === 0;
  fn.textContent = String(nOn);
  ui.fbtn.title = nOn ? t("ct.filtersOn", { n: nOn }) : t("ct.filtersTitle");
  // row counts follow the filters: "2 of 7 cards" while some cards of the row are dimmed or, during a search, hidden.
  // A search keeps only the matching cards and the rows that hold one, so the matches sit right under the field (on a phone
  // too); the rarity and element filters alone only dim. Clearing the search brings every row and card back.
  const finding = TS.length > 0;
  root.classList.toggle("ct-finding", finding);
  for (const tr of TIERS) {
    const all = ui.order[S.axis][tr], k = all.filter(matches).length;
    ui.rowN[tr].textContent = k === all.length ? t("ct.cards", { n: all.length }) : t("ct.cardsOf", { k, n: all.length });
    ui.rows[tr].parentElement.hidden = finding && k === 0;
  }
  ui.list.hidden = finding && shown === 0 && S.view === "list";
  ui.clear.disabled = !on_;
  ui.clear.title = t(on_ ? "ct.clearOn" : "ct.clearOff");
  ui.dtEmpty.hidden = !(S.view === "details" && shown === 0);
  paintFind();
}

/** Clear filters: the chips, and the search too (the Details view's empty state uses it to show every card again). */
function clearAll() {
  S.ra.clear(); S.el.clear(); S.tier.clear();
  S.q = ""; ui.search.set("");
  applyFilters();
}

// ---------------------------------------------------------------- card search: the field above the rows, its live line
function findRow() {
  ui.search = searchField({ id: "ct-q", name: "card-search", placeholder: t("ct.findPh"), label: t("ct.find"), clearLabel: t("ct.clearSearch"), value: S.q,
    onChange: (v) => { S.q = v; applyFilters(); },
    onEnter: jumpToFirst });
  ui.findSay = h("p.find-say");
  ui.findVoice = announcer();
  return h("div.find.ct-find", [ui.search.el, ui.findSay, ui.findVoice.el]);
}

/**
 * The cards the search finds, whatever the rarity and element filters (they have their own count). Up to three are named, each
 * with its tier on the measurement shown, so the line answers "which tier?" before the eye finds the ring.
 */
function paintFind() {
  if (!TS.length) { ui.findSay.replaceChildren(); ui.findVoice.say(""); return; }
  const hits = rows.filter(found);
  const clear = h("button.btn.ghost.find-clear", { type: "button", onclick: () => { S.q = ""; ui.search.set(""); applyFilters(); ui.search.input.focus(); } }, t("find.clear"));
  const tierWord = (x) => (x.ax[S.axis] ? t("ct.tierN", { tier: x.ax[S.axis].tier }) : t("ct.nm"));
  let say, voice;
  if (!hits.length) { say = [t("find.noCard", { q: S.q.trim() }), clear]; voice = t("find.noCard", { q: S.q.trim() }); }
  else if (hits.length <= 3) {
    say = tx("find.cards", { n: hits.length, cards: h("span.find-cards", hits.map((x) =>
      h("span.find-hit", [chip(x.c), h("span.ct-tchip.tc-" + TC[tierOf(x, S.axis)], { title: tierWord(x) }, tierOf(x, S.axis) === "nm" ? t("ct.nm") : tierOf(x, S.axis))]))) });
    voice = t("find.cards", { n: hits.length, cards: hits.map((x) => `${cardName(x.c)} (${tierWord(x)})`).join(", ") });
  } else { say = [t("find.cardsN", { n: hits.length, total: rows.length })]; voice = say[0]; }
  ui.findSay.replaceChildren(...say);
  ui.findVoice.say(voice);
}

/** Enter in the search: focus moves to the first matching card of the tier rows (its short numbers show; Enter pins them). */
function jumpToFirst() {
  if (!TS.length || S.view !== "list") return;
  const x = TIERS.flatMap((tr) => ui.order[S.axis][tr]).find(matches);
  if (!x) return;
  x.ic.scrollIntoView({ block: "center", behavior: "auto" });
  rove(x.ic);
  x.ic.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- the card numbers (hover, focus, tap)
let cur = null, pinned = false, hoverT = 0, restoring = false;
const sheet = matchMedia("(max-width: 759px)");

function verdict(x) {
  if (!x.ax.r) return tx("ct.vNmAll", { why: nmWhy(x, "r") });
  if (!x.ax.c) return tx("ct.vNmC", { why: nmWhy(x, "c") });
  return tx({ same: "ct.vSame", noise: "ct.vNoise", apart: "ct.vApart" }[x.ag]);
}

// what a row of the card numbers means, as its label's title
const TIPS = { "ct.fRange": "ct.fRangeTip", "ct.fConf": "ct.fConfTip", "ct.fDecks": "ct.fDecksTip" };
const tchip = (tr) => h("span.ct-tchip.tc-" + TC[tr], tr === "nm" ? t("ct.nm") : tr);
const range = (v) => t("ct.range", { a: pt(v.ci_low), b: pt(v.ci_high) });

function popContent(x, full) {
  const c = x.c, p = presOf(x);
  // a measurement the card has no score on: "Not measured" in the tier row, its decks in the decks row (the verdict under the
  // table says how many it needed), nothing else
  const cell = (a, fmt, k) => h("td", { class: a === S.axis ? "on" : null }, x.ax[a] ? fmt(x.ax[a], a)
    : k === "ct.fTier" ? tchip("nm") : k === "ct.fDecks" ? fmtInt(x.dk[KEY[a]]) : "—");
  const facts = [
    ["ct.fTier", (v) => tchip(v.tier)],
    ["ct.fScore", (v) => pts(v.score)],
    ["ct.fRange", range],
    ["ct.fConf", (v) => pct(v.confidence, 0)],
    ["ct.fRank", (v, a) => t("ct.rankOf", { r: v.rank, m: T.measured[KEY[a]] })],
    ["ct.fDecks", (v, a) => h("span", { title: t("ct.gamesN", { n: v.games }) }, fmtInt(x.dk[KEY[a]]))],
  ];
  const brief = facts.slice(0, 2);
  const best = p.bt ? t("ct.bestTier", { rank: p.bt }) : p.br ? t("ct.bestListed", { rank: fmtInt(p.br), n: fmtInt(N.listed), level: level(p.bl) }) : t("ct.none");
  // in no top-30 deck: two lines (that, and its best deck), not five lines of "none"
  const pres = p.t30 ? [
    ["ct.pTop10", t("ct.decksOf", { a: p.t10, b: N.top10 })],
    ["ct.pTop30", t("ct.decksOf", { a: p.t30, b: N.top30 })],
    ["ct.pBest", best],
    ["ct.pWr", t("ct.wrLine", { wr: pct1(p.vw), n: p.t30 })],
  ] : [
    ["ct.pTop30", t("ct.decksOf", { a: 0, b: N.top30 })],
    ["ct.pBest", best],
  ];
  return [
    h("div.ct-pop-h", [
      h("img.ct-pop-art", { alt: "", width: 48, height: 69, src: thumb(c) }),
      h("div", [
        h("div.ct-pop-name", { lang: getLang(), translate: "no" }, cardName(c)),
        otherName(c) !== cardName(c) ? h("div.ct-pop-sub", { translate: "no" }, otherName(c)) : null,
        h("div.ct-pop-sub", `${raName(c.rarity)}, ${elName(c.element)}`),
        patchTag(c),
      ]),
    ]),
    // pinned: what the patch changed, and that the numbers below predate it
    full && patchDetail(c) ? h("p.ct-pop-pc", patchDetail(c)) : null,     // showPop drops the empty slots
    // the card tiers' own patch: a card the patch changed was measured after the change when it is the card data's
    full ? oldNumbersNote(c, T.patch) : null,
    h("table.ct-pop-t", [
      h("thead", h("tr", [h("th", { scope: "col" }, h("span.sr", t("ct.measureCol"))),
        h("th", { scope: "col", class: S.axis === "r" ? "on" : null }, t("ct.axRs")), h("th", { scope: "col", class: S.axis === "c" ? "on" : null }, t("ct.axCs"))])),
      h("tbody", (full ? facts : brief).map(([k, f]) => h("tr", [h("th", { scope: "row", title: TIPS[k] ? t(TIPS[k]) : null }, t(k)), cell("r", f, k), cell("c", f, k)]))),
    ]),
    h("p.ct-pop-v", verdict(x)),
    full ? h("table.ct-pop-t.ct-pop-p", [h("caption.sr", t("ct.presence")),
      h("tbody", pres.map(([k, v]) => h("tr", [h("th", { scope: "row" }, t(k)), h("td.on", v)])))]) : h("p.ct-pop-more", t("ct.popMore")),
    full ? talentBlock(x) : null,
  ];
}

/**
 * The card's talent: the suggested one (cards.json `suggested_talent`, tagged "Suggested") when the card data has one, else the
 * talent the card played in the decks measured (cardtiers.json `talent`, tagged "Tested"); its name and in-game text. A card
 * with neither has no block.
 */
function talentBlock(x) {
  const c = x.c, s = suggestedTalent(c);
  const tl = s ? s.tl : x.tal != null ? c.talents[x.tal] : null;
  if (!tl) return null;
  return h("div.ct-pop-sugg", [
    h("div.ct-pop-sugg-h", [h("i.ab-talent", { "aria-hidden": "true" }), h("span", { lang: getLang() }, L(tl, "name")),
      s ? h("span.tag.sugg", { title: t("card.suggestedTip") }, t("card.suggested"))
        : h("span.tag.sugg", { title: t("ct.testedTip") }, t("ct.tested"))]),
    h("p", { lang: getLang() }, textNodes(L(tl, "description"))),
  ]);
}

function showPop(b, pin) {
  const x = rows[+b.dataset.i];
  if (cur && cur !== b) { cur.setAttribute("aria-expanded", "false"); cur.classList.remove("pinned"); }
  cur = b;
  pinned = !!pin;
  const pop = ui.pop;
  const kids = popContent(x, pinned);
  if (pinned) {
    // the card dialog opens from the delegated [data-card] click; focus moves back to the icon first, so closing the dialog
    // returns there (the popover is hidden by then)
    kids.push(h("div.ct-pop-act", h("button.btn.ct-pop-open", { type: "button", "data-card": x.c.key, onclick: () => { const k = cur; hidePop(true); refocus(k); } }, [t("ct.showCard"), icon("arrow")])));
    kids.push(h("button.close.ct-pop-x", { type: "button", "aria-label": t("ct.closeNums"), title: t("ui.close"), onclick: () => { const k = cur; hidePop(true); refocus(k); } }, icon("close", 16)));
  }
  pop.replaceChildren(...kids.filter(Boolean));
  pop.classList.toggle("pinned", pinned);
  // a pinned card is a small non-modal dialog; a hover or focus preview repeats the icon's label, so it is hidden from readers
  if (pinned) { pop.removeAttribute("aria-hidden"); pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", cardName(x.c)); }
  else { pop.setAttribute("aria-hidden", "true"); pop.removeAttribute("role"); pop.removeAttribute("aria-label"); }
  b.setAttribute("aria-expanded", "true");
  b.classList.toggle("pinned", pinned);            // only a pinned icon is ringed (selected); a hover preview is not
  if (pinned) say(summary(x));
  if (sheet.matches) { pop.style.left = pop.style.top = ""; pop.classList.add("on"); return; }     // a bottom sheet on a phone, placed by the stylesheet
  const r = b.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  const vw = document.documentElement.clientWidth, m = 16;
  const left = Math.max(m, Math.min(r.left + r.width / 2 - pw / 2, vw - pw - m));
  // below the card, else above it, else as low as it fits under the header (it scrolls inside when taller than the window)
  const head = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--chrome-h")) || 64;
  let top = r.bottom + 12, oy = "0";
  if (top + ph > innerHeight - m) {
    if (r.top - 12 - ph > head + m) { top = r.top - 12 - ph; oy = "100%"; }
    else top = Math.max(head + m, innerHeight - m - ph);
  }
  pop.style.left = left + scrollX + "px";
  pop.style.top = top + scrollY + "px";
  pop.style.setProperty("--ox", (r.left + r.width / 2 - left) + "px");
  pop.style.setProperty("--oy", oy);
  pop.classList.add("on");
}

function summary(x) {
  const one = (a) => (x.ax[a] ? t("ct.sumT", { tier: x.ax[a].tier, score: pts(x.ax[a].score) }) : t("ct.nmLow"));
  const v = { same: "ct.sumSame", noise: "ct.sumNoise", apart: "ct.sumApart" }[x.ag];
  return t("ct.sum", { name: cardName(x.c), c: one("c"), r: one("r"), v: v ? t(v) : "" });
}

function hidePop(force) {
  if (!ui.pop || (pinned && !force)) return;
  pinned = false;
  hideTip();
  ui.pop.classList.remove("on", "pinned");
  ui.pop.setAttribute("aria-hidden", "true");
  if (cur) { cur.setAttribute("aria-expanded", "false"); cur.classList.remove("pinned"); }
  cur = null;
}
function refocus(b) { if (!b) return; restoring = true; b.focus(); restoring = false; }

/** Listeners on the list itself: it is rebuilt with the page. */
function wireList() {
  const list = ui.list;
  // hover intent: a card opens after 120 ms under the pointer, at once when another card is already open
  list.addEventListener("pointerover", (e) => {
    const b = e.target.closest(".ct-ic");
    if (!b || e.pointerType !== "mouse" || pinned || sheet.matches) return;
    clearTimeout(hoverT);
    if (cur) showPop(b, false); else hoverT = setTimeout(() => { if (!pinned) showPop(b, false); }, 120);
  });
  list.addEventListener("pointerout", (e) => {
    const b = e.target.closest(".ct-ic");
    if (b && e.pointerType === "mouse" && !b.contains(e.relatedTarget)) { clearTimeout(hoverT); hidePop(false); }
  });
  // focus shows the numbers, except when focus comes back after closing them, and never as a sheet on a phone
  list.addEventListener("focusin", (e) => {
    const b = e.target.closest(".ct-ic");
    if (!b) return;
    if (b !== roving) rove(b);
    if (!pinned && !restoring && !sheet.matches) showPop(b, false);
  });
  list.addEventListener("focusout", (e) => { if (!pinned && !list.contains(e.relatedTarget)) hidePop(false); });
  list.addEventListener("click", (e) => {
    const b = e.target.closest(".ct-ic");
    if (!b) return;
    clearTimeout(hoverT);
    if (pinned && cur === b) hidePop(true); else showPop(b, true);
  });
  list.addEventListener("keydown", (e) => {
    const b = e.target.closest(".ct-ic");
    if (!b || !["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const n = step(b, e.key);
    if (!n) return;
    hidePop(true);
    rove(n);
    n.focus();
  });
}

/** Listeners on the document: added once, they read the current page through `ui`. */
function wireOnce() {
  document.addEventListener("pointerdown", (e) => {
    if (pinned && ui.pop && !ui.pop.contains(e.target) && !e.target.closest(".ct-ic")) hidePop(true);
  });
  document.addEventListener("keydown", (e) => {
    // the card dialog handles its own Escape; a pinned card closes only when no dialog is open
    if (e.key === "Escape" && cur && !document.querySelector("dialog[open]")) { const b = cur; hidePop(true); refocus(b); }
  });
  addEventListener("resize", () => { if (!sheet.matches) hidePop(true); });
}

// ---------------------------------------------------------------- details table
function details() {
  ui.tierChips = TIERS.map((tr) => {
    const lab = tr === "nm" ? t("ct.nm") : t("ct.tierN", { tier: tr });
    const c = filterChip(tr === "nm" ? t("ct.nm") : tr, "ct-sw tc-" + TC[tr], () => { if (S.tier.has(tr)) S.tier.delete(tr); else S.tier.add(tr); applyFilters(); });
    return Object.assign(c, { id: tr, label: lab });
  });
  const sort = h("select", { id: "ct-sort", onchange: (e) => { S.sort = e.target.value; renderTable(); applyFilters(); } }, [
    ["score", "ct.sScore"], ["score-asc", "ct.sScoreAsc"], ["gap", "ct.sGap"], ["presence", "ct.sPresence"], ["winrate", "ct.sWr"],
  ].map(([v, k]) => h("option", { value: v }, t(k))));
  sort.value = S.sort;
  ui.dtEmpty = h("div.ct-dt-empty", { hidden: true }, [h("p", t("ct.dtEmpty")),
    h("button.btn", { type: "button", onclick: () => { clearAll(); ui.clear.focus(); } }, t("ct.clear"))]);
  const th = (text, title, a) => h("th", { scope: "col", title, "data-ax": a || null }, text);
  return h("section.ct-view", { id: "ct-view-details", role: "tabpanel", "aria-labelledby": "ct-tab-details", hidden: true }, [
    h("h2.sr", t("ct.vDetails")),
    h("div.ct-dt-tools", [
      h("div.ct-fgroup", { role: "group", "aria-label": t("ct.gTier") }, [h("span.ct-fgroup-l", { "aria-hidden": "true" }, t("ct.gTier")), ...ui.tierChips.map((c) => c.el)]),
      h("label.field.select.ct-sort", [h("span.sr", t("ct.sortBy")), sort, icon("chevron")]),
    ]),
    h("div.ct-dt", [
      h("table.ct-tab", [
        h("caption.sr", t("ct.tCaption")),
        h("colgroup", ["rank", "card", "ax", "ax", "ag", "pr", "wr", "best"].map((k) => h("col.ct-w-" + k))),
        h("thead", h("tr", [
          th("#", t("ct.thRank")), th(t("ct.thCard")),
          th(ax("r"), null, "r"), th(ax("c"), null, "c"),
          th(t("ct.thAg"), t("ct.thAgTip")),
          th(t("ct.thPr"), t("ct.thPrTip", { a: N.top10, b: N.top30 })),
          th(t("ct.thWr"), t("ct.thWrTip")),
          th(t("ct.thBest"), t("ct.thBestTip")),
        ])),
        ui.tbody,
      ]),
      ui.dtEmpty,
    ]),
    h("p.ct-hint", t("ct.tHint")),
  ]);
}

function bands() {
  const e = T.tier_edges_z, z0 = -3, z1 = 3;
  const cuts = [z1, ...e, z0];          // S+ from z1 down to e[0], ... E from e[last] down to z0
  return T.tiers.map((tr, k) => [tr, cuts[k + 1], cuts[k]]).reverse();
}
let BANDS = null;
// kept 2.5% inside each end, so a card past ±3 shows its whole dot at the edge instead of half of it
const zx = (z) => Math.max(2.5, Math.min(97.5, ((Math.max(-3, Math.min(3, z)) + 3) / 6) * 100));

function bar(v) {
  if (!BANDS) BANDS = bands();
  const kids = BANDS.map(([tr, a, b]) => h("i.tc-" + TC[tr], { style: { width: ((b - a) / 6) * 100 + "%" } }));
  if (v.z != null) {
    if (v.z_low != null) kids.push(h("span.ct-rb-i", { style: { left: zx(v.z_low) + "%", width: zx(v.z_high) - zx(v.z_low) + "%" } }));
    kids.push(h("span.ct-rb-p", { style: { left: zx(v.z) + "%" } }));
  }
  return h("span.ct-rb", { "aria-hidden": "true" }, kids);
}

function axCell(x, a) {
  const v = x.ax[a];
  if (!v) return h("td.ct-c-" + a, { "data-label": ax(a) }, h("div.ct-ax.off", [h("div.ct-ax-top", tchip("nm")), h("span.ct-cap", nmWhy(x, a))]));
  const facts = [t("ct.sure", { p: pct(v.confidence, 0) }), t("ct.decksN", { n: x.dk[KEY[a]] })].join(", ");
  return h("td.ct-c-" + a, { "data-label": ax(a) }, h("div.ct-ax" + (a === S.axis ? "" : ".off"), [
    h("div.ct-ax-top", [tchip(v.tier), h("span.ct-ax-s", pt(v.score)), h("span.ct-ax-iv", range(v))]), bar(v), h("span.ct-cap", facts),
  ]));
}

function rowCells(x) {
  const a = S.axis, rk = x.ax[a] && x.ax[a].rank ? x.ax[a].rank : "—";
  const c = x.c, p = presOf(x);
  const kv = (v, k) => h("span.ct-kv", [h("b", v), " " + k]);
  const pr = [kv(`${p.t10}/${N.top10}`, t("ct.top10")), kv(`${p.t30}/${N.top30}`, t("ct.top30")), h("span.ct-cap", t("ct.listed", { n: p.all }))];
  const wr = !p.t30 ? h("span.ct-cap", t("ct.wrNone")) : [h("span.ct-kv", h("b", pct1(p.vw))), h("span.ct-cap", t("ct.meanOf", { n: p.t30 }))];
  const best = p.bt ? [h("span.ct-fig", `#${p.bt}`), h("span.ct-cap", t("ct.bestTl"))]
    : p.br ? [h("span.ct-fig", `#${fmtInt(p.br)}`), h("span.ct-cap", t("ct.bestLs", { level: level(p.bl) }))] : h("span.ct-cap", t("ct.none"));
  return [
    h("td.ct-c-rank", h("span.ct-rk", String(rk))),
    h("td.ct-c-card", h("button.ct-cardc", { type: "button", "data-card": c.key, title: t("card.show", { name: cardName(c) }) }, [
      h("img", { class: "ct-th", loading: "lazy", decoding: "async", alt: "", width: 36, height: 51, src: thumb(c) }),
      h("span", [h("span.ct-nm", { translate: "no" }, [h("span.ct-rkm", `#${rk} `), cardName(c)]), h("span.ct-nm-sub", `${raName(c.rarity)}, ${elName(c.element)}`),
        changeOf(c) ? h("span.ct-nm-pc", [glyph(c), t("pc." + changeOf(c).class, { patch: DB.patch })]) : null]),
    ])),
    axCell(x, "r"), axCell(x, "c"),
    h("td.ct-c-ag", { "data-label": t("ct.thAg") }, x.ag ? h("span.ct-ag." + x.ag, t(AGK[x.ag])) : h("span.ct-cap", t("ct.noComp"))),
    h("td.ct-c-pr", { "data-label": t("ct.thPr") }, pr),
    h("td.ct-c-wr", { "data-label": t("ct.thWr") }, wr),
    h("td.ct-c-best", { "data-label": t("ct.thBest") }, best),
  ];
}

function tableRows() { for (const x of rows) { x.tr = h("tr"); ui.tbody.append(x.tr); } }

function sortKey(x) {
  const a = S.axis, v = x.ax[a], p = presOf(x);
  switch (S.sort) {
    case "score": return v ? -v.score : 99;
    case "score-asc": return v ? v.score : 99;
    case "gap": return x.ax.c && x.ax.r && x.ax.c.z != null && x.ax.r.z != null ? -Math.abs(x.ax.c.z - x.ax.r.z) : 99;
    case "presence": return -(p.t30 * 1e6 + p.t10 * 1e3 + p.all / 10);
    case "winrate": return p.vw != null ? -p.vw : 99;
  }
  return 0;
}

function renderTable() {
  const sc = (x) => (x.ax[S.axis] ? x.ax[S.axis].score : -9);
  const list = rows.slice().sort((p, q) => sortKey(p) - sortKey(q) || sc(q) - sc(p));
  for (const x of list) { x.tr.replaceChildren(...rowCells(x)); ui.tbody.append(x.tr); }
}

// ---------------------------------------------------------------- views
function setView(v, focus, init) {
  if (v === S.view) return;
  hidePop(true);
  S.view = v;
  root.classList.toggle("ct-v-details", v === "details");
  ui.tabs.forEach((tb) => {
    const on_ = tb.id === "ct-tab-" + v;
    tb.setAttribute("aria-selected", String(on_));
    tb.tabIndex = on_ ? 0 : -1;
    if (on_ && focus) tb.focus();
  });
  const shown = $("#ct-view-" + v, root);
  $("#ct-view-list", root).hidden = v !== "list";
  $("#ct-view-details", root).hidden = v !== "details";
  if (!reducedMotion() && !init) shown.animate([{ opacity: 0, transform: "translateY(24px)" }, { opacity: 1, transform: "none" }], { duration: 280, easing: "cubic-bezier(.4, 0, .2, 1)" });
  if (v === "list") sizeRows();
  applyFilters();
  if (init) return;
  say(t(v === "list" ? "ct.sayTiers" : "ct.sayDetails"));
  saveState();
}
