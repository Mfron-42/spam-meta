// Deck tier list tab: the lab's deck ranking of the game patch (data/ranking.json, tools/export_ranking.py) as two lists of
// one view (owner, 2026-10-23): the decks by win rate (their score against the benchmark decks, with its 95% margin) and the
// decks that win in the fewest rounds (with their win rate beside it). A ranked list, no tier letters and no hidden deck
// (owner, 2026-10-21). While the ranking is not final the view says so at its top (the banner "Temporary ranking", patch.js
// provBanner), with why, its method and caveats behind "About the numbers". Every deck carries its figure, named and big, with
// the stage meter of the furthest stage it reached, and its steps, every other stage it played with its result (decklist.js,
// read from the same run's deck table; owner, 2026-10-24: the bars that say where a deck was eliminated, then "moins de texte,
// plus visuel").
// Each deck is its four game cards in board order, each with the talent it plays under it; a card opens the card view on that
// talent. A card search keeps the decks holding a card, "Ready to play" the decks the visitor owns. The list shown lives in the
// address (#tiers, #tiers/speed). A language change redraws the page and keeps the list, the query and the filter.
// (The tier-grouped view of the 1.22 rankings, with its matchups, withheld and secret decks, is in the git history.)

import { h, icon, pct, dec, reducedMotion } from "./util.js?v=d1215b1076";
import { DB, loadRanking, loadDecks, deckKey } from "./data.js?v=d1215b1076";
import { on, isOwned, ownedCount } from "./store.js?v=d1215b1076";
import { cardName } from "./cards.js?v=d1215b1076";
import { segmented, scrollToEl, cascade, CURVE } from "./ui.js?v=d1215b1076";
import { t, tx } from "./i18n.js?v=d1215b1076";
import { findRow, terms, namedCards } from "./search.js?v=d1215b1076";
import { introLine, limitParams, gameSpan, medianRounds, provBanner, DECK_TABLE_SHOWN } from "./patch.js?v=d1215b1076";
import { paintOwned, deckSlot, deckFacts } from "./decklist.js?v=d1215b1076";

const LISTS = { score: "by_score", speed: "by_speed" };
let root, R, table = null, rrOf = new Map(), list = "score", query = "", readyOnly = false;
let decks = [], find, seg, readyBtn, banner, basisEl, listEl, headEl, sayEl, emptyEl;

export async function mount(el) {
  root = el;
  // the deck table (while it is shown) gives every listed deck its stages: the stage meter and the steps; without it (not
  // shown, or a failed request) the rows keep their figures and their quiet lines
  const [r, d] = await Promise.all([loadRanking(), DECK_TABLE_SHOWN ? loadDecks().catch(() => null) : null]);
  R = r;
  table = d ? new Map(d.rows.map((x) => [deckKey(x.cards.map((c) => c.id)), x])) : null;
  // the round robin's win rate of the decks that played it (the final's best), for their steps on both lists (a fast deck can
  // be one of them)
  rrOf = new Map(R.by_score.decks.filter((x) => x.round_robin).map((x) => [deckKey(x.cards), x.round_robin]));
  list = listFromHash() || "score";
  render();
  // the one load sequence of this tab: the first time it is shown, the decks on screen arrive in rank order
  cascade(root, () => [...root.querySelectorAll(".deck:not([hidden])")]);
  on("owned", () => { updateBadges(); updateBanner(); applyShown(); });
  on("lang", () => render());
  window.addEventListener("hashchange", () => { const l = listFromHash(); if (l && l !== list) setList(l, false); });
}

/** Opens the view searched for one card (the card view's "Decks with this card"): its name as written, in the page language;
 * the list that holds it when the one shown does not. */
export function findCard(key) {
  const c = DB.byKey.get(key);
  if (!c) return;
  const holds = (l) => R[LISTS[l]].decks.some((d) => d.cards.includes(c.id));
  if (!holds(list) && holds(list === "score" ? "speed" : "score")) setList(list === "score" ? "speed" : "score");
  query = `"${cardName(c)}"`;
  find.field.set(query);
  applyShown();
}

// ---------------------------------------------------------------- the list in the address
const listFromHash = () => {
  const [tab, sub] = location.hash.replace(/^#/, "").split("/");
  return tab === "tiers" ? (sub === "speed" ? "speed" : sub ? null : "score") : null;
};
function saveList() {
  if (location.hash.split("/")[0] !== "#tiers") return;
  const next = "#tiers" + (list === "speed" ? "/speed" : "");
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
  seg = segmented(Object.keys(LISTS).map((k) => [k, t("rk.list." + k)]), list, (v) => setList(v), t("rk.listAria"));
  readyBtn = h("button.chip.ready", { type: "button", "aria-pressed": "false", hidden: true, onclick: () => { readyOnly = !readyOnly; applyShown(); } }, [h("span.chip-l", t("tl.ready")), h("span.n")]);
  headEl = h("h2.sr", { id: "rk-list-h" });
  sayEl = h("p.sr", { "aria-live": "polite" });          // a change of list is announced (the list itself swaps silently)
  basisEl = h("p.rk-basis");
  listEl = h("ol.rk-list", { "aria-labelledby": "rk-list-h" });
  // a filter that leaves the list empty says so, with the way back (DESIGN.md "Deck tier list")
  emptyEl = h("p.rk-empty", { hidden: true }, [h("span", t("rk.emptyReady")),
    h("button.btn.ghost", { type: "button", onclick: () => { readyOnly = false; applyShown(); readyBtn.focus(); } }, t("rk.showAll"))]);
  root.replaceChildren(
    h("div.vhead", [
      h("h1", t("tl.h1")),
      // a provisional ranking says so first, in a banner no one can miss (owner, 2026-10-23 evening)
      prov ? provBanner("tiers") : null,
      // the facts only: the banner says it is temporary, "About the numbers" says which version and why
      ...introLine("tiers", h("p.lede.quiet", t("rk.lede", { games: R.games, patch: R.patch })),
        { method: methodLines(), patch: R.patch }),
    ]),
    findBar(),
    banner,
    h("div.rk-bar", [seg.el, readyBtn]),
    h("section.rk-sec", [headEl, sayEl, basisEl, listEl, emptyEl]),
    // the way to the overlay: one quiet line after the list, no banner (it promises no download)
    h("p.ov-tease", [h("span", t("tl.ovTease")), " ", h("a.link", { href: "overlay/" }, t("tl.ovLink"))]),
  );
  paintList(false);
}

/** What "About the numbers" opens: why it is provisional, how it was made, its caveats as a short list, the round robin and the speed. */
function methodLines() {
  const s = R.by_score, n = s.opponents;
  return [
    R.final ? null : h("p", tx("rk.mWhy")),
    t("rk.mHow", { v: R.version, ai: R.pilot, pool: R.pool, kept: s.decks_measured, n, per: gameSpan(s.games_per_opponent) }),
    t("rk.mTalents"),
    h("ul.vinfo-l", R.limits.map((l) => h("li", t("rk.limit." + l, limitParams(R))))),
    t("rk.mRR", { decks: R.round_robin.decks, field: R.round_robin.field, n, gpp: gameSpan(R.round_robin.games_per_pair, { atLeast: true }) }),
    t("rk.mSpeed", { n: R.by_speed.opponents, median: medianRounds(R) }),
  ];
}

/** The list shown: its hidden heading, its basis line and its decks. `swap`: the visitor changed list (a short fade). */
function paintList(swap) {
  const L_ = R[LISTS[list]];
  listEl.dataset.list = list;      // the speed list lifts its own metric, the rounds line (views.css)
  headEl.textContent = t("rk.h." + list, { n: L_.decks.length });
  basisEl.textContent = list === "score"
    ? t("rk.basisScore", { n: L_.opponents, per: gameSpan(R.by_score.games_per_opponent) })
    : t("rk.basisSpeed", { min: pct(L_.min_win_rate, 0), wins: L_.min_wins, median: medianRounds(R) });
  decks = [];
  const shown = L_.decks.filter((d) => d.cs.every(Boolean));
  listEl.replaceChildren(...shown.map((d, i) => deckEl(d, i === 0)));
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
/**
 * A deck's facts: the one component of every deck row (decklist.js `deckFacts`; owner, 2026-10-24: the last completed phase and
 * its win rate, big, the other completed phases and their win rates, small, the same on both lists), with the rounds to win as
 * one quiet line in the same place on both lists (the speed list's own metric; owner, 2026-10-23, for the win-rate list). It
 * reads the deck's row of the run's deck table; without it (not shown, or a failed request) it reads the row ranking.json gives:
 * on the win-rate list the final, on the speed list the race and, for a finalist, the final.
 */
function facts(d) {
  const row = (table && table.get(deckKey(d.cards))) || listRow(d);
  let rounds = null;
  if (list === "score" && d.win_speed) {
    const ws = d.win_speed;
    rounds = { value: ws.rounds, pm: ws.rounds_ci95, title: t("rk.winsInTip", { pm: dec(ws.rounds_ci95, 1), wins: ws.wins, median: medianRounds(R) }) };
  } else if (list === "speed") {
    rounds = { value: d.rounds, pm: d.rounds_ci95, title: t("rk.roundsFigTip", { wins: d.rounds_wins || d.wins, pm: dec(d.rounds_ci95, 1), median: medianRounds(R) }) };
  }
  return [deckFacts(row, { rounds })];
}

/** The row ranking.json alone gives a deck, without the deck table: its final (both lists) and its race (the speed list). */
function listRow(d) {
  const rr = rrOf.get(deckKey(d.cards)) || null;
  if (list === "score") {
    return { cards: d.cs, level: 3, rr, stages: { final: { rank: d.rank, score: d.score, ci95: d.ci95, games: d.games }, rt: null } };
  }
  const race = { rate: d.win_rate, games: d.games, kept: !!d.final };
  return { cards: d.cs, level: d.final ? 3 : 2, rr, stages: { race, final: d.final ? { rank: d.final.rank, score: d.final.score } : null, rt: null } };
}

function deckEl(d, full) {
  const badge = h("div.obadge", { hidden: true });
  const slots = d.cs.map((c, k) => deckSlot(c, d.talents[k], { full }));
  // quiet facts about the rank in words, never boxes: a shared rank, the deck's place in the other list
  const words = [
    d.tied ? h("span.deck-word", { title: t("rk.tiedTip") }, t("rk.tied")) : null,
  ];
  const el = h("li.deck" + (full ? ".spot" : ""), { id: `deck-${list}-${d.rank}-${decks.length}`, "aria-label": t("tl.rankAria", { rank: d.rank, cards: d.cs.map(cardName).join(", ") }) }, [
    h("div.deck-head", [h("h3.rk", `#${d.rank}`), ...words, badge]),
    h("div.deck-body", [
      h("div.deck-cards" + (full ? ".full" : ""), slots),
      h("div.deck-facts", facts(d).filter(Boolean)),
    ]),
  ]);
  decks.push({ d, cs: d.cs, badge, el, slots });
  return el;
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
