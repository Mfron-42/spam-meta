// Deck tier list tab: the lab's deck ranking of the game patch (data/ranking.json, tools/export_ranking.py) as one list with
// three sorts (owner, 2026-10-24: "the switch is the sort; we show the sort's win rate, and under it the other win rates"):
// "Top 30" (default: the final's 30 best decks by their win rate against each other), "Race" (the 30 best decks of the race by
// their race win rate against the benchmark decks, few-game decks pulled toward the race's mean) and "Speed" (the 20 decks that
// win in the fewest rounds). A ranked list, no tier letters and no hidden deck (owner, 2026-10-21). While the ranking is not
// final the view says so in one line at its top (patch.js provBanner); every explanation lives in the footer's Method section
// (owner, 2026-10-24), so the top of the view is the title, the banner, the card search and the sort.
// Every deck carries one big number, the active sort's metric with no label, then the stage meter and its other results, small,
// each with a one-word label (decklist.js deckFacts). Each deck is its four game cards in board order, each with the talent it
// plays under it; a card opens the card view on that talent. A card search keeps the decks holding a card, "Ready to play" the
// decks the visitor owns. The sort lives in the address (#tiers, #tiers/race, #tiers/speed). A language change redraws the
// page and keeps the sort, the query and the filter.
// (The tier-grouped view of the 1.22 rankings, with its matchups, withheld and secret decks, is in the git history.)

import { h, icon, pct, pct1, pm, dec, fmtInt, reducedMotion } from "./util.js?v=a34256d2f5";
import { DB, loadRanking, loadDecks, deckKey } from "./data.js?v=a34256d2f5";
import { on, isOwned, ownedCount } from "./store.js?v=a34256d2f5";
import { cardName } from "./cards.js?v=a34256d2f5";
import { segmented, scrollToEl, cascade, band, CURVE } from "./ui.js?v=a34256d2f5";
import { t, tx } from "./i18n.js?v=a34256d2f5";
import { findRow, terms, namedCards } from "./search.js?v=a34256d2f5";
import { introLine, limitParams, gameSpan, medianRounds, provBanner, DECK_TABLE_SHOWN } from "./patch.js?v=a34256d2f5";
import { paintOwned, deckSlot, deckFacts, topTip, BAR_AXIS } from "./decklist.js?v=a34256d2f5";

// the three sorts, in the switch's order, and the ranking.json list each reads; "score" is the Top 30 (the address #tiers)
const LISTS = { score: "by_score", race: "by_race", speed: "by_speed" };
const SUBS = { score: "", race: "race", speed: "speed" };
let root, R, table = null, list = "score", query = "", readyOnly = false;
let decks = [], find, seg, readyBtn, banner, listEl, headEl, sayEl, emptyEl;
const sorts = () => Object.keys(LISTS).filter((k) => R[LISTS[k]] && R[LISTS[k]].decks.length);

export async function mount(el) {
  root = el;
  // the deck table (while it is shown) gives every listed deck its rounds: the stage meter and the small results; without it
  // (not shown, or a failed request) the rows read what ranking.json gives
  const [r, d] = await Promise.all([loadRanking(), DECK_TABLE_SHOWN ? loadDecks().catch(() => null) : null]);
  R = r;
  table = d ? new Map(d.rows.map((x) => [deckKey(x.cards.map((c) => c.id)), x])) : null;
  list = listFromHash() || "score";
  if (!sorts().includes(list)) list = "score";
  render();
  // the one load sequence of this tab: the first time it is shown, the decks on screen arrive in rank order
  cascade(root, () => [...root.querySelectorAll(".deck:not([hidden])")]);
  on("owned", () => { updateBadges(); updateBanner(); applyShown(); });
  on("lang", () => render());
  window.addEventListener("hashchange", () => { const l = listFromHash(); if (l && l !== list && sorts().includes(l)) setList(l, false); });
}

/** Opens the view searched for one card (the card view's "Decks with this card"): its name as written, in the page language;
 * the first sort that holds it when the one shown does not. */
export function findCard(key) {
  const c = DB.byKey.get(key);
  if (!c) return;
  const holds = (l) => R[LISTS[l]].decks.some((d) => d.cards.includes(c.id));
  if (!holds(list)) { const other = sorts().find(holds); if (other) setList(other); }
  query = `"${cardName(c)}"`;
  find.field.set(query);
  applyShown();
}

// ---------------------------------------------------------------- the sort in the address
const listFromHash = () => {
  const [tab, sub] = location.hash.replace(/^#/, "").split("/");
  if (tab !== "tiers") return null;
  const l = Object.keys(SUBS).find((k) => SUBS[k] === (sub || ""));
  return l || null;
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
  // the sort switch: the same segmented control as the Card tier list's (ui.js segmented, DESIGN.md "Sort switch")
  seg = segmented(sorts().map((k) => [k, t("rk.list." + k)]), list, (v) => setList(v), t("rk.listAria"));
  readyBtn = h("button.chip.ready", { type: "button", "aria-pressed": "false", hidden: true, onclick: () => { readyOnly = !readyOnly; applyShown(); } }, [h("span.chip-l", t("tl.ready")), h("span.n")]);
  headEl = h("h2.sr", { id: "rk-list-h" });
  sayEl = h("p.sr", { "aria-live": "polite" });          // a change of sort is announced (the list itself swaps silently)
  listEl = h("ol.rk-list", { "aria-labelledby": "rk-list-h" });
  // a filter that leaves the list empty says so, with the way back (DESIGN.md "Deck tier list")
  emptyEl = h("p.rk-empty", { hidden: true }, [h("span", t("rk.emptyReady")),
    h("button.btn.ghost", { type: "button", onclick: () => { readyOnly = false; applyShown(); readyBtn.focus(); } }, t("rk.showAll"))]);
  root.replaceChildren(
    h("div.vhead", [
      h("h1", t("tl.h1")),
      // a temporary ranking says so in one line, its link to the footer's Method section (owner, 2026-10-24)
      prov ? provBanner("tiers") : null,
      // the facts line, the method, the three sorts and the caveats: the footer (owner, 2026-10-24: no prose above the list)
      ...introLine("tiers", h("p", t("rk.lede", { games: R.games, patch: R.patch })), { method: methodLines(), patch: R.patch, link: !prov }),
    ]),
    // the owned callout, then the sort (it stays under the header while the decks scroll, so the big number always has its name
    // on screen; the Card tier list's band), then the card search right above the list it filters
    banner,
    band(h("div.rk-bar", [seg.el, readyBtn])),
    findBar(),
    h("section.rk-sec", [headEl, sayEl, listEl, emptyEl]),
    // the way to the overlay: one quiet line after the list, no banner (it promises no download)
    h("p.ov-tease", [h("span", t("tl.ovTease")), " ", h("a.link", { href: "overlay/" }, t("tl.ovLink"))]),
  );
  paintList(false);
}

/** The footer's Method sub-section of this tab: why it is temporary, how it was made, the three sorts, the small numbers, the
 * talents and the caveats. Numbers come from ranking.json (the run's totals, the private test decks included); no version of
 * the ranking is named (owner, 2026-10-24), the ranking's AI once. */
function methodLines() {
  const s = R.by_score, n = s.opponents, vt = s.vs_top30, rc = R.by_race, sp = R.by_speed;
  return [
    R.final ? null : h("p", [...tx("rk.mWhy")]),
    t("rk.mHow", { ai: R.pilot, pool: R.pool, kept: s.decks_measured, n, per: gameSpan(s.games_per_opponent) }),
    vt ? tx("rk.mTop30", { top: s.decks.length, opp: vt.opponents, gpp: gameSpan(vt.games_per_pair), lo: pct(BAR_AXIS[0], 0), hi: pct(BAR_AXIS[1], 0) }) : null,
    rc ? tx("rk.mRace", { top: rc.decks.length, n: rc.opponents, g: rc.min_games }) : null,
    tx("rk.mSpeed", { top: sp.decks.length, n: sp.opponents, median: medianRounds(R), min: pct(sp.min_win_rate, 0), wins: sp.min_wins }),
    t("rk.mSmall", { n }),
    t("rk.mTalents"),
    h("ul.vinfo-l", R.limits.map((l) => h("li", t("rk.limit." + l, limitParams(R))))),
  ];
}

/** The list shown: its hidden heading and its decks. `swap`: the visitor changed the sort (a short fade). */
function paintList(swap) {
  const L_ = R[LISTS[list]];
  listEl.dataset.list = list;
  headEl.textContent = t("rk.h." + list, { n: L_.decks.length });
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
 * A deck's facts (decklist.js `deckFacts`), the same component in the three sorts: the active sort's metric big with no label
 * (the switch names it): the Top 30 win rate with its margin and the Top-level bar, the race win rate, or the rounds to win;
 * then the stage meter and the deck's other results small, in the tournament's order (First sort, Race, Final, Top 30, rounds).
 */
function facts(d) {
  const row = (table && table.get(deckKey(d.cards))) || listRow(d);
  const v = d.vs_top30 || null;
  const ws = list === "speed" ? null : d.win_speed;
  const rounds = ws ? { value: ws.rounds, pm: ws.rounds_ci95, wins: ws.wins } : null;
  let big, omit;
  if (list === "speed") {
    omit = "rounds";
    big = { value: dec(d.rounds, 1), unit: t("ms.roundsUnit"), pm: "±" + dec(d.rounds_ci95, 1), name: t("rk.list.speed"),
      title: t("rk.roundsFigTip", { v: dec(d.rounds, 1), wins: d.rounds_wins || d.wins, pm: dec(d.rounds_ci95, 1), median: medianRounds(R) }) };
  } else if (list === "race") {
    omit = "race";
    big = { value: pct1(d.rate), name: t("rk.list.race"),
      title: t("rk.raceTip", { v: pct1(d.rate), games: fmtInt(d.games), n: R.by_race.opponents }) };
  } else if (v) {
    omit = "top30";
    big = { value: pct1(v.win_rate), pm: pm(v.ci95), name: t("rk.list.score"), title: topTip(v),
      bar: { v: v.win_rate, lo: v.win_rate - v.ci95, hi: v.win_rate + v.ci95,
        label: t("vt.bar", { v: pct1(v.win_rate), pm: pm(v.ci95), mid: pct(0.5, 0), lo: pct(BAR_AXIS[0], 0), hi: pct(BAR_AXIS[1], 0) }) } };
  } else {
    // an export without the Top 30 reading: the final's score, big
    omit = "final";
    big = { value: pct1(d.score), pm: pm(d.ci95), name: t("st.final"), title: pct1(d.score) + t("ui.comma") + t("vt.margin", { pm: pm(d.ci95) }) };
  }
  return [deckFacts(row, { big, top30: v, rounds, omit })];
}

/** The row ranking.json alone gives a deck, without the deck table: its final, and its race on the race and speed sorts. */
function listRow(d) {
  if (list === "score") {
    return { cards: d.cs, level: 3, stages: { final: { rank: d.score_rank || d.rank, score: d.score, ci95: d.ci95, games: d.games } } };
  }
  const race = list === "race" ? { rate: d.rate, games: d.games, kept: !!d.final } : { rate: d.win_rate, games: d.games, kept: !!d.final };
  return { cards: d.cs, level: d.final ? 3 : 2, stages: { race, final: d.final ? { rank: d.final.rank, score: d.final.score } : null } };
}

function deckEl(d, full) {
  const badge = h("div.obadge", { hidden: true });
  const slots = d.cs.map((c, k) => deckSlot(c, d.talents[k], { full }));
  // quiet facts about the rank in words, never boxes: a shared rank
  const words = [
    d.tied ? h("span.deck-word", { title: t("rk.tiedTip." + list) }, t("rk.tied")) : null,
  ];
  const el = h("li.deck" + (full ? ".spot" : ""), { id: `deck-${list}-${d.rank}-${decks.length}`, "aria-label": t("tl.rankAria", { rank: d.rank, cards: d.cs.map(cardName).join(", ") }) }, [
    // the heading names the deck too, so a screen reader's list of headings reads the decks
    h("div.deck-head", [h("h3.rk", [`#${d.rank}`, h("span.sr", " " + d.cs.map(cardName).join(", "))]), ...words, badge]),
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
