// Card tier list tab: every card by its strength over all the decks it played in (the lab's card fit on the Elo list's games,
// since 2026-10-28; the benchmark-based views before it are in the git history). A card's strength is the chance that a deck
// holding it, at its default talent, beats the same deck holding an average card instead; tiers S to F group the cards whose
// range reaches their tier's first card's, and a card with too few games at its default talent is "Not enough data"
// (no tier, no figure). Classic tier rows on the ground. Hover, focus or tap previews a card: its tier and place, its strength
// big with its range, its games and decks, the strip of that range on the page's one axis (js/deckstrip.js); a click
// pins it with its talent and a link to the card dialog; the open card keeps clear of the sticky toolbar (roomTop, follow). A
// Details view lists every card in a sortable table. The method is in the footer's Method section (patch.js methodSection), not
// at the top. Data: data/cardtiers.json (tools/export_cardtiers.py); every number on this page is that file's.
// A language change rebuilds the page from the same state (tab, filters, search).

import { h, $, $$, icon, fmtInt, pct, reducedMotion } from "./util.js?v=aa3c01bc6a";
import { searchField, announcer, terms, hasAll, nameHay } from "./search.js?v=aa3c01bc6a";
import { DB, loadCardTiers, loadFacets } from "./data.js?v=aa3c01bc6a";
import { on, getLang } from "./store.js?v=aa3c01bc6a";
import { cardName, otherName, chip, L, elName, raName } from "./cards.js?v=aa3c01bc6a";
import { disclosure, filterChip, setChip, cascade, band, chromeBottom, CURVE } from "./ui.js?v=aa3c01bc6a";
import { buildIndex, fromQuery, toQuery, passes as facetPasses, noFilter, filterCount } from "./facetmodel.js?v=aa3c01bc6a";
import { facetFilters, ownAddress, writeAddress, hashTab } from "./facets.js?v=aa3c01bc6a";
import { t, tx } from "./i18n.js?v=aa3c01bc6a";
import { changeOf, glyph, patchTag, patchDetail, oldNumbersNote, provBanner, methodSection } from "./patch.js?v=aa3c01bc6a";
import { textNodes, hideTip } from "./cardtext.js?v=aa3c01bc6a";
import { deckStrip, TC } from "./deckstrip.js?v=aa3c01bc6a";

// the row of the cards with too few games for a tier ("Not enough data"), after the tiers
const FEW = "few";
const thumb = (c) => `assets/thumbs/s/${c.key}.webp`;

let root, T, TIERS, rows = [];
const S = { tab: "list", q: "", tier: new Set(), sort: "score", filtersOpen: false };
let ui = {};
// the card filters, the Codex's own (facets.js): FS their state, IX the index of every card, F the component on the page
let FS = null, IX = null, F = null;
const TRIGGERS = [["el", ["el"]], ["ra", ["ra"]], ["hit", ["hit"]], ["gen", ["gen"]], ["fx", ["fx"]], ["tox", ["tox"]], ["tgt", ["tgt"]],
  ["num", ["num"]], ["more", ["pc"]]];

export async function mount(el) {
  root = el;
  [T] = await Promise.all([loadCardTiers(), loadFacets()]);
  TIERS = T.tiers.concat([FEW]);
  IX = buildIndex(DB.cards, DB.facets);
  // the filters live in the address while this tab is shown (?fx=temporality,reset#card-tiers), as on the Codex
  FS = fromQuery(hashTab() === "card-tiers" ? location.search : "", IX);
  S.q = FS.q;
  ownAddress("card-tiers", () => toQuery({ ...FS, q: S.q }, IX));
  // the tab lives in the address: #card-tiers (the tiers), #card-tiers/details. The views of earlier versions ("all", "race",
  // "final", each with "-details") open the one view, rewritten
  const start = (location.hash.split("/")[0] === "#card-tiers" && location.hash.split("/")[1]) || "";
  // whole words only: a card key in the address (#card-tiers/<key>, a card view) never picks a tab
  const old = /^(all|race|final)(?=-|$)/.test(start);
  S.tab = /^((all|race|final)-)?details$/.test(start) ? "details" : "list";
  wireOnce();
  build();
  if (old) saveState();
  // the one load sequence of this tab: the first time it is shown, the tier rows on screen arrive in rank order
  cascade(root, () => [...ui.list.children]);
  on("lang", () => { S.filtersOpen = ui.fbtn.getAttribute("aria-expanded") === "true"; if (F) F.destroy(); build(); });
  // the tab is left: a pinned card closes, so it is not waiting there when the visitor comes back
  window.addEventListener("hashchange", () => hidePop(true));
}

const tierOf = (x) => x.r.tier || FEW;
// the strength in whole points, never without its range (its ranges are several points wide: a decimal would claim a
// precision it does not have)
const pts = (p) => Math.round(p * 100);
const fig = (r) => pct(r.score, 0);
const range = (r, key = "ct.range") => t(key, { lo: pts(r.range[0]), hi: pts(r.range[1]) });
const place = (r) => t("ct.rankOf", { r: r.rank, m: T.placed });
const basis = (r) => t("ct.basis", { games: fmtInt(r.games), decks: t("ct.decksN", { n: r.decks }) });
const fewWords = (r) => t("ct.fewBasis", { games: fmtInt(r.games), min: fmtInt(T.min_games) });

/** This tab's part of the footer's Method section (patch.js methodSection, #method-card-tiers): what the strength is and where it
 * comes from, its range, the tiers, the cards with not enough data, the AI's caveat. Every number comes from cardtiers.json. */
function method() {
  const few = T.cards_total - T.placed;
  methodSection("card-tiers", [
    h("ul.vinfo-l", [
      h("li", tx("ct.mStrength", { games: fmtInt(T.games), ai: h("span", { translate: "no" }, T.pilot) })),
      h("li", tx("ct.mRange", { cov: pct(T.coverage, 1) })),
      h("li", tx("ct.mTiers")),
      few ? h("li", tx("ct.mFew", { min: fmtInt(T.min_games), n: few })) : null,
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
      // the card tiers come from the temporary ranking's games: the same one-line banner as the Deck tier list, its link opening
      // this tab's part of the footer's Method section
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
  placeIcons();
  renderTable();
  const tab = S.tab;
  S.tab = "list";
  if (tab === "details") setTab("details", false, true);
  else applyFilters();
}

function toolbar() {
  // the Codex's Filters button: the filters glyph, the word, the count of the filters on (cyan, as on the Codex), the chevron
  ui.fbtn = h("button.btn.ghost.disc.ct-fbtn", { type: "button", "aria-controls": "ct-filters", title: t("ct.filtersTitle") },
    [icon("filters"), h("span", t("ct.filters")), h("span.fbar-n.ct-fn"), icon("chevron")]);
  ui.tabs = [["list", t("ct.vTiers")], ["details", t("ct.vDetails")]].map(([v, label]) => h("button", {
    type: "button", role: "tab", id: "ct-tab-" + v, "aria-controls": "ct-view-" + v, "aria-selected": String(v === "list"), tabindex: v === "list" ? null : "-1",
    onclick: () => setTab(v),
    onkeydown: (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); setTab(S.tab === "list" ? "details" : "list", true); } },
  }, label));
  // one view since 2026-10-28: the bar holds the Tiers | Details tabs, then the filters
  ui.bar = band(h("div.ct-bar", [
    h("div.seg.ct-tabs", { role: "tablist", "aria-label": t("ct.view") }, ui.tabs),
    ui.fbtn,
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
    const few = tr === FEW;
    const id = "ct-t-" + TC[tr];
    ui.rowN[tr] = h("span.ct-tl-n");
    const cards = h("div.ct-cards", [h("p.ct-empty", t("ct.empty"))]);
    ui.rows[tr] = cards;
    ui.rail[tr] = h("div.ct-tl-in", [few ? h("span.ct-tl-word", t("ct.few")) : h("span.ct-tl-k", [h("span.sr", t("tl.tier", { tier: "" })), tr]),
      h("span.sr", t("ui.comma")), ui.rowN[tr]]);
    return h("div.ct-row" + (few ? ".ct-few" : ""), { role: "group", "aria-labelledby": id }, [h("div.ct-tl.tc-" + TC[tr], { id }, ui.rail[tr]), cards]);
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

/** Puts every icon in its row: inside a tier by place; the cards with not enough data by their games, most first. The last row
 * only shows when it holds cards. */
function placeIcons() {
  ui.order = Object.fromEntries(TIERS.map((tr) => [tr, []]));
  rows.forEach((x) => ui.order[tierOf(x)].push(x));
  TIERS.forEach((tr) => ui.order[tr].sort((p, q) => (p.r.rank != null ? p.r.rank - q.r.rank : q.r.games - p.r.games)));
  for (const tr of TIERS) {
    const row = ui.rows[tr], empty = row.querySelector(".ct-empty");
    ui.order[tr].forEach((x) => row.insertBefore(x.ic, empty));
    row.classList.toggle("is-empty", ui.order[tr].length === 0);
  }
  ui.rows[FEW].parentElement.classList.toggle("ct-row-none", ui.order[FEW].length === 0);
  for (const x of rows) x.ic.setAttribute("aria-label", label(x));
  rove(roving && roving.isConnected ? roving : ui.list.querySelector(".ct-ic"));
}

/** A card's words for a reader: "Verdelune. Tier S, strength 65%, likely between 63 and 66%, #1 of 124." or "… Not enough data:
 * 370 games at its default talent, 400 needed." */
function summary(x) {
  const r = x.r;
  return cardName(x.c) + ". " + (r.tier ? t("ct.sum", { tier: r.tier, fig: fig(r), range: range(r, "ct.rangeSr"), place: place(r) })
    : t("ct.sumFew", { games: fmtInt(r.games), min: fmtInt(T.min_games) }));
}

// the icon's label: its words, then what the patch changed, and whether a filter leaves it out
function label(x) {
  return summary(x)
    + (changeOf(x.c) ? t("ui.sep") + t("pc." + changeOf(x.c).class, { patch: DB.patch }) : "")
    + (x.dim ? t("ct.icDim") : "");
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

/** Keeps the tab in the address without a history entry, only while this tab is shown. A card key never collides with "details",
 * so main.js still reads the tab and ignores the rest. */
function saveState() {
  if (location.hash.split("/")[0] !== "#card-tiers") return;
  const next = "#card-tiers" + (S.tab === "details" ? "/details" : "");
  if (location.hash !== next) { try { history.replaceState(history.state, "", next); } catch (e) { /* the address stays as it is */ } }
}

// ---------------------------------------------------------------- filters: hide on the tier rows and in the table
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
  for (const c of ui.tierChips) setChip(c, counts[c.id] || 0, S.tier.has(c.id), t("filter.show", { label: c.label }), t("ct.tierChipOff"));
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

// a tier chip; a card with not enough data gets a dash chip, its words for a reader and as its title
const tchip = (tr) => (tr === FEW
  ? h("span.ct-tchip.tc-few", { title: t("ct.few") }, [h("span", { "aria-hidden": "true" }, "–"), h("span.sr", t("ct.few"))])
  : h("span.ct-tchip.tc-" + TC[tr], tr));
const tierWord = (x) => (x.r.tier ? t("ct.tierN", { tier: x.r.tier }) : t("ct.few"));

/** The cards the search finds, whatever the rarity and element filters (they have their own count). Up to three are named, each
 * with its tier, so the line answers "which tier?" before the eye finds the card. */
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
 * The preview and the pinned card share one body: the header with the tier chip and its place; the strength big with its likely
 * range beside it, its games and decks under them; the strip of that range on the page's axis, with its key. A card with not
 * enough data: no chip, its words instead of the figure, and no strip. The pinned card adds what the patch changed, the talent it
 * was measured with and "Show the card"; the preview says how to get them.
 */
function popContent(x, full) {
  const c = x.c, r = x.r;
  return [
    h("div.ct-pop-h", [
      h("img.ct-pop-art", { alt: "", width: 48, height: 69, src: thumb(c) }),
      h("div", [
        h("div.ct-pop-name", { lang: getLang(), translate: "no" }, cardName(c)),
        otherName(c) !== cardName(c) ? h("div.ct-pop-sub", { translate: "no" }, otherName(c)) : null,
        h("div.ct-pop-sub", `${raName(c.rarity)}, ${elName(c.element)}`),
      ]),
      // the tier large, its place under it
      r.tier ? h("div.ct-pop-tier", [tchip(r.tier), h("span", place(r))]) : null,
      // the patch tag on its own row under the names, as wide as the names and the tier: never under the place's words
      patchTag(c),
    ]),
    // under a filter, why this card matched it (the Codex's lines)
    whyLines(x),
    // pinned: what the patch changed, and that the numbers below predate it
    full && patchDetail(c) ? h("p.ct-pop-pc", patchDetail(c)) : null,     // showPop drops the empty slots
    // the card tiers' own patch: a card the patch changed was measured after the change when it is the card data's
    full ? oldNumbersNote(c, T.patch) : null,
    h("div.ct-pop-fig", r.tier
      ? [h("div.ct-pop-big", [h("b", fig(r)), h("span.ct-pop-ci", range(r))]), h("p.ct-pop-basis", basis(r))]
      : [h("div.ct-pop-big.none", h("b", t("ct.few"))), h("p.ct-pop-basis", fewWords(r))]),
    r.tier ? h("div.ct-pop-st", deckStrip(r, T, { axis: true, key: true })) : null,
    full ? null : h("p.ct-pop-more", t("ct.popMore")),
    full ? talentBlock(x) : null,
  ];
}

function whyLines(x) {
  if (noFilter(FS) || !matches(x)) return null;
  const lines = F.reasonsFor(x.ix);
  return lines.length ? h("div.ct-pop-why", lines) : null;
}

/** The talent the card's strength was measured with (cardtiers.json `talent`: its default talent in our AI's games), tagged
 * "Tested": its name and in-game text. */
function talentBlock(x) {
  const c = x.c, tl = c.talents[x.r.talent];
  if (!tl) return null;
  return h("div.ct-pop-sugg", [
    h("div.ct-pop-sugg-h", [h("i.ab-talent", { "aria-hidden": "true" }), h("span", { lang: getLang() }, L(tl, "name")),
      h("span.tag.sugg", { title: t("ct.testedTip") }, t("ct.tested"))]),
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
    const lab = tr === FEW ? t("ct.few") : t("ct.tierN", { tier: tr });
    const c = filterChip(tr === FEW ? lab : tr, "ct-sw tc-" + TC[tr], () => { if (S.tier.has(tr)) S.tier.delete(tr); else S.tier.add(tr); applyFilters(); });
    return Object.assign(c, { id: tr, label: lab });
  });
  const sort = h("select", { id: "ct-sort", name: "ct-sort", autocomplete: "off", onchange: (e) => { S.sort = e.target.value; renderTable(); applyFilters(); } }, [
    ["score", "ct.sScore"], ["decks", "ct.sDecks"],
  ].map(([v, k]) => h("option", { value: v }, t(k))));
  sort.value = S.sort;
  ui.dtEmpty = h("div.ct-dt-empty", { hidden: true }, [h("p", t("ct.dtEmpty")),
    h("button.btn", { type: "button", onclick: () => { clearAll(); ui.clear.focus(); } }, t("ct.clear"))]);
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
          // the strip's column names its axis once, in the header
          h("th.ct-c-where", { scope: "col" }, [h("span", t("ct.thWhere")), h("span.ct-th-ax", deckStrip(null, T, { axis: true, track: false }))]),
        ])),
        ui.tbody,
      ]),
      ui.dtEmpty,
    ]),
  ]);
}

function rowCells(x) {
  const c = x.c, r = x.r;
  return [
    h("td.ct-c-rank", h("span.ct-rk", r.rank ? String(r.rank) : "—")),
    h("td.ct-c-card", h("button.ct-cardc", { type: "button", "data-card": c.key, title: t("card.show", { name: cardName(c) }) }, [
      h("img", { class: "ct-th", loading: "lazy", decoding: "async", alt: "", width: 36, height: 51, src: thumb(c) }),
      h("span", [h("span.ct-nm", { translate: "no" }, [r.rank ? h("span.ct-rkm", `#${r.rank} `) : null, cardName(c)]), h("span.ct-nm-sub", `${raName(c.rarity)}, ${elName(c.element)}`),
        changeOf(c) ? h("span.ct-nm-pc", [glyph(c), t("pc." + changeOf(c).class, { patch: DB.patch })]) : null]),
    ])),
    h("td.ct-c-tier", { "data-label": t("ct.thTier") }, tchip(tierOf(x))),
    // the strength, its range under it, then its decks; a card with not enough data says so, with its games
    h("td.ct-c-fig", { "data-label": t("ct.thFig") }, r.tier
      ? [h("span.ct-fig", fig(r)), h("span.ct-ci", range(r)), h("span.ct-fig-n", t("ct.decksN", { n: r.decks }))]
      : [h("span.ct-fig.none", t("ct.few")), h("span.ct-fig-n", t("ct.gamesN", { n: r.games }))]),
    // the strip is decorative: a reader hears the figures in the column before it
    h("td.ct-c-where", { "data-label": t("ct.thWhere") }, r.tier ? deckStrip(r, T, { axis: true }) : null),
  ];
}

function tableRows() { for (const x of rows) { x.tr = h("tr"); ui.tbody.append(x.tr); } }

// the strength, then the place; the cards with not enough data last, by their games
function renderTable() {
  for (const x of rows) x.tr.replaceChildren(...rowCells(x));
  const sc = (x) => (x.r.score != null ? x.r.score : -1);
  const by = (p, q) => (S.sort === "decks" ? q.r.decks - p.r.decks : 0) || sc(q) - sc(p) || q.r.games - p.r.games;
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
