// Card tier list tab: every card ranked in up to three views behind one switch (owner, 2026-10-24: "sort by top-30 win rate or by
// race win rate, it is simpler"; the views named after the ranking's stages since 2026-10-25; "every card judged", 2026-10-25):
// All games (`all`, the default when cardtiers.json has it), the mean win rate of its 5 best decks against the benchmark decks,
// read from every stored game of the patch, with its likely range (95%); Tournament (`race`), the average win rate of its best
// Tournament decks against the benchmark decks; Final (`top`: the Final's decks, cardtiers.json `decks.top`), the average win rate
// of its best decks of the Final against the other decks there. Classic tier rows S+ to E plus the cards with no deck in the view;
// switching the view slides the icons to their new rows. Hover, focus or tap previews a card: its tier, the view's figure big (with
// its range in All games, and a quiet "rough estimate" when only the fast AI played its best decks), the other views small, the
// strip of its decks (js/deckstrip.js); a click pins it with its average contribution (All games), its talent and a link to the
// card dialog; the open card keeps clear of the sticky toolbar (roomTop, follow). A Details view lists every card in a sortable
// table. The method is in the footer's Method section (patch.js methodSection), not at the top. Data: data/cardtiers.json
// (tools/export_cardtiers.py); every number on this page is that file's. No counter is shown per card.
// A language change rebuilds the page from the same state (view, tab, filters, search).

import { h, $, $$, icon, fmtInt, pct, pct1, dec, reducedMotion } from "./util.js?v=68682df7d6";
import { searchField, announcer, terms, hasAll, nameHay } from "./search.js?v=68682df7d6";
import { DB, loadCardTiers, loadRanking, loadFacets } from "./data.js?v=68682df7d6";
import { on, getLang } from "./store.js?v=68682df7d6";
import { cardName, otherName, chip, L, elName, raName } from "./cards.js?v=68682df7d6";
import { disclosure, filterChip, setChip, cascade, band, segmented, chromeBottom, CURVE } from "./ui.js?v=68682df7d6";
import { buildIndex, fromQuery, toQuery, passes as facetPasses, noFilter, filterCount } from "./facetmodel.js?v=68682df7d6";
import { facetFilters, ownAddress, writeAddress, hashTab } from "./facets.js?v=68682df7d6";
import { t, tx } from "./i18n.js?v=68682df7d6";
import { changeOf, glyph, patchTag, patchDetail, oldNumbersNote, provBanner, suggestedTalent, methodSection } from "./patch.js?v=68682df7d6";
import { textNodes, hideTip, tipButton } from "./cardtext.js?v=68682df7d6";
import { deckStrip } from "./deckstrip.js?v=68682df7d6";

// a tier's class on the card tier scale; "out" is the row of the cards with no deck in the view
const TC = { "S+": "sp", S: "s", A: "a", B: "b", C: "c", D: "d", E: "e", out: "out" };
// the switch's order: every game of the patch first (the default, every card judged), then the ranking's two stages in the Deck
// tier list's order; VIEWS keeps the ones cardtiers.json has (`views`)
const ORDER = ["all", "race", "top"];
let VIEWS = ORDER;
const VK = { all: "ct.vAll", top: "ct.vTop", race: "ct.vRace" };
const TIPK = { all: "ct.vAllTip", top: "ct.vTopTip", race: "ct.vRaceTip" };
// a view's word in the address (#card-tiers/<word>, #card-tiers/<word>-details); the default view has none. "race" is kept for the
// Tournament, so the links shared since 2026-10-24 still open it; #card-tiers alone, the Final's until 2026-10-25, opens the default
const WORD = { all: "all", race: "race", top: "final" };
const thumb = (c) => `assets/thumbs/s/${c.key}.webp`;

let root, T, TIERS, rows = [];
const S = { view: "all", tab: "list", q: "", tier: new Set(), sort: "score", filtersOpen: false };
let ui = {};
// the card filters, the Codex's own (facets.js): FS their state, IX the index of every card, F the component on the page
let FS = null, IX = null, F = null;
const TRIGGERS = [["el", ["el"]], ["ra", ["ra"]], ["hit", ["hit"]], ["gen", ["gen"]], ["fx", ["fx"]], ["tox", ["tox"]], ["tgt", ["tgt"]],
  ["num", ["num"]], ["more", ["pc"]]];

export async function mount(el) {
  root = el;
  // ranking.json names the run and its AI in the banner
  [T] = await Promise.all([loadCardTiers(), loadRanking(), loadFacets()]);
  TIERS = T.tiers.concat(["out"]);
  VIEWS = ORDER.filter((v) => T.views.includes(v));
  IX = buildIndex(DB.cards, DB.facets);
  // the filters live in the address while this tab is shown (?fx=temporality,reset#card-tiers), as on the Codex
  FS = fromQuery(hashTab() === "card-tiers" ? location.search : "", IX);
  S.q = FS.q;
  ownAddress("card-tiers", () => toQuery({ ...FS, q: S.q }, IX));
  // the view and the tab live in the address: #card-tiers (the default view, All games), #card-tiers/race (Tournament),
  // #card-tiers/final (Final), each with "-details" for the Details tab (#card-tiers/details for the default's); the addresses of
  // earlier versions (competitive) open the default view
  const start = (location.hash.split("/")[0] === "#card-tiers" && location.hash.split("/")[1]) || "";
  // whole words only: a card key in the address (#card-tiers/<key>, a card view) never picks a view
  const w = /^(all|race|final)(?=-|$)/.exec(start);
  const byWord = Object.fromEntries(Object.entries(WORD).map(([v, k]) => [k, v]));
  S.view = w && VIEWS.includes(byWord[w[1]]) ? byWord[w[1]] : T.default_view;
  S.tab = /(^|-)details$/.test(start) ? "details" : "list";
  wireOnce();
  build();
  // the one load sequence of this tab: the first time it is shown, the tier rows on screen arrive in rank order
  cascade(root, () => [...ui.list.children]);
  on("lang", () => { S.filtersOpen = ui.fbtn.getAttribute("aria-expanded") === "true"; if (F) F.destroy(); build(); });
  // the tab is left: a pinned card closes, so it is not waiting there when the visitor comes back
  window.addEventListener("hashchange", () => hidePop(true));
}

const rec = (x, v = S.view) => x.r[v];
const tierOf = (x, v = S.view) => rec(x, v).tier || "out";
// All games prints whole percentages: its ranges are several points wide, so a decimal would claim a precision it does not have.
// A small figure (another view's, beside the big one) is whole too, as the Deck tier list's (The Big Figure Rule)
const fig = (s, v = S.view) => (s == null ? "—" : v === "all" ? pct(s, 0) : pct1(s));
const small = (s) => (s == null ? "—" : pct(s, 0));
// the views other than `v`, in the switch's order
const others = (v) => VIEWS.filter((o) => o !== v);
const decksWord = (n, v) => t(v === "top" ? "ct.decksTop" : v === "race" ? "ct.decksRace" : "ct.decksN", { n, top: T.decks.top });
// a view's one-word name ("All games", "Tournament", "Final") and the row of the cards it does not rank ("Not in the Final", "Not
// in the Tournament"; All games ranks every card)
const viewName = (v) => t(VK[v], { n: T.decks.top });
const outName = (v) => t(v === "top" ? "ct.outTop" : "ct.outRace", { n: T.decks.top });
// All games: the card's likely range (cardtiers.json `ci95`, whole points: "likely 73–81%") and the quiet caveat of a card whose
// best decks only the fast AI played (`evidence` "screen")
const pts = (p) => Math.round(p * 100);
const range = (r, key = "ct.range") => (r.ci95 ? t(key, { lo: pts(r.ci95[0]), hi: pts(r.ci95[1]) }) : "");
const rough = (r) => !!r && r.evidence === "screen";
const gamesM = () => t("num.million", { n: dec(T.all.games / 1e6, 1), count: T.all.games / 1e6 });
/** All games: the tiers a card's likely range spans ("likely D–S"), or null when it stays in the card's own tier. A bound's tier is
 * the tier of the best-placed card whose figure it reaches (the cards' own tiers in the file, by place), so the words soften the
 * letter where the ranges overlap the tier lines. */
let ALLDESC = null;
function tierAt(p) {
  if (!ALLDESC) ALLDESC = T.cards.map((c) => c.all).filter((a) => a && a.tier).sort((a, b) => b.score - a.score);
  return (ALLDESC.find((a) => a.score <= p) || ALLDESC[ALLDESC.length - 1]).tier;
}
function tierSpan(r, key = "ct.tierSpan") {
  if (!r || !r.ci95 || !r.tier) return null;
  const a = tierAt(r.ci95[0]), b = tierAt(r.ci95[1]);
  return a === r.tier && b === r.tier ? null : t(key, { a, b });
}

/** This tab's part of the footer's Method section (patch.js methodSection, #method-card-tiers): what each view measures (in the
 * switch's order), what the ranges say, why All games is not the Final's scale, the rough estimates, the tiers, the cards with no
 * deck in the top, what a tier says, the AI's caveat. Every number comes from cardtiers.json. */
function method() {
  const out = T.cards_total - T.placed.top, top = T.decks.top;
  const sh = T.tier_shares.map((s) => pct(s, 0));
  const nRough = T.cards.filter((r) => r.all && rough(r.all)).length;
  const per = {
    all: () => [
      h("li", tx("ct.mAll", { n: T.best, opp: T.all.opponents, games: gamesM() })),
      h("li", tx("ct.mRanges")),
      h("li", tx("ct.mField")),
      nRough ? h("li", tx("ct.mRough", { n: nRough })) : null,
    ],
    race: () => [h("li", tx("ct.mRace", { n: T.best, decks: fmtInt(T.decks.race), opp: T.race.opponents, k: Math.round(T.race.prior_games) }))],
    top: () => [h("li", tx("ct.mTop", { n: T.best, opp: T.top.opponents, top }))],
  };
  methodSection("card-tiers", [
    h("ul.vinfo-l", [
      ...VIEWS.flatMap((v) => per[v]()),
      h("li", tx("ct.mFew", { n: T.best, top })),
      h("li", tx("ct.mTiers", { sp: sh[0], s: sh[1], a: sh[2], b: sh[3], c: sh[4], d: sh[5], e: sh[6] })),
      h("li", tx("ct.mOut", { n: out, top })),
      h("li", tx(VIEWS.includes("all") ? "ct.mReadsAdd" : "ct.mReads")),
      h("li", t("rk.limit.plan_decks")),
    ]),
  ]);
}

// ---------------------------------------------------------------- page
function build() {
  hidePop(true);
  ui = {};
  roving = null;
  rows = T.cards.map((r, i) => ({ i, c: r.card, r, ix: IX.cards.get(r.card.key) }));
  ui.announce = h("p.sr", { "aria-live": "polite" });
  ui.list = h("div.ct-list", { id: "ct-list", tabindex: "-1" });
  ui.pop = h("div.ct-pop#ct-pop", { "aria-hidden": "true" });
  ui.tbody = h("tbody");
  root.replaceChildren(
    h("div.vhead.ct-head", [
      h("h1", t("ct.h1")),
      // the card tiers come from the temporary deck ranking's run: the same one-line banner as the views that list its decks, its
      // link opening this tab's part of the footer's Method section
      T.final ? null : provBanner("card-tiers"),
    ]),
    toolbar(),
    filtersRegion(),
    ui.fstatus,
    findRow(),
    ui.announce,
    h("section.ct-view", { id: "ct-view-list", role: "tabpanel", "aria-labelledby": "ct-tab-list" }, [
      h("h2.sr", t("ct.vTiers")),
      ui.list,
      ui.pop,
    ]),
    details(),
  );
  method();
  tierRows();
  icons();
  wireList();
  tableRows();
  place();
  renderTable();
  const tab = S.tab;
  S.tab = "list";
  if (tab === "details") setTab("details", false, true);
  else applyFilters();
}

function toolbar() {
  // the view switch: the site's one segmented control (ui.js), as the Deck tier list's
  ui.viewSeg = segmented(VIEWS.map((v) => [v, viewName(v)]), S.view, (v) => setView(v), t("ct.viewAria"));
  // each segment's title is its view's method in one line
  ui.viewSeg.el.querySelectorAll("button").forEach((b) => {
    b.title = t(TIPK[b.dataset.v], { n: T.best, opp: T.all ? T.all.opponents : T.race.opponents, games: T.all ? gamesM() : "" });
  });
  // the Codex's Filters button: the filters glyph, the word, the count of the filters on (cyan, as on the Codex), the chevron
  ui.fbtn = h("button.btn.ghost.disc.ct-fbtn", { type: "button", "aria-controls": "ct-filters", title: t("ct.filtersTitle") },
    [icon("filters"), h("span", t("ct.filters")), h("span.fbar-n.ct-fn"), icon("chevron")]);
  ui.tabs = [["list", t("ct.vTiers")], ["details", t("ct.vDetails")]].map(([v, label]) => h("button", {
    type: "button", role: "tab", id: "ct-tab-" + v, "aria-controls": "ct-view-" + v, "aria-selected": String(v === "list"), tabindex: v === "list" ? null : "-1",
    onclick: () => setTab(v),
    onkeydown: (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); setTab(S.tab === "list" ? "details" : "list", true); } },
  }, label));
  ui.bar = band(h("div.ct-bar", [
    ui.viewSeg.el,
    h("div.ct-bar-r", [ui.fbtn, h("div.seg.ct-tabs", { role: "tablist", "aria-label": t("ct.view") }, ui.tabs)]),
  ]));
  return ui.bar;
}

/** The card filters (facets.js, the Codex's own): from 760px the "Filters" disclosure holds their triggers, each opening its
 * popover; on a phone the button opens them in the bottom sheet. Like the search, they keep only the matching cards and the rows
 * that hold one. Under the toolbar, while a filter is on, one status line as on the Codex: the count, the active filters, and
 * "Clear filters". */
function filtersRegion() {
  F = facetFilters({
    id: "ct", index: IX, S: FS, triggers: TRIGGERS, patch: DB.patch,
    items: () => rows.map((x) => x.ix), opts: () => ({ text: (ix) => hasAll(nameHay(ix.c), TS) }),
    shown: () => rows.filter(matches).length,
    onChange: () => applyFilters(), sentenceClear: false,
  });
  ui.fcount = h("p.ct-fcount", { "aria-live": "polite" });
  ui.clear = h("button.btn.ghost.ct-clear", { type: "button", disabled: true, title: t("ct.clearOff"), onclick: clearAll }, t("ct.clear"));
  ui.fstatus = h("div.ct-fstatus", { hidden: true }, [h("div.tb-q", [ui.fcount, F.sentence]), ui.clear]);
  const region = h("div", { id: "ct-filters" }, h("div.collapse-in", h("div.ct-filters", [F.bar])));
  // on a phone the button opens the sheet instead of the disclosure (its listener comes first and stops the toggle)
  ui.fbtn.addEventListener("click", (e) => { if (matchMedia("(max-width: 759px)").matches) { e.stopImmediatePropagation(); F.openSheet(); } }, { capture: true });
  // the region clips while it opens or closes; once open it lets a trigger's popover reach over the rows below
  const settle = () => region.classList.toggle("settled", region.classList.contains("open"));
  region.addEventListener("transitionend", (e) => { if (e.target === region) settle(); });
  disclosure(ui.fbtn, region, { open: S.filtersOpen, onToggle: (o) => { if (!o) { F.close(); region.classList.remove("settled"); } else if (reducedMotion()) settle(); } });
  if (S.filtersOpen) settle();
  return region;
}

// ---------------------------------------------------------------- tier rows and card icons
function tierRows() {
  ui.rows = {};
  ui.rowN = {};
  ui.rail = {};
  ui.list.replaceChildren(...TIERS.map((tr) => {
    const out = tr === "out";
    const id = "ct-t-" + TC[tr];
    ui.rowN[tr] = h("span.ct-tl-n");
    ui.outWord = out ? h("span.ct-tl-word") : ui.outWord;
    // the cards the top does not rank are all ranked in the race: the row opens with the way there, above its icons
    const cards = h("div.ct-cards", [
      out ? h("div.ct-go-w", h("button.btn.ghost.ct-go", { type: "button", onclick: () => setView("race") }, [t("ct.goRace"), icon("arrow")])) : null,
      h("p.ct-empty", t("ct.empty")),
    ]);
    ui.rows[tr] = cards;
    ui.rail[tr] = h("div.ct-tl-in", [out ? ui.outWord : h("span.ct-tl-k", [h("span.sr", t("tl.tier", { tier: "" })), tr]),
      h("span.sr", t("ui.comma")), ui.rowN[tr]]);
    return h("div.ct-row" + (out ? ".ct-out" : ""), { role: "group", "aria-labelledby": id }, [h("div.ct-tl.tc-" + TC[tr], { id }, ui.rail[tr]), cards]);
  }));
}

function icons() {
  for (const x of rows) {
    x.ic = h("button.ct-ic", { type: "button", "data-i": x.i, "aria-expanded": "false", "aria-controls": "ct-pop", tabindex: "-1" }, [
      h("img", { class: "ct-ic-art", loading: "lazy", decoding: "async", alt: "", width: 112, height: 160, src: thumb(x.c) }),
      h("i.ct-ic-orb.sp-el-" + x.c.element, { "aria-hidden": "true" }),
      // no patch mark on the icon (one marker less per card, owner 2026-10-18 "pas trop surchargé"): the change is in the
      // icon's label, the preview, the pinned card and the Details row
    ]);
  }
}

/** Puts every icon in its row for the view on screen: inside a tier the highest figure first; the cards with no deck in the view
 * by their race figure (every card has one), so the strongest of them lead their row. */
function place() {
  const v = S.view;
  ui.order = Object.fromEntries(TIERS.map((tr) => [tr, []]));
  rows.forEach((x) => ui.order[tierOf(x)].push(x));
  const key = (x) => (rec(x).score != null ? rec(x).score : -1);
  TIERS.forEach((tr) => ui.order[tr].sort((p, q) => key(q) - key(p) || (q.r.race.score || 0) - (p.r.race.score || 0)));
  for (const tr of TIERS) {
    const row = ui.rows[tr], empty = row.querySelector(".ct-empty");
    ui.order[tr].forEach((x) => row.insertBefore(x.ic, empty));
    row.classList.toggle("is-empty", ui.order[tr].length === 0);
  }
  ui.outWord.textContent = outName(v);
  // the last row only shows when it holds cards (every card played the race)
  ui.rows.out.parentElement.classList.toggle("ct-row-none", ui.order.out.length === 0);
  for (const x of rows) x.ic.setAttribute("aria-label", label(x));
  rove(roving && roving.isConnected ? roving : ui.list.querySelector(".ct-ic"));
}

/** One view's words for a reader: "Final: tier S, 56.1%, 9 Final decks.", "All games: tier B, likely tier D to S, 70%, likely
 * between 58 and 78%, 2,953 decks. Rough estimate." or "Final: not in it."; `short` (the views not on screen) leaves out the deck
 * count and the tier span, so a label stays short: "Tournament: tier S+, 79%." */
function viewWords(x, v, short = false) {
  const r = rec(x, v);
  if (!r.tier) return t("ct.sumNone", { view: viewName(v) });
  const fg = short ? small(r.score) : fig(r.score, v), roughTxt = v === "all" && rough(r) ? " " + t("ct.roughSr") : "";
  if (v === "all") {
    return (short ? t("ct.sumAllShort", { view: viewName(v), tier: r.tier, fig: fg, range: range(r, "ct.rangeSr") })
      : t("ct.sumAll", { view: viewName(v), tier: [r.tier, tierSpan(r, "ct.tierSpanSr")].filter(Boolean).join(t("ui.comma")), fig: fg,
        range: range(r, "ct.rangeSr"), decks: decksWord(r.decks, v) })) + roughTxt;
  }
  return short ? t("ct.sumShort", { view: viewName(v), tier: r.tier, fig: fg })
    : t("ct.sumT", { view: viewName(v), tier: r.tier, fig: fg, decks: decksWord(r.decks, v) });
}

// a card's words in every view, the one on screen first in full, the others short
const summary = (x) => [cardName(x.c) + ".", viewWords(x, S.view), ...others(S.view).map((o) => viewWords(x, o, true))].join(" ");

// the icon's label: its name, then every view, the one on screen first
function label(x) {
  return summary(x)
    + (changeOf(x.c) ? t("ui.sep") + t("pc." + changeOf(x.c).class, { patch: DB.patch }) : "")
    + (x.dim ? t("ct.icDim") : "");
}

/** Switches the view: the icons slide to their new rows (280 ms, transform only) and a pinned card follows its icon. */
function setView(v) {
  if (v === S.view) return;
  const keep = pinned ? cur : null;
  hidePop(true);
  const play = !reducedMotion() && S.tab === "list";
  const moving = play ? [...rows.map((x) => x.ic), ...Object.values(ui.rail)] : [];
  const first = new Map(moving.map((el) => [el, el.getBoundingClientRect()]));
  S.view = v;
  ui.viewSeg.set(v);
  place();
  if (play) {
    const vh = innerHeight;
    for (const el of moving) {
      const f = first.get(el), l = el.getBoundingClientRect();
      const dx = f.left - l.left, dy = f.top - l.top;
      if (!dx && !dy) continue;
      if ((f.bottom < -200 || f.top > vh + 200) && (l.bottom < -200 || l.top > vh + 200)) continue;   // off screen both ways
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 280, easing: CURVE });
    }
  }
  renderTable();
  applyFilters();
  say(t("ct.sayView", { view: viewName(v) }));
  saveState();
  if (keep && S.tab === "list") setTimeout(() => showPop(keep, true), play ? 300 : 0);
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

const say = (s) => { ui.announce.textContent = s; };

/** Keeps the view and the tab in the address without a history entry, only while this tab is shown. A card key never collides
 * with these words, so main.js still reads the tab and ignores the rest. */
function saveState() {
  if (location.hash.split("/")[0] !== "#card-tiers") return;
  const parts = [S.view === T.default_view ? "" : WORD[S.view], S.tab === "details" ? "details" : ""].filter(Boolean).join("-");
  const next = "#card-tiers" + (parts ? "/" + parts : "");
  if (location.hash !== next) { try { history.replaceState(history.state, "", next); } catch (e) { /* the address stays as it is */ } }
}

// ---------------------------------------------------------------- filters: dim on the tier rows, hide in the table
let TS = [];                                       // the words of the card search (search.js), set by applyFilters
const found = (x) => hasAll(nameHay(x.c), TS);
const matches = (x) => found(x) && facetPasses(x.ix, FS);
const matchesTier = (x) => !S.tier.size || S.tier.has(tierOf(x));

function applyFilters() {
  TS = terms(S.q);
  const nOn = filterCount(FS) + (FS.tal ? 0 : 1);   // the search has its own field, outside the filters
  const on_ = TS.length > 0 || nOn + (S.tab === "details" ? S.tier.size : 0) > 0;
  let shown = 0;
  for (const x of rows) {
    const ok = matches(x);
    if (!!x.dim === ok) { x.dim = !ok; x.ic.classList.toggle("dim", !ok); x.ic.setAttribute("aria-label", label(x)); }
    const okT = ok && matchesTier(x);
    x.tr.hidden = !okT;
    if (S.tab === "list" ? ok : okT) shown++;
  }
  const total = rows.length;
  ui.fcount.textContent = !on_ ? t("ct.countAll", { n: total }) : shown === 0
    ? t(S.tab === "list" ? "ct.countNone" : "ct.countNoneT", { total })
    : t("ct.countSome", { n: shown, total });
  // every chip of the filters counts the cards it would show with the other groups on (facets.js)
  F.refresh();
  const counts = {};
  rows.forEach((x) => { if (matches(x)) { const tr = tierOf(x); counts[tr] = (counts[tr] || 0) + 1; } });
  // the last chip names the view's own row of unranked cards; in a view that ranks every card it stays, disabled, saying why
  const ranksAll = T.placed[S.view] >= T.cards_total;
  for (const c of ui.tierChips) {
    if (c.id === "out") {
      c.label = S.view === "all" ? t("ct.outAll") : outName(S.view);
      c.el.querySelector(".chip-l").textContent = c.label;
    }
    setChip(c, counts[c.id] || 0, S.tier.has(c.id), t("filter.show", { label: c.label }),
      c.id === "out" && ranksAll ? t("ct.outNone", { view: viewName(S.view) }) : t("ct.tierChipOff"));
  }
  const fn = ui.fbtn.querySelector(".ct-fn");
  fn.textContent = nOn ? fmtInt(nOn) : "";
  ui.fstatus.hidden = !(nOn > 0 || (S.tab === "details" && S.tier.size > 0));
  ui.fbtn.title = nOn ? t("ct.filtersOn", { n: nOn }) : t("ct.filtersTitle");
  // row counts follow the filters: "2 of 7 cards" while some cards of the row are hidden. A search or a filter keeps only the
  // matching cards and the rows that hold one, so the matches sit right under the toolbar (on a phone too; the card filters
  // can leave a dozen cards of 127, too few to find among dimmed icons). Clearing them brings every row and card back.
  const finding = TS.length > 0 || !noFilter(FS);
  root.classList.toggle("ct-finding", finding);
  for (const tr of TIERS) {
    const all = ui.order[tr], k = all.filter(matches).length;
    ui.rowN[tr].textContent = k === all.length ? t("ct.cards", { n: all.length }) : t("ct.cardsOf", { k, n: all.length });
    ui.rows[tr].parentElement.hidden = finding && k === 0;
  }
  ui.list.hidden = finding && shown === 0 && S.tab === "list";
  ui.clear.disabled = !on_;
  ui.clear.title = t(on_ ? "ct.clearOn" : "ct.clearOff");
  ui.dtEmpty.hidden = !(S.tab === "details" && shown === 0);
  paintFind();
  writeAddress();
}

/** Clear filters: the chips, and the search too (the Details view's empty state uses it to show every card again). */
function clearAll() {
  Object.assign(FS, fromQuery("", IX));
  S.tier.clear();
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

// a tier chip; the cards with no deck in the view get a dash chip, its words for a reader and as its title
const tchip = (tr) => (tr === "out"
  ? h("span.ct-tchip.tc-out", { title: outName(S.view) },
    [h("span", { "aria-hidden": "true" }, "–"), h("span.sr", outName(S.view))])
  : h("span.ct-tchip.tc-" + TC[tr], tr));
const tierWord = (x) => (rec(x).tier ? t("ct.tierN", { tier: rec(x).tier }) : outName(S.view));

/** The cards the search finds, whatever the rarity and element filters (they have their own count). Up to three are named, each
 * with its tier in the view on screen, so the line answers "which tier?" before the eye finds the card. */
function paintFind() {
  if (!TS.length) { ui.findSay.replaceChildren(); ui.findVoice.say(""); return; }
  const hits = rows.filter(found);
  const clear = h("button.btn.ghost.find-clear", { type: "button", onclick: () => { S.q = ""; ui.search.set(""); applyFilters(); ui.search.input.focus(); } }, t("find.clear"));
  let line, voice;
  if (!hits.length) { line = [t("find.noCard", { q: S.q.trim() }), clear]; voice = t("find.noCard", { q: S.q.trim() }); }
  else if (hits.length <= 3) {
    line = tx("find.cards", { n: hits.length, cards: h("span.find-cards", hits.map((x) =>
      h("span.find-hit", [chip(x.c), h("span", { title: tierWord(x) }, tchip(tierOf(x)))]))) });
    voice = t("find.cards", { n: hits.length, cards: hits.map((x) => `${cardName(x.c)} (${tierWord(x)})`).join(", ") });
  } else { line = [t("find.cardsN", { n: hits.length, total: rows.length })]; voice = line[0]; }
  ui.findSay.replaceChildren(...line);
  ui.findVoice.say(voice);
}

/** Enter in the search: focus moves to the first matching card of the tier rows (its preview shows; Enter pins it). */
function jumpToFirst() {
  if (!TS.length || S.tab !== "list") return;
  const x = TIERS.flatMap((tr) => ui.order[tr]).find(matches);
  if (!x) return;
  x.ic.scrollIntoView({ block: "center", behavior: "auto" });
  rove(x.ic);
  x.ic.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- the card preview (hover, focus, tap) and pinned card
let cur = null, pinned = false, hoverT = 0, restoring = false;
// where the open card was placed: its top from its icon's top, so it follows the icon when the page scrolls
let anchor = { dy: 0 };
const sheet = matchMedia("(max-width: 759px)");
const M = 16;      // the card's air to the window's edges and the toolbar
/** The top of the room the card may take on screen: under the header and the toolbar, wherever the toolbar sits (stuck under
 * the header, or still in the page above the rows). The card never sits over the toolbar, nor under it. The phone's bottom
 * sheet is a layer of its own over the page (the toolbar does not stick there): it only keeps clear of the header. */
const roomTop = () => (sheet.matches ? chromeBottom() : Math.max(chromeBottom(), ui.bar ? ui.bar.getBoundingClientRect().bottom : 0));

/**
 * The preview and the pinned card share one body: the header with the tier chip and its place; the view's figure big with its
 * deck count (All games: its likely range beside it, its decks and games under it, and the rough-estimate caveat), the other
 * views' figures small under it, each with its one-word label; the strip of the card's decks in the view with its axis and key.
 * The pinned card adds what the patch changed, the average contribution (All games), the talent and "Show the card"; the preview
 * says how to get them. A card with no deck in the view: no chip, its words instead of the figure, the strip of a view where it
 * plays, named.
 */
function popContent(x, full) {
  const c = x.c, v = S.view, r = rec(x);
  // without a deck in the view, the strip of the first view (in the switch's order) where the card plays
  const alt = r.decks ? null : others(v).find((o) => rec(x, o).decks);
  return [
    h("div.ct-pop-h", [
      h("img.ct-pop-art", { alt: "", width: 48, height: 69, src: thumb(c) }),
      h("div", [
        h("div.ct-pop-name", { lang: getLang(), translate: "no" }, cardName(c)),
        otherName(c) !== cardName(c) ? h("div.ct-pop-sub", { translate: "no" }, otherName(c)) : null,
        h("div.ct-pop-sub", `${raName(c.rarity)}, ${elName(c.element)}`),
        patchTag(c),
      ]),
      // the tier large, its place under it, and in All games the tiers its likely range spans ("likely D–S"), so the letter never
      // claims more than the range allows
      r.tier ? h("div.ct-pop-tier", [tchip(r.tier), h("span", t("ct.rankOf", { r: r.rank, m: T.placed[v] })),
        v === "all" && tierSpan(r) ? h("span.ct-span", tierSpan(r)) : null]) : null,
    ]),
    // under a filter, why this card matched it (the Codex's lines)
    whyLines(x),
    // pinned: what the patch changed, and that the numbers below predate it
    full && patchDetail(c) ? h("p.ct-pop-pc", patchDetail(c)) : null,     // showPop drops the empty slots
    // the card tiers' own patch: a card the patch changed was measured after the change when it is the card data's
    full ? oldNumbersNote(c, T.patch) : null,
    h("div.ct-pop-fig", [
      // the view's figure big; without a deck in the view, its words instead of a bare dash. All games: its likely range beside
      // it (the figure never stands without it), its decks and their games under it
      !r.decks ? h("div.ct-pop-big.none", h("b", outName(v)))
        : v === "all" ? h("div.ct-pop-big", [h("b", fig(r.score, v)), h("span.ct-pop-ci", range(r))])
          : h("div.ct-pop-big", [h("b", fig(r.score, v)), h("span", decksWord(r.decks, v))]),
      v === "all" && r.decks ? h("p.ct-pop-basis", t("ct.basisAll", { n: T.best, decks: r.decks, games: r.games })) : null,
      // the other views small (whole points, The Big Figure Rule), each led by its tier chip: the figures are measured against
      // different decks, so the chip says where the card stands there (its name leads the line, so its deck count does not
      // repeat it). All games small keeps its likely range in place of its deck count: its figure never stands without it
      ...others(v).map((o) => {
        const ro = rec(x, o);
        return h("p.ct-pop-other", [h("span", viewName(o)), ro.tier ? tchip(ro.tier) : null,
          ro.decks ? [h("b", small(ro.score)), h("span", o === "all" ? range(ro) : t("ct.decksN", { n: ro.decks }))] : h("span", t("ct.noDeck"))]);
      }),
    ]),
    // a card whose best decks only the fast AI played: its All games figure is a rough estimate, said right under the figures
    // (in the other views, under the small All games line)
    rough(x.r.all) && (v === "all" || others(v).includes("all"))
      ? h("p.dnote.ct-rough", [icon("info"), h("span", t(v === "all" ? "ct.rough" : "ct.roughAll"))]) : null,
    // pinned, All games: the second reading, the card's average contribution, one small line after the figures
    full && v === "all" ? addLine(r) : null,
    // the strip of the view on screen, or, without a deck there, the strip of a view where the card plays, named
    r.decks ? h("div.ct-pop-st", deckStrip(r, v, T, { axis: true, key: true }))
      : alt ? h("div.ct-pop-st", [h("p.ct-pop-stv", viewName(alt)), deckStrip(rec(x, alt), alt, T, { axis: true, key: true })]) : null,
    full ? null : h("p.ct-pop-more", t("ct.popMore")),
    full ? talentBlock(x) : null,
  ];
}

/** The pinned card's second reading in All games (cardtiers.json `additive`): the card's average contribution, what an average
 * deck of the pool gains or loses with the card in place of an average card (the lab's definition: `additive.score` against
 * `reference.all`, the pool's average deck), in points, signed and coloured as the site's other contributions (the card dialog's
 * "With and against"), and its place among the cards. Small: the tier reads its best decks, this reads the card on its own. It
 * explains itself with the page's tooltip (tipButton, as the Deck tier list's figures do), which gives both win rates. */
function addLine(r) {
  const a = r.additive, ref = T.reference && T.reference.all;
  if (!a || ref == null) return null;
  const d = (a.score - ref) * 100, place = t("ct.rankOf", { r: a.rank, m: T.placed.all });
  const delta = (d >= 0.05 ? "+" : d <= -0.05 ? "−" : "") + dec(Math.abs(d), 1);
  const [btn, desc] = tipButton("button.ct-add", t("ct.addK"),
    [h("span.ct-add-k", t("ct.addK")),
      h("span.ct-add-v" + (d >= 0.05 ? ".up" : d <= -0.05 ? ".down" : ""), [delta, h("span.ct-add-u", " " + t("cm.pts"))]),
      h("span.ct-add-r", place)],
    t("ct.addTip", { ref: pct1(ref), opp: T.all.opponents, fig: pct1(a.score), range: range(a), delta, place }));
  return h("div.ct-pop-add", [btn, desc]);
}

function whyLines(x) {
  if (noFilter(FS) || !matches(x)) return null;
  const lines = F.reasonsFor(x.ix);
  return lines.length ? h("div.ct-pop-why", lines) : null;
}

/**
 * The card's talent: the suggested one (cards.json `suggested_talent`, tagged "Suggested") when the card data has one, else the
 * talent the card played in the run's decks (cardtiers.json `talent`, tagged "Tested"); its name and in-game text. A card
 * with neither has no block.
 */
function talentBlock(x) {
  const c = x.c, s = suggestedTalent(c);
  const tl = s ? s.tl : x.r.talent != null ? c.talents[x.r.talent] : null;
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
  b.setAttribute("aria-expanded", String(pinned));
  b.classList.toggle("pinned", pinned);            // only a pinned icon is ringed (selected); a hover preview is not
  if (pinned) say(summary(x));
  const room = roomTop();
  // never taller than the room under the header and the toolbar (it scrolls inside when it has more)
  pop.style.setProperty("--room", Math.round(innerHeight - room - 2 * M) + "px");
  if (sheet.matches) { pop.style.left = pop.style.top = ""; pop.classList.add("on"); return; }     // a bottom sheet on a phone, placed by the stylesheet
  const rc = b.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const left = Math.max(M, Math.min(rc.left + rc.width / 2 - pw / 2, vw - pw - M));
  // below the card, else above it, else as low as it fits under the toolbar
  let top = rc.bottom + 12, oy = "0";
  if (top + ph > innerHeight - M) {
    if (rc.top - 12 - ph >= room + M) { top = rc.top - 12 - ph; oy = "100%"; }
    else top = Math.max(room + M, innerHeight - M - ph);
  }
  anchor = { dy: top - rc.top };
  pop.style.left = left + scrollX + "px";
  pop.style.top = top + scrollY + "px";
  pop.style.setProperty("--ox", (rc.left + rc.width / 2 - left) + "px");
  pop.style.setProperty("--oy", oy);
  pop.classList.add("on");
}

/**
 * The page scrolls under an open card: it follows its icon, and never rides over the sticky toolbar nor slides under it: where
 * the scroll would carry it into the toolbar it holds 16px under it while its icon slides by, and follows again on the way back.
 * It goes once its icon is under the toolbar or off the window (nothing left to point at); focus inside it returns to the icon
 * without scrolling. The phone's bottom sheet stays put and only keeps clear of the header. (The card paints under the toolbar,
 * so a frame the scroll draws before this runs never shows it over the toolbar.)
 */
function follow() {
  const pop = ui.pop;
  if (!cur || !pop || !pop.classList.contains("on")) return;
  // every read first, then the writes (no layout forced between them)
  const room = roomTop(), rc = cur.getBoundingClientRect(), y = scrollY;
  const top = Math.max(room + M, rc.top + anchor.dy);
  if (!sheet.matches && (rc.bottom <= room || rc.top >= innerHeight)) {
    const b = cur, inside = pop.contains(document.activeElement);
    hidePop(true);
    if (inside) { restoring = true; b.focus({ preventScroll: true }); restoring = false; }
    return;
  }
  pop.style.setProperty("--room", Math.round(innerHeight - room - 2 * M) + "px");
  if (!sheet.matches) pop.style.top = top + y + "px";
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
  // focus shows the preview, except when focus comes back after closing the pinned card, and never as a sheet on a phone
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
  // in the scroll's own frame (before it is painted), so the card never shows a frame over the toolbar
  addEventListener("scroll", follow, { passive: true });
}

// ---------------------------------------------------------------- details table
function details() {
  ui.tierChips = TIERS.map((tr) => {
    const lab = tr === "out" ? outName("top") : t("ct.tierN", { tier: tr });
    const c = filterChip(tr === "out" ? lab : tr, "ct-sw tc-" + TC[tr], () => { if (S.tier.has(tr)) S.tier.delete(tr); else S.tier.add(tr); applyFilters(); });
    return Object.assign(c, { id: tr, label: lab });
  });
  const sort = h("select", { id: "ct-sort", onchange: (e) => { S.sort = e.target.value; renderTable(); applyFilters(); } }, [
    ["score", "ct.sScore"], ["decks", "ct.sDecks"],
  ].map(([v, k]) => h("option", { value: v }, t(k))));
  sort.value = S.sort;
  ui.dtEmpty = h("div.ct-dt-empty", { hidden: true }, [h("p", t("ct.dtEmpty")),
    h("button.btn", { type: "button", onclick: () => { clearAll(); ui.clear.focus(); } }, t("ct.clear"))]);
  // the strip's column names its axis once, in the header, for the view on screen
  ui.thAxis = h("span.ct-th-ax");
  return h("section.ct-view", { id: "ct-view-details", role: "tabpanel", "aria-labelledby": "ct-tab-details", hidden: true }, [
    h("h2.sr", t("ct.vDetails")),
    h("div.ct-dt-tools", [
      h("div.ct-fgroup", { role: "group", "aria-label": t("ct.gTier") }, [h("span.ct-fgroup-l", { "aria-hidden": "true" }, t("ct.gTier")), ...ui.tierChips.map((c) => c.el)]),
      h("label.field.select.ct-sort", [h("span.sr", t("ct.sortBy")), sort, icon("chevron")]),
    ]),
    h("div.ct-dt", [
      h("table.ct-tab", [
        h("caption.sr", t("ct.tCaption")),
        h("colgroup", ["rank", "card", "tier", "fig", "where"].map((k) => h("col.ct-w-" + k))),
        h("thead", h("tr", [
          h("th", { scope: "col", title: t("ct.thRank") }, "#"), h("th", { scope: "col" }, t("ct.thCard")), h("th", { scope: "col" }, t("ct.thTier")),
          h("th", { scope: "col" }, t("ct.thFig")),
          h("th.ct-c-where", { scope: "col" }, [h("span", t("ct.thWhere")), ui.thAxis]),
        ])),
        ui.tbody,
      ]),
      ui.dtEmpty,
    ]),
  ]);
}

function rowCells(x) {
  const c = x.c, v = S.view, r = rec(x);
  const isRough = v === "all" && rough(r);
  return [
    h("td.ct-c-rank", h("span.ct-rk", r.rank ? String(r.rank) : "—")),
    h("td.ct-c-card", h("button.ct-cardc", { type: "button", "data-card": c.key, title: t("card.show", { name: cardName(c) }) }, [
      h("img", { class: "ct-th", loading: "lazy", decoding: "async", alt: "", width: 36, height: 51, src: thumb(c) }),
      h("span", [h("span.ct-nm", { translate: "no" }, [r.rank ? h("span.ct-rkm", `#${r.rank} `) : null, cardName(c)]), h("span.ct-nm-sub", `${raName(c.rarity)}, ${elName(c.element)}`),
        changeOf(c) ? h("span.ct-nm-pc", [glyph(c), t("pc." + changeOf(c).class, { patch: DB.patch })]) : null]),
    ])),
    // the tier chip; in All games the tiers its likely range spans under it ("likely D–S")
    h("td.ct-c-tier", { "data-label": t("ct.thTier") }, [tchip(tierOf(x)), v === "all" && tierSpan(r) ? h("span.ct-span", tierSpan(r)) : null]),
    h("td.ct-c-fig", { "data-label": t("ct.thFig") }, [
      h("span.ct-fig", [fig(r.score, v), " ", h("span.ct-fig-n", r.decks ? decksWord(r.decks, v) : "")]),
      // All games: the likely range under the figure, and the rough-estimate caveat (its sentence as its title and for a reader)
      v === "all" && r.ci95 ? h("span.ct-ci", range(r)) : null,
      isRough ? h("span.ct-rough-s", { title: t("ct.rough") }, [icon("info"), h("span", { "aria-hidden": "true" }, t("ct.roughShort")), h("span.sr", t("ct.rough"))]) : null,
      // the other views small (whole points), on one line; All games with its range, and its caveat's glyph when it applies
      h("span.ct-cap", others(v).map((o) => {
        const ro = rec(x, o);
        if (!ro.decks) return h("span", [viewName(o), " ", h("span.ct-cap-none", t("ct.noDeck"))]);
        return h("span", [viewName(o), " ", h("b", small(ro.score)), o === "all" ? [" ", range(ro, "ct.rangeShort")] : null,
          o === "all" && rough(ro) ? h("span.ct-cap-rough", { title: t("ct.rough") }, [icon("info"), h("span.sr", t("ct.rough"))]) : null]);
      })),
    ]),
    // the strip is decorative: a reader hears the figures in the column before it
    h("td.ct-c-where", { "data-label": t("ct.thWhere") }, deckStrip(r, v, T)),
  ];
}

function tableRows() { for (const x of rows) { x.tr = h("tr"); ui.tbody.append(x.tr); } }

// the view's figure breaks every tie, then the race figure (every card has one)
function renderTable() {
  const v = S.view;
  ui.thAxis.replaceChildren(deckStrip({ rates: [], hist: [], tier: null, decks: 0 }, v, T, { axis: true, track: false }));
  for (const x of rows) x.tr.replaceChildren(...rowCells(x));
  const sc = (x) => (rec(x).score != null ? rec(x).score : -1);
  const by = (p, q) => (S.sort === "decks" ? rec(q).decks - rec(p).decks : 0) || sc(q) - sc(p) || (q.r.race.score || 0) - (p.r.race.score || 0);
  for (const x of rows.slice().sort(by)) ui.tbody.append(x.tr);
}

// ---------------------------------------------------------------- tabs: Tiers | Details
function setTab(v, focus, init) {
  if (v === S.tab) return;
  hidePop(true);
  S.tab = v;
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
  if (!reducedMotion() && !init) shown.animate([{ opacity: 0, transform: "translateY(24px)" }, { opacity: 1, transform: "none" }], { duration: 280, easing: CURVE });
  applyFilters();
  if (init) return;
  say(t(v === "list" ? "ct.sayTiers" : "ct.sayDetails"));
  saveState();
}
