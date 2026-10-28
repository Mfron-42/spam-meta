// Deck tier list tab: the lab's two deck lists of the game patch (data/deck-lists.json, tools/export_deck_lists.py), one list at
// a time, in this order (the owner, 2026-10-27): "Elo" (the default: the 64 best decks by their Elo from our AI's games) and
// "Speed" (the mean round of a deck's wins). A ranked list, no tier letters and no hidden deck (owner, 2026-10-21). Most
// neighbours are within each other's margin: after its rank, a deck carries its likely place in the list ("likely #1–9", the
// lab's 10th to 90th percentile of its rank), so the list never claims an order it does not know. While the ranking is not final the view says so
// in one line at its top (patch.js provBanner); every explanation lives in the footer's Method section (owner, 2026-10-24), so
// the top of the view is the title, the banner, the switch and the card search.
// Every deck carries its two figures, named like the two lists and in their order, the active list's figure big
// (decklist.js listFigures); each explains itself on hover, focus or a tap, and the Elo names the AI whose games it rests on.
// Under them, the tox the deck bought most (3, the 8 on demand) and its variants (its card set with other talents, which the
// list leaves out). Each deck is its four game cards in board order, each with the talent it plays under it; a card opens the
// card view on that talent. A card search keeps the decks holding a card, "Ready to play" the decks the visitor owns. The list
// lives in the address (#tiers, #tiers/speed). A language change redraws the page and keeps the list, the query, the filter and
// the open tox and variants.

import { h, icon, pct, fmtInt, reducedMotion } from "./util.js?v=813db21b65";
import { DB, loadLists, loadFacets } from "./data.js?v=813db21b65";
import { on, isOwned, ownedCount, getLang } from "./store.js?v=813db21b65";
import { cardName, chip, L } from "./cards.js?v=813db21b65";
import { segmented, scrollToEl, cascade, band, CURVE, disclosure } from "./ui.js?v=813db21b65";
import { t, tx } from "./i18n.js?v=813db21b65";
import { tipButton } from "./cardtext.js?v=813db21b65";
import { findRow, terms, namedCards } from "./search.js?v=813db21b65";
import { introLine, limitParams, provBanner, isMatchupTalent, matchupMark, DECK_TABLE_SHOWN } from "./patch.js?v=813db21b65";
import { paintOwned, deckSlot, listFigures, matchupLine, LISTS } from "./decklist.js?v=813db21b65";

// each list's address: the first (Elo, the default) is the bare #tiers. The addresses of the earlier lists land on Elo and are
// rewritten to its own: "#tiers/top" (Against the top), "#tiers/final" and "#tiers/race" (the ranking before it); the players'
// meta was the bare #tiers.
const SUBS = { elo: "", speed: "speed" };
const OLD_SUBS = ["top", "final", "race", "meta"];
let root, R, list = "elo", query = "", readyOnly = false;
let decks = [], find, seg, readyBtn, banner, listEl, headEl, sayEl, emptyEl;
let toxNames = null;                         // facets.json's tox families by id: the game's tox names (FR/EN)
const openTox = new Set(), openVar = new Set(), allVar = new Set();   // the decks (their index in deck-lists.json) whose 8 tox,
                                                                       // variants or full list of variants are open
const VAR_SHOWN = 5;      // the variants an opened list shows before "Show all N"
const sorts = () => LISTS.filter((k) => R[k] && R[k].rows.length);
const rankOf = (d, l = list) => d[l].rank;

export async function mount(el) {
  root = el;
  // the tox names come from the card search's facets (the site's one naming of the tox); without them the tox line is left out
  const [r, f] = await Promise.all([loadLists(), loadFacets()]);
  R = r;
  // facets.json's tox, plus the shop tox no card holds (deck-lists.json `tox_names`, the client's own names)
  toxNames = f ? new Map([...f.values.tox.map((x) => [x.id, x]),
    ...Object.entries(R.tox_names || {}).map(([id, n]) => [id, { id, name_fr: n.fr, name_en: n.en }])]) : null;
  list = listFromHash() || sorts()[0];
  if (!sorts().includes(list)) { list = sorts()[0]; saveList(); }
  // an older address of a list is rewritten to the list's own (a card key after #tiers/ is left as it is)
  if (location.hash.split("/")[0] === "#tiers" && OLD_SUBS.includes(location.hash.split("/")[1])) saveList();
  render();
  // the one load sequence of this tab: the first time it is shown, the decks on screen arrive in rank order
  cascade(root, () => [...root.querySelectorAll(".deck:not([hidden])")]);
  on("owned", () => { updateBadges(); updateBanner(); applyShown(); });
  on("lang", () => render());
  window.addEventListener("hashchange", () => { const l = listFromHash(); if (l && l !== list && sorts().includes(l)) setList(l, false); });
}

/** Opens the view searched for one card (the card view's "Decks with this card"): its name as written, in the page language. */
export function findCard(key) {
  const c = DB.byKey.get(key);
  if (!c) return;
  query = `"${cardName(c)}"`;
  find.field.set(query);
  applyShown();
}

// ---------------------------------------------------------------- the list in the address
const listFromHash = () => {
  const [tab, sub] = location.hash.replace(/^#/, "").split("/");
  if (tab !== "tiers") return null;
  if (OLD_SUBS.includes(sub)) return "elo";
  return LISTS.find((k) => SUBS[k] === (sub || "")) || null;
};
function saveList() {
  if (location.hash.split("/")[0] !== "#tiers") return;
  const next = "#tiers" + (SUBS[list] ? "/" + SUBS[list] : "");
  if (location.hash !== next) { try { history.replaceState(history.state, "", next); } catch (e) { /* the address stays as it is */ } }
}

function setList(l, save = true) {
  list = l;
  seg.set(l);
  paintList(true);
  if (save) saveList();
}

// ---------------------------------------------------------------- page
function render() {
  if (!ownedCount()) readyOnly = false;
  const prov = !R.final;
  banner = h("div.callout");      // one line on the ground between two hairlines, no panel (DESIGN.md "Collection bar and callout")
  // the list switch: the same segmented control as the Card tier list's (ui.js segmented, DESIGN.md "Sort switch"); each
  // segment's title says its list in one line
  seg = segmented(sorts().map((k) => [k, t("rk.list." + k)]), list, (v) => setList(v), t("rk.listAria"));
  seg.el.querySelectorAll("button").forEach((b) => { b.title = t("rk.listTip." + b.dataset.v, { n: R.elo.rows.length }); });
  readyBtn = h("button.chip.ready", { type: "button", "aria-pressed": "false", hidden: true, onclick: () => { readyOnly = !readyOnly; applyShown(); } }, [h("span.chip-l", t("tl.ready")), h("span.n")]);
  headEl = h("h2.sr", { id: "rk-list-h" });
  sayEl = h("p.sr", { "aria-live": "polite" });          // a change of list is announced (the list itself swaps silently)
  listEl = h("ol.rk-list.cv-rows", { "aria-labelledby": "rk-list-h" });      // drawn near the screen only (views.css)
  // a filter that leaves the list empty says so, with the way back (DESIGN.md "Deck tier list")
  emptyEl = h("p.rk-empty", { hidden: true }, [h("span", t("rk.emptyReady")),
    h("button.btn.ghost", { type: "button", onclick: () => { readyOnly = false; applyShown(); readyBtn.focus(); } }, t("rk.showAll"))]);
  root.replaceChildren(
    h("div.vhead", [
      h("h1", t("tl.h1")),
      // a temporary ranking says so in one line, its link to the footer's Method section (owner, 2026-10-24)
      prov ? provBanner("tiers") : null,
      // the facts line, the method, the two lists and the caveats: the footer (owner, 2026-10-24: no prose above the list)
      ...introLine("tiers", h("p", t("rk.lede", { n: fmtInt(R.elo.rated), ai: R.pilots.full, patch: R.patch })), { method: methodLines(), patch: R.patch, link: !prov }),
    ]),
    // the owned callout, then the switch (it stays under the header while the decks scroll, so the big number always has its
    // name on screen; the Card tier list's band), then the card search right above the list it filters
    banner,
    band(h("div.rk-bar", [sorts().length > 1 ? seg.el : null, readyBtn])),
    findBar(),
    h("section.rk-sec", [headEl, sayEl, listEl, emptyEl]),
    // the way to the overlay: one quiet line after the list, no banner (it promises no download)
    h("p.ov-tease", [h("span", t("tl.ovTease")), " ", h("a.link", { href: "overlay/" }, t("tl.ovLink"))]),
  );
  paintList(false);
}

/** The footer's Method sub-section of this tab: why it is temporary, what the Elo is and which AI played its games, what the
 * likely place says, the speed list, the figures, the tox, the variants, the talents and the caveats. Numbers come from
 * deck-lists.json; no version of the ranking is named (owner, 2026-10-24); the AI is named in its own line. */
function methodLines() {
  const lp = limitParams(R);
  return [
    R.final ? null : h("p", [...tx("rk.mWhy")]),
    h("p", tx("rk.mElo", { ai: R.pilots.full, rated: fmtInt(R.elo.rated), n: R.elo.rows.length, min: R.elo.min_games, mlo: lp.lo, mhi: lp.hi })),
    h("p", tx("rk.mRange")),
    tx("rk.mSpeed", { min: pct(R.speed.min_win_rate, 0), wins: R.speed.min_wins }),
    t("rk.mFigs"),
    // the "+5" sentence only when the decks carry their 8 most bought tox
    tx(R.decks.some((d) => d.tox.top.length > 3) ? "rk.mTox8" : "rk.mTox"),
    tx("rk.mVariants"),
    t("rk.mTalents"),
    R.matchup_talents ? matchupLine() : null,
    h("ul.vinfo-l", R.limits.map((l) => h("li", t("rk.limit." + l, lp)))),
  ];
}

/** The list shown: its hidden heading and its decks. `swap`: the visitor changed the list (a short fade). */
function paintList(swap) {
  const rows = R[list].rows.filter((d) => d.cs.every(Boolean));
  listEl.dataset.list = list;
  headEl.textContent = t("rk.h." + list, { n: rows.length });
  decks = [];
  listEl.replaceChildren(...rows.map((d, i) => deckEl(d, i === 0)));
  updateBadges();
  updateBanner();
  applyShown();
  if (swap) {
    sayEl.textContent = headEl.textContent;
    if (!reducedMotion()) listEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: CURVE });
  }
}

// ---------------------------------------------------------------- card search: the decks that hold a card
function findBar() {
  find = findRow({ id: "tl-q", name: "deck-card", placeholder: t("find.decksPh"), label: t("find.decksAria"), clearLabel: t("cx.clearSearch"), value: query,
    onChange: (v) => { query = v; applyShown(); },
    onEnter: () => { const x = decks.find((k) => !k.el.hidden); if (x && query.trim()) scrollToEl(x.el); } });
  return find.el;
}

// ---------------------------------------------------------------- one deck
function deckEl(d, full) {
  const badge = h("div.obadge", { hidden: true });
  const slots = d.cs.map((c, k) => deckSlot(c, d.talents[k], { full }));
  const e = d[list];
  // quiet facts about the rank in words, never boxes: the deck's likely place in this list ("likely #1–9": the places it takes in
  // 8 of 10 redraws of every figure within its margin; none when it is a single place; a screen reader hears it inside the
  // heading, after the rank); in the speed list, a rank shared on equal rounds
  const rg = e.range && e.range[0] !== e.range[1] ? { lo: e.range[0], hi: e.range[1] } : null;
  const words = [
    rg ? h("span.deck-word.rk-range", { title: t("rk.likelyTip." + list, rg), "aria-hidden": "true" }, t("rk.likely", rg)) : null,
    e.tied ? h("span.deck-word", { title: t("rk.tiedTip.speed") }, t("rk.tied")) : null,
  ];
  const n = R.decks.indexOf(d);
  const el = h("li.deck" + (full ? ".spot" : ""), { id: `deck-${list}-${e.rank}-${decks.length}`, "aria-label": t("tl.rankAria", { rank: e.rank, cards: d.cs.map(cardName).join(", ") }) }, [
    // the heading names the deck too, so a screen reader's list of headings reads the decks (and its likely place)
    h("div.deck-head", [h("h3.rk", [`#${e.rank}`, rg ? h("span.sr", t("rk.likelySr", rg)) : null,
      h("span.sr", " " + d.cs.map(cardName).join(", "))]), ...words, badge]),
    h("div.deck-body", [
      h("div.deck-cards" + (full ? ".full" : ""), slots),
      // the figures, then (after the cards on one column) the tox and the variants
      h("div.deck-facts", [h("div.dfacts", listFigures(d, list)), h("div.dmore", [toxLine(d, n), variantsBlock(d, n)])]),
    ]),
  ]);
  decks.push({ d, cs: d.cs, badge, el, slots });
  return el;
}

/**
 * The tox the deck bought most (DESIGN.md "Tox line"): "Tox" (a word that explains itself), then its 3 most bought, each the
 * rarity gem, the game's name and the share of its games, and "+5" for its 8 (when the export has them). Never an internal id:
 * a tox the site cannot name leaves the line out.
 */
function toxLine(d, n) {
  const T = d.tox, top = T.top;
  if (!toxNames || !top.length || !top.every(([id]) => toxNames.has(id))) return null;
  const lang = getLang();
  const item = ([id, ra, games], more) => {
    const name = L(toxNames.get(id), "name"), share = pct(games / T.games, 0), rarity = t("tx.ra." + ra);
    return h("li.tx", { title: t("tx.title", { name, rarity, share, games: fmtInt(games), n: fmtInt(T.games) }), hidden: more && !openTox.has(n) ? true : null }, [
      h("i.tx-gem", { class: "sp-gem-" + ra, "aria-hidden": "true" }),
      h("span.tx-n", { lang, translate: "no" }, name), h("span.tx-r", { class: "ra-" + ra }, rarity),
      h("span.tx-s", share),
    ]);
  };
  const id = "tx-" + list + "-" + n;
  const items = top.map((x, i) => item(x, i >= 3));
  const ul = h("ul.tx-l", { id, role: "list" }, items);
  const [kb, kd] = tipButton("button.tx-k", t("tx.k"), [h("span", t("tx.k"))], t("tx.tip", { n: fmtInt(T.games) }));
  const extra = top.length - 3;
  if (extra > 0) {
    // the control ends the line of tox, so it follows the last one shown
    const more = h("button.tdisc.tx-more", { type: "button", "aria-controls": id, "aria-expanded": String(openTox.has(n)) });
    ul.append(h("li.tx-mli", more));
    const paint = () => {
      const on = openTox.has(n);
      more.setAttribute("aria-expanded", String(on));
      more.textContent = on ? t("tx.less") : "+" + extra;
      more.setAttribute("aria-label", on ? t("tx.lessAria") : t("tx.moreAria", { n: top.length }));
    };
    more.addEventListener("click", () => {
      const on = !openTox.has(n);
      if (on) openTox.add(n); else openTox.delete(n);
      const fresh = items.slice(3);
      fresh.forEach((li) => { li.hidden = !on; });
      if (on && !reducedMotion()) fresh.forEach((li) => li.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: CURVE }));
      paint();
    });
    paint();
  }
  return h("div.tox", [kb, kd, ul]);
}

/**
 * The deck's variants (DESIGN.md "Variants"): a small disclosure, "3 variants", opening one line per variant, each saying what
 * changes from the listed deck: the card that comes in (its chip and talent) and the one it replaces, or a card's other talent.
 * The variants are the deck's card set with other talents, which the list leaves out (one deck per card set: its best-rated
 * talents); they carry no figure.
 */
function variantsBlock(d, n) {
  if (!d.variants.length) return null;
  const id = "vr-" + list + "-" + n;
  const btn = h("button.tdisc.vr-b", { type: "button", "aria-controls": id }, [h("span", t("vr.btn", { n: d.variants.length })), icon("chevron")]);
  // the first VAR_SHOWN, then "Show all N" at the end of the list (a deck can have 38: a wall otherwise)
  const lines = d.variants.map((v) => variantLine(d, v)).filter(Boolean);
  const ul = h("ul.vr-l", { id: id + "-l", role: "list" }, lines);
  const kids = [ul];
  if (lines.length > VAR_SHOWN) {
    const all = h("button.tdisc.vr-all", { type: "button", "aria-controls": id + "-l" });
    const paint = () => {
      const on = allVar.has(n);
      lines.forEach((li, i) => { li.hidden = !on && i >= VAR_SHOWN; });
      all.setAttribute("aria-expanded", String(on));
      all.textContent = on ? t("vr.fewer") : t("vr.all", { n: lines.length });
    };
    all.addEventListener("click", () => {
      const on = !allVar.has(n);
      if (on) allVar.add(n); else allVar.delete(n);
      paint();
      if (on && !reducedMotion()) lines.slice(VAR_SHOWN).forEach((li) => li.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: CURVE }));
    });
    paint();
    kids.push(all);
  }
  const region = h("div.collapse", { id }, h("div.collapse-in", kids));
  disclosure(btn, region, { open: openVar.has(n), onToggle: (on) => { if (on) openVar.add(n); else openVar.delete(n); } });
  return h("div.vr", [btn, region]);
}

/** A talent in words: the client's talent glyph, its name (its game text as the title) and, for a shield, the matchup mark. */
function talentWord(c, i) {
  const tl = c.talents[i];
  return h("span.vr-t", { title: L(tl, "description") }, [h("i.ab-talent", { "aria-hidden": "true" }),
    h("span", { lang: getLang(), translate: "no" }, L(tl, "name")), isMatchupTalent(c, i) ? matchupMark() : null]);
}

function variantLine(d, v) {
  if (!v.cs.every(Boolean)) return null;
  const tOf = (x, c) => x.talents[x.cs.indexOf(c)];
  const ins = v.cs.filter((c) => !d.cs.includes(c)), outs = d.cs.filter((c) => !v.cs.includes(c));
  const changed = v.cs.filter((c) => d.cs.includes(c) && tOf(v, c) !== tOf(d, c));
  // one sentence per variant, its parts joined by a quiet dot: "<card> <talent> replaces <card> · <card> with <talent>"
  const parts = [];
  ins.forEach((c, k) => parts.push(tx("vr.swap", { card: h("span", [chip(c), talentWord(c, tOf(v, c))]), old: chip(outs[k]) })));
  for (const c of changed) parts.push(tx("vr.talent", { card: chip(c), talent: talentWord(c, tOf(v, c)) }));
  return h("li", parts.flatMap((p, i) => (i ? [h("span.vr-sep", { "aria-hidden": "true" }, "·"), ...p] : p)));
}

// ---------------------------------------------------------------- owned state and filters
function updateBadges() {
  for (const x of decks) x.ready = paintOwned(x.badge, x.cs) === 4;
}

/**
 * Which decks show: the "Ready to play" chip (shown once there is a collection) hides the decks that are not fully owned,
 * and a card search hides the decks that hold no matching card; inside a deck that matches, the other cards dim.
 */
function applyShown() {
  if (!readyBtn) return;
  const any = ownedCount() > 0;
  const ready = decks.filter((x) => x.ready);
  if (!any) readyOnly = false;
  readyBtn.hidden = !any;
  readyBtn.setAttribute("aria-pressed", String(readyOnly));
  readyBtn.querySelector(".n").textContent = String(ready.length);
  readyBtn.disabled = !ready.length && !readyOnly;
  readyBtn.title = t(ready.length ? "tl.readyOn" : "tl.readyOff");
  const ts = terms(query);
  const hits = ts.length ? namedCards(ts) : [];
  let found = 0;
  for (const x of decks) {
    const hit = !ts.length || x.cs.some((c) => hits.includes(c));
    x.show = hit && (!readyOnly || x.ready);
    x.el.hidden = !x.show;
    if (hit && ts.length) found += x.show ? 1 : 0;
    x.slots.forEach((s, i) => s.classList.toggle("miss", ts.length > 0 && !hits.includes(x.cs[i])));
  }
  find.paint(ts, hits, hits.filter((c) => decks.some((x) => x.cs.includes(c))), found);
  // only the "Ready to play" filter can empty the list on its own (a search says so in its own line)
  emptyEl.hidden = !(readyOnly && !ts.length && !decks.some((x) => x.show));
}

function updateBanner() {
  if (!banner) return;
  const n = ownedCount();
  const go = (label, tab) => h("a.btn.primary", { href: "#" + tab, "data-goto": tab }, [label, icon("arrow")]);
  if (!n) {
    banner.replaceChildren(h("div.callout-t", h("h2", t("tl.callH"))), go(t("tl.callGo"), "codex"));
    return;
  }
  let ready = 0, near = 0;
  for (const x of decks) {
    const m = x.cs.filter((c) => !isOwned(c.key)).length;
    if (m === 0) ready++; else if (m === 1) near++;
  }
  banner.replaceChildren(...[
    h("div.callout-t", [h("h2", t("tl.ownH", { n })), h("p", t("tl.ownP", { total: decks.length, ready, near }))]),
    // the way to My decks, while it is shown (patch.js DECK_TABLE_SHOWN)
    DECK_TABLE_SHOWN ? go(t("tl.ownGo"), "decks") : null,
  ].filter(Boolean));
}
