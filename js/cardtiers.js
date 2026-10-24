// Card tier list tab: every card ranked by the best decks it plays in (the deck ranking's final decks, each weighted by its place,
// the variants of a better deck counting less), as classic tier rows S+ to E plus "Not in a final deck". Hover, focus or tap
// previews the card: its tier and rank, the strip of the final decks holding it (js/deckstrip.js: #1 on the left, the top 30
// lifted) and four figures; a click pins it with its talent and links to the card dialog. A Details view lists every card in a
// sortable table. Data: data/cardtiers.json (tools/export_cardtiers.py, from ranking.json and ranking-decks.json; every number
// on this page is that file's). No counter is shown per card.
// A language change rebuilds the page from the same state (view, filters, search).

import { h, $, $$, icon, fmtInt, dec, reducedMotion } from "./util.js?v=a34256d2f5";
import { searchField, announcer, terms, hasAll, nameHay } from "./search.js?v=a34256d2f5";
import { DB, loadCardTiers, loadRanking } from "./data.js?v=a34256d2f5";
import { on, getLang } from "./store.js?v=a34256d2f5";
import { cardName, otherName, chip, L, ELEMENTS, RARITIES, elName, raName } from "./cards.js?v=a34256d2f5";
import { disclosure, filterChip, setChip, cascade, band } from "./ui.js?v=a34256d2f5";
import { t, tx } from "./i18n.js?v=a34256d2f5";
import { changeOf, glyph, patchTag, patchDetail, oldNumbersNote, introLine, provBanner, suggestedTalent } from "./patch.js?v=a34256d2f5";
import { textNodes, hideTip } from "./cardtext.js?v=a34256d2f5";
import { deckStrip } from "./deckstrip.js?v=a34256d2f5";

// a tier's class on the card tier scale; "out" is the row of the cards in no final deck
const TC = { "S+": "sp", S: "s", A: "a", B: "b", C: "c", D: "d", E: "e", out: "out" };
const thumb = (c) => `assets/thumbs/s/${c.key}.webp`;
// two decimals: one would print a 3.99 of tier S as "4.0", the S+ cut
const score = (v) => dec(v, 2);
const place = (p) => t("ct.place", { p });

let root, T, TIERS, rows = [];
const S = { view: "list", q: "", ra: new Set(), el: new Set(), tier: new Set(), sort: "score", filtersOpen: false };
let ui = {};

export async function mount(el) {
  root = el;
  // ranking.json names the run's version and AI in the banner
  [T] = await Promise.all([loadCardTiers(), loadRanking()]);
  TIERS = T.tiers.concat(["out"]);
  // the view lives in the address: #card-tiers, #card-tiers/details (the two measurements' addresses of 2026-10-24,
  // #card-tiers/competitive and #card-tiers/competitive-details, open the same views)
  const start = (location.hash.split("/")[0] === "#card-tiers" && location.hash.split("/")[1]) || "";
  // whole words only: a card key in the address (#card-tiers/<key>, a card view) never picks a view
  S.view = /(^|-)details$/.test(start) ? "details" : "list";
  wireOnce();
  build();
  // the one load sequence of this tab: the first time it is shown, the tier rows on screen arrive in rank order
  cascade(root, () => [...ui.list.children]);
  on("lang", () => { S.filtersOpen = ui.fbtn.getAttribute("aria-expanded") === "true"; build(); });
  // the tab is left: a pinned card closes, so it is not waiting there when the visitor comes back
  window.addEventListener("hashchange", () => hidePop(true));
}

const tierOf = (x) => x.r.tier || "out";

/**
 * What "About the numbers" opens: why the ranking is temporary, then the method as a short list (the score, the variants, the
 * tiers, the cards in no final deck, what a tier says) and the AI's caveat. Every number comes from cardtiers.json.
 */
function methodLines() {
  const d = T.decks, half = T.half_life;
  // the cuts under 1 read as fractions (½, ¼, ⅛), as the weights in the line above
  const FRAC = { 0.5: "½", 0.25: "¼", 0.125: "⅛" };
  const cut = (k) => FRAC[T.tier_cuts[k]] || dec(T.tier_cuts[k], Number.isInteger(T.tier_cuts[k]) ? 0 : 2);
  return [
    T.final ? null : h("p", tx("rk.mWhy")),
    h("ul.vinfo-l", [
      h("li", tx("ct.mFinal", { n: d.final, m: d.race })),
      h("li", tx("ct.mScore", { h: half, p2: 1 + half, p4: 1 + 2 * half })),
      h("li", tx("ct.mFamily")),
      h("li", tx("ct.mTiers", { a: cut(0), b: cut(1), c: cut(2), d: cut(3), e: cut(4), f: cut(5), h: half })),
      h("li", tx("ct.mOut", { n: T.cards_total - T.placed, m: d.race })),
      h("li", tx("ct.mReads")),
      h("li", t("rk.limit.plan_decks")),
    ]),
  ];
}

// ---------------------------------------------------------------- page
function build() {
  hidePop(true);
  ui = {};
  roving = null;
  rows = T.cards.map((r, i) => ({ i, c: r.card, r }));
  ui.announce = h("p.sr", { "aria-live": "polite" });
  ui.list = h("div.ct-list", { id: "ct-list", tabindex: "-1" });
  ui.pop = h("div.ct-pop#ct-pop", { "aria-hidden": "true" });
  ui.tbody = h("tbody");
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
  renderTable();
  const view = S.view;
  S.view = "list";
  if (view === "details") setView("details", false, true);
  else applyFilters();
}

function toolbar() {
  ui.fbtn = h("button.btn.ghost.disc.ct-fbtn", { type: "button", "aria-controls": "ct-filters", title: t("ct.filtersTitle") },
    [h("span", t("ct.filters")), h("span.tab-n.ct-fn", { hidden: true }), icon("chevron")]);
  ui.tabs = [["list", t("ct.vTiers")], ["details", t("ct.vDetails")]].map(([v, label]) => h("button", {
    type: "button", role: "tab", id: "ct-tab-" + v, "aria-controls": "ct-view-" + v, "aria-selected": String(v === "list"), tabindex: v === "list" ? null : "-1",
    onclick: () => setView(v),
    onkeydown: (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); setView(S.view === "list" ? "details" : "list", true); } },
  }, label));
  return band(h("div.ct-bar", [
    h("div.seg.ct-seg.ct-tabs", { role: "tablist", "aria-label": t("ct.view") }, ui.tabs),
    ui.fbtn,
  ]));
}

function filtersRegion() {
  const toggle = (set, v) => { if (set.has(v)) set.delete(v); else set.add(v); applyFilters(); };
  ui.raChips = RARITIES.map((id) => Object.assign(filterChip(raName(id), "sp-gem-" + id, () => toggle(S.ra, id)), { id, label: raName(id) }));
  ui.elChips = ELEMENTS.map((id) => Object.assign(filterChip(elName(id), "sp-el-" + id, () => toggle(S.el, id)), { id, label: elName(id) }));
  ui.fcount = h("p.ct-fcount", { "aria-live": "polite" });
  ui.clear = h("button.btn.ghost.ct-clear", { type: "button", disabled: true, title: t("ct.clearOff"), onclick: clearAll }, t("ct.clear"));
  const group = (key, kids) => h("div.ct-fgroup", { role: "group", "aria-label": t(key) }, [h("span.ct-fgroup-l", { "aria-hidden": "true" }, t(key)), ...kids]);
  const region = h("div", { id: "ct-filters" }, h("div.collapse-in", h("div.ct-filters", { role: "group", "aria-label": t("ct.filters") }, [
    group("ct.gRarity", ui.raChips.map((c) => c.el)),
    group("ct.gElement", ui.elChips.map((c) => c.el)),
    h("div.ct-fstatus", [ui.fcount, ui.clear]),
  ])));
  disclosure(ui.fbtn, region, { open: S.filtersOpen });
  return region;
}

// ---------------------------------------------------------------- tier rows and card icons
function tierRows() {
  ui.rows = {};
  ui.rowN = {};
  ui.list.replaceChildren(...TIERS.map((tr) => {
    const out = tr === "out";
    const id = "ct-t-" + TC[tr];
    ui.rowN[tr] = h("span.ct-tl-n");
    const cards = h("div.ct-cards", h("p.ct-empty", t("ct.empty")));
    ui.rows[tr] = cards;
    return h("div.ct-row", { role: "group", "aria-labelledby": id }, [
      h("div.ct-tl.tc-" + TC[tr], { id }, h("div.ct-tl-in", [out ? h("span.ct-tl-word", t("ct.out")) : h("span.ct-tl-k", [h("span.sr", t("tl.tier", { tier: "" })), tr]), ui.rowN[tr]])),
      cards,
    ]);
  }));
}

function icons() {
  for (const x of rows) {
    x.ic = h("button.ct-ic", { type: "button", "data-i": x.i, "aria-expanded": "false", "aria-controls": "ct-pop", tabindex: "-1" }, [
      h("img", { class: "ct-ic-art", loading: "lazy", decoding: "async", alt: "", width: 112, height: 160, src: thumb(x.c) }),
      h("i.ct-ic-orb.sp-el-" + x.c.element, { "aria-hidden": "true" }),
      // no patch mark on the icon (one marker less per card, owner 2026-10-18 "pas trop surchargé"): the change is in the
      // icon's label, the hover preview, the pinned card and the Details row
    ]);
  }
  // inside a tier, the highest score first; the cards in no final deck by the race decks that held them
  ui.order = Object.fromEntries(TIERS.map((tr) => [tr, []]));
  rows.forEach((x) => ui.order[tierOf(x)].push(x));
  TIERS.forEach((tr) => ui.order[tr].sort((p, q) => (q.r.score || 0) - (p.r.score || 0) || q.r.race - p.r.race));
  for (const tr of TIERS) {
    const row = ui.rows[tr], empty = row.querySelector(".ct-empty");
    ui.order[tr].forEach((x) => row.insertBefore(x.ic, empty));
    row.classList.toggle("is-empty", ui.order[tr].length === 0);
  }
  for (const x of rows) x.ic.setAttribute("aria-label", label(x));
  rove(ui.list.querySelector(".ct-ic"));
}

function label(x) {
  const r = x.r;
  return (r.tier ? t("ct.icLabel", { name: cardName(x.c), tier: r.tier, top: r.top, n: T.decks.top, finals: r.finals })
    : t("ct.icOut", { name: cardName(x.c) }))
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

/** Keeps the view in the address without a history entry, only while this tab is shown. A card key never collides with
 * "details", so main.js still reads the tab and ignores the rest. */
function saveState() {
  if (location.hash.split("/")[0] !== "#card-tiers") return;
  const next = "#card-tiers" + (S.view === "details" ? "/details" : "");
  if (location.hash !== next) { try { history.replaceState(history.state, "", next); } catch (e) { /* the address stays as it is */ } }
}

// ---------------------------------------------------------------- filters: dim on the tier rows, hide in the table
let TS = [];                                       // the words of the card search (search.js), set by applyFilters
const found = (x) => hasAll(nameHay(x.c), TS);
const matches = (x) => found(x) && (!S.ra.size || S.ra.has(x.c.rarity)) && (!S.el.size || S.el.has(x.c.element));
const matchesTier = (x) => !S.tier.size || S.tier.has(tierOf(x));

function applyFilters() {
  TS = terms(S.q);
  const on_ = TS.length > 0 || S.ra.size + S.el.size + (S.view === "details" ? S.tier.size : 0) > 0;
  let shown = 0;
  for (const x of rows) {
    const ok = matches(x);
    if (!!x.dim === ok) { x.dim = !ok; x.ic.classList.toggle("dim", !ok); x.ic.setAttribute("aria-label", label(x)); }
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
  rows.forEach((x) => { if (matches(x)) { const tr = tierOf(x); counts[tr] = (counts[tr] || 0) + 1; } });
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
    const all = ui.order[tr], k = all.filter(matches).length;
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

const tchip = (tr) => h("span.ct-tchip.tc-" + TC[tr], tr === "out" ? t("ct.out") : tr);
// the Details column is narrow: there "Not in a final deck" is a dash chip, its words for a reader and as its title
const tchipShort = (tr) => (tr === "out"
  ? h("span.ct-tchip.tc-out.short", { title: t("ct.out") }, [h("span", { "aria-hidden": "true" }, "–"), h("span.sr", t("ct.out"))])
  : tchip(tr));
const tierWord = (x) => (x.r.tier ? t("ct.tierN", { tier: x.r.tier }) : t("ct.out"));

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
  if (!TS.length || S.view !== "list") return;
  const x = TIERS.flatMap((tr) => ui.order[tr]).find(matches);
  if (!x) return;
  x.ic.scrollIntoView({ block: "center", behavior: "auto" });
  rove(x.ic);
  x.ic.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- the card preview (hover, focus, tap) and pinned card
let cur = null, pinned = false, hoverT = 0, restoring = false;
const sheet = matchMedia("(max-width: 759px)");

/**
 * The preview (hover, focus) and the pinned card share one body: the header with the tier chip and its rank, the strip of the
 * card's final decks with its axis and key, then four figures (score, decks in the top 30, final decks, best deck). The pinned
 * card adds what the patch changed, the talent and "Show the card"; the preview says how to get them. A card in no final deck
 * shows the empty track and one line instead of the key and the figures.
 */
function popContent(x, full) {
  const c = x.c, r = x.r, d = T.decks;
  const fig = (v, k, tip) => h("div.ct-pop-fig", { title: tip || null }, [h("b", v), h("span", t(k, { n: d.top }))]);
  return [
    h("div.ct-pop-h", [
      h("img.ct-pop-art", { alt: "", width: 48, height: 69, src: thumb(c) }),
      h("div", [
        h("div.ct-pop-name", { lang: getLang(), translate: "no" }, cardName(c)),
        otherName(c) !== cardName(c) ? h("div.ct-pop-sub", { translate: "no" }, otherName(c)) : null,
        h("div.ct-pop-sub", `${raName(c.rarity)}, ${elName(c.element)}`),
        patchTag(c),
      ]),
      r.tier ? h("div.ct-pop-tier", [tchip(r.tier), h("span", t("ct.rankOf", { r: r.rank, m: T.placed }))]) : null,
    ]),
    // pinned: what the patch changed, and that the numbers below predate it
    full && patchDetail(c) ? h("p.ct-pop-pc", patchDetail(c)) : null,     // showPop drops the empty slots
    // the card tiers' own patch: a card the patch changed was measured after the change when it is the card data's
    full ? oldNumbersNote(c, T.patch) : null,
    h("div.ct-pop-st", deckStrip(r, d, { axis: true, key: !!r.tier })),
    r.tier ? h("div.ct-pop-figs", [
      fig(score(r.score), "ct.figScore", t("ct.fScoreTip", { h: T.half_life })),
      fig(fmtInt(r.top), "ct.figTop"),
      fig(fmtInt(r.finals), "ct.figFinals"),
      fig(place(r.best), "ct.figBest"),
    ]) : h("p.ct-pop-v", tx("ct.vOut", { n: d.final, race: r.race, m: d.race })),
    full ? null : h("p.ct-pop-more", t("ct.popMore")),
    full ? talentBlock(x) : null,
  ];
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
  b.setAttribute("aria-expanded", "true");
  b.classList.toggle("pinned", pinned);            // only a pinned icon is ringed (selected); a hover preview is not
  if (pinned) say(summary(x));
  if (sheet.matches) { pop.style.left = pop.style.top = ""; pop.classList.add("on"); return; }     // a bottom sheet on a phone, placed by the stylesheet
  const rc = b.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  const vw = document.documentElement.clientWidth, m = 16;
  const left = Math.max(m, Math.min(rc.left + rc.width / 2 - pw / 2, vw - pw - m));
  // below the card, else above it, else as low as it fits under the header (it scrolls inside when taller than the window)
  const head = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--chrome-h")) || 64;
  let top = rc.bottom + 12, oy = "0";
  if (top + ph > innerHeight - m) {
    if (rc.top - 12 - ph > head + m) { top = rc.top - 12 - ph; oy = "100%"; }
    else top = Math.max(head + m, innerHeight - m - ph);
  }
  pop.style.left = left + scrollX + "px";
  pop.style.top = top + scrollY + "px";
  pop.style.setProperty("--ox", (rc.left + rc.width / 2 - left) + "px");
  pop.style.setProperty("--oy", oy);
  pop.classList.add("on");
}

function summary(x) {
  const r = x.r;
  return r.tier ? t("ct.sum", { name: cardName(x.c), tier: r.tier, score: score(r.score), top: r.top, n: T.decks.top, finals: r.finals, m: T.decks.final, best: r.best })
    : t("ct.sumOut", { name: cardName(x.c), race: r.race });
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
}

// ---------------------------------------------------------------- details table
function details() {
  ui.tierChips = TIERS.map((tr) => {
    const lab = tr === "out" ? t("ct.out") : t("ct.tierN", { tier: tr });
    const c = filterChip(tr === "out" ? t("ct.out") : tr, "ct-sw tc-" + TC[tr], () => { if (S.tier.has(tr)) S.tier.delete(tr); else S.tier.add(tr); applyFilters(); });
    return Object.assign(c, { id: tr, label: lab });
  });
  const sort = h("select", { id: "ct-sort", onchange: (e) => { S.sort = e.target.value; renderTable(); applyFilters(); } }, [
    ["score", "ct.sScore"], ["top", "ct.sTop"], ["finals", "ct.sFinals"], ["best", "ct.sBest"],
  ].map(([v, k]) => h("option", { value: v }, t(k, { n: T.decks.top }))));
  sort.value = S.sort;
  ui.dtEmpty = h("div.ct-dt-empty", { hidden: true }, [h("p", t("ct.dtEmpty")),
    h("button.btn", { type: "button", onclick: () => { clearAll(); ui.clear.focus(); } }, t("ct.clear"))]);
  const th = (text, title) => h("th", { scope: "col", title }, text);
  // the strip's column names the strip once, with its axis, so the rows need no caption
  const empty = { tier: null, places: [] };
  return h("section.ct-view", { id: "ct-view-details", role: "tabpanel", "aria-labelledby": "ct-tab-details", hidden: true }, [
    h("h2.sr", t("ct.vDetails")),
    h("div.ct-dt-tools", [
      h("div.ct-fgroup", { role: "group", "aria-label": t("ct.gTier") }, [h("span.ct-fgroup-l", { "aria-hidden": "true" }, t("ct.gTier")), ...ui.tierChips.map((c) => c.el)]),
      h("label.field.select.ct-sort", [h("span.sr", t("ct.sortBy")), sort, icon("chevron")]),
    ]),
    h("div.ct-dt", [
      h("table.ct-tab", [
        h("caption.sr", t("ct.tCaption")),
        h("colgroup", ["rank", "card", "tier", "where", "top", "fin", "best"].map((k) => h("col.ct-w-" + k))),
        h("thead", h("tr", [
          th("#", t("ct.thRank")), th(t("ct.thCard")), th(t("ct.thTier"), t("ct.fScoreTip", { h: T.half_life })),
          h("th.ct-c-where", { scope: "col" }, [h("span", t("ct.thWhere")), h("span.ct-th-ax", deckStrip(empty, T.decks, { axis: true, track: false }))]),
          th(t("ct.fTop", { n: T.decks.top })), th(t("ct.fFinals")), th(t("ct.fBest")),
        ])),
        ui.tbody,
      ]),
      ui.dtEmpty,
    ]),
  ]);
}

function rowCells(x) {
  const c = x.c, r = x.r, d = T.decks, rk = r.rank || "—";
  const fig = (v, cap) => [h("span.ct-fig", v), cap ? h("span.ct-cap", cap) : null];
  return [
    h("td.ct-c-rank", h("span.ct-rk", String(rk))),
    h("td.ct-c-card", h("button.ct-cardc", { type: "button", "data-card": c.key, title: t("card.show", { name: cardName(c) }) }, [
      h("img", { class: "ct-th", loading: "lazy", decoding: "async", alt: "", width: 36, height: 51, src: thumb(c) }),
      h("span", [h("span.ct-nm", { translate: "no" }, [r.rank ? h("span.ct-rkm", `#${r.rank} `) : null, cardName(c)]), h("span.ct-nm-sub", `${raName(c.rarity)}, ${elName(c.element)}`),
        changeOf(c) ? h("span.ct-nm-pc", [glyph(c), t("pc." + changeOf(c).class, { patch: DB.patch })]) : null]),
    ])),
    h("td.ct-c-tier", { "data-label": t("ct.thTier") }, h("div.ct-ax-top", [tchipShort(tierOf(x)), r.tier ? h("span.ct-ax-s", score(r.score)) : null])),
    // the strip is decorative: a reader hears what it shows from a hidden line
    h("td.ct-c-where", { "data-label": t("ct.thWhere") }, r.tier
      ? [deckStrip(r, d), h("span.sr", t("ct.stripSr", { top: r.top, n: d.top, finals: r.finals, best: r.best }))]
      : h("span.ct-cap", t("ct.raced", { n: r.race, m: d.race }))),
    h("td.ct-c-top", { "data-label": t("ct.fTop", { n: d.top }) }, fig(fmtInt(r.top), t("ct.ofN", { n: d.top }))),
    h("td.ct-c-fin", { "data-label": t("ct.fFinals") }, fig(fmtInt(r.finals), t("ct.ofN", { n: d.final }))),
    h("td.ct-c-best", { "data-label": t("ct.fBest") }, r.best ? fig(place(r.best)) : h("span.ct-cap", t("ct.none"))),
  ];
}

function tableRows() { for (const x of rows) { x.tr = h("tr"); x.tr.replaceChildren(...rowCells(x)); ui.tbody.append(x.tr); } }

function sortKey(x) {
  const r = x.r;
  switch (S.sort) {
    case "top": return -r.top;
    case "finals": return -r.finals;
    case "best": return r.best || 1e6;
  }
  return 0;
}

// the score breaks every tie (then the race decks, for the cards in no final deck)
function renderTable() {
  const by = (p, q) => sortKey(p) - sortKey(q) || (q.r.score || 0) - (p.r.score || 0) || q.r.race - p.r.race;
  for (const x of rows.slice().sort(by)) ui.tbody.append(x.tr);
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
  applyFilters();
  if (init) return;
  say(t(v === "list" ? "ct.sayTiers" : "ct.sayDetails"));
  saveState();
}
