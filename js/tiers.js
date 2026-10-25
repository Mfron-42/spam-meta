// Deck tier list tab: the lab's deck ranking of the game patch (data/ranking.json, tools/export_ranking.py) as one list with
// three sorts, in this order (owner, 2026-10-25): "Tournament" (the default: the 30 best decks of the Tournament by their win rate
// against the benchmark decks, among those that played the whole Tournament; its decks read best to a player), "Final" (the
// Qualifier's best decks by their win rate against each other, ranking.json `by_score`) and "Win speed" (the 20 decks that win
// in the fewest rounds). A ranked list, no tier letters and no hidden deck (owner, 2026-10-21). While the ranking is not final
// the view says so in one line at its top (patch.js provBanner); every explanation lives in the footer's Method section (owner,
// 2026-10-24), so the top of the view is the title, the banner, the card search and the sort.
// Every deck carries its three figures, named like the three lists and in their order, the active list's figure big
// (decklist.js rankFigures); each explains itself on hover, focus or a tap. Each deck is its four game cards in board order,
// each with the talent it plays under it; a card opens the card view on that talent. A card search keeps the decks holding a
// card, "Ready to play" the decks the visitor owns. The sort lives in the address (#tiers, #tiers/final, #tiers/speed). A
// language change redraws the page and keeps the sort, the query and the filter.
// (The tier-grouped view of the 1.22 rankings, with its matchups, withheld and secret decks, is in the git history.)

import { h, icon, pct, dec, reducedMotion } from "./util.js?v=68682df7d6";
import { DB, loadRanking, loadDecks, deckKey } from "./data.js?v=68682df7d6";
import { on, isOwned, ownedCount } from "./store.js?v=68682df7d6";
import { cardName } from "./cards.js?v=68682df7d6";
import { segmented, scrollToEl, cascade, band, CURVE } from "./ui.js?v=68682df7d6";
import { t, tx } from "./i18n.js?v=68682df7d6";
import { findRow, terms, namedCards } from "./search.js?v=68682df7d6";
import { introLine, limitParams, gameSpan, medianRounds, provBanner, DECK_TABLE_SHOWN } from "./patch.js?v=68682df7d6";
import { paintOwned, deckSlot, rankFigures, aiLine, matchupLine, LISTS } from "./decklist.js?v=68682df7d6";

// the ranking.json list each sort reads, and its address: the first sort (the Tournament) is the bare #tiers. The addresses of
// earlier versions still land on a list: "#tiers/race" (the Tournament when it was second) is read as the Tournament and
// rewritten to #tiers; "#tiers" itself, the Top 50's address until 2026-10-25, now opens the Tournament, the default.
const SRC = { race: "by_race", score: "by_score", speed: "by_speed" };
const SUBS = { race: "", score: "final", speed: "speed" };
const OLD_SUBS = { race: "race" };
let root, R, table = null, list = "race", query = "", readyOnly = false;
let decks = [], find, seg, readyBtn, banner, listEl, headEl, sayEl, emptyEl;
const sorts = () => LISTS.filter((k) => R[SRC[k]] && R[SRC[k]].decks.length);

export async function mount(el) {
  root = el;
  // the deck table (while it is shown) gives the decks of the Final and Win speed lists their Tournament and every deck its
  // Qualifier's games; without it (not shown, or a failed request) a figure it alone gives says it has no data
  const [r, d] = await Promise.all([loadRanking(), DECK_TABLE_SHOWN ? loadDecks().catch(() => null) : null]);
  R = r;
  table = d ? new Map(d.rows.map((x) => [deckKey(x.cards.map((c) => c.id)), x])) : null;
  list = listFromHash() || sorts()[0];
  if (!sorts().includes(list)) list = sorts()[0];
  // an older address of a list is rewritten to the list's own (a card key after #tiers/ is left as it is)
  if (location.hash.split("/")[0] === "#tiers" && OLD_SUBS[list] === location.hash.split("/")[1]) saveList();
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
  const holds = (l) => R[SRC[l]].decks.some((d) => d.cards.includes(c.id));
  if (!holds(list)) { const other = sorts().find(holds); if (other) setList(other); }
  query = `"${cardName(c)}"`;
  find.field.set(query);
  applyShown();
}

// ---------------------------------------------------------------- the sort in the address
const listFromHash = () => {
  const [tab, sub] = location.hash.replace(/^#/, "").split("/");
  if (tab !== "tiers") return null;
  const l = LISTS.find((k) => SUBS[k] === (sub || "") || OLD_SUBS[k] === sub);
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

/** The footer's Method sub-section of this tab: why it is temporary, how it was made, which AI played which stage, the three
 * lists in the switch's order, the figures, the talents and the caveats. Numbers come from ranking.json (the run's totals, the
 * private test decks included); no version of the ranking is named (owner, 2026-10-24); the AIs are named once, in their own
 * line (the lead, the same evening: "say plainly which AI played which stage"). */
function methodLines() {
  const s = R.by_score, n = s.opponents, vt = s.vs_top, rc = R.by_race, sp = R.by_speed, top = s.decks.length;
  const ci = s.decks.filter((d) => d.vs_top).map((d) => d.vs_top.ci95 * 100);
  return [
    R.final ? null : h("p", [...tx("rk.mWhy")]),
    t("rk.mHow", { pool: R.pool, kept: s.decks_measured, n, per: gameSpan(s.games_per_opponent), top }),
    aiLine(),
    rc ? tx("rk.mRace", { top: rc.decks.length, n: rc.opponents, g: rc.min_games }) : null,
    vt ? tx("rk.mTop", { top, opp: vt.opponents, gpp: gameSpan(vt.games_per_pair), mlo: dec(Math.min(...ci), 1), mhi: dec(Math.max(...ci), 1) }) : null,
    tx("rk.mSpeed", { top: sp.decks.length, n: sp.opponents, median: medianRounds(R), min: pct(sp.min_win_rate, 0), wins: sp.min_wins }),
    t("rk.mFigs"),
    t("rk.mTalents"),
    R.matchup_talents ? matchupLine() : null,
    h("ul.vinfo-l", R.limits.map((l) => h("li", t("rk.limit." + l, limitParams(R))))),
  ];
}

/** The list shown: its hidden heading and its decks. `swap`: the visitor changed the sort (a short fade). */
function paintList(swap) {
  const L_ = R[SRC[list]];
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
 * A deck's three figures (decklist.js `rankFigures`), the same component in the three sorts: its Tournament, Final and Win speed
 * readings as this list's entry gives them, the deck table filling what the list leaves out (the Tournament of a Final deck, the
 * Qualifier's games). The Qualifier against the same benchmark decks is said in the Tournament's tooltip, never as a figure.
 */
function facts(d) {
  const st = (table && (table.get(deckKey(d.cards)) || {}).stages) || {};
  // the deck table's Tournament score first, so a deck reads the same in every list (the Win speed list's own record pools the
  // games and can differ by a fraction of a point); the list's entry without the table
  const race = st.race || (list === "race" ? { rate: d.rate, games: d.games } : list === "speed" ? { rate: d.win_rate, games: d.games } : null);
  const qual = st.final ? { score: st.final.score, games: st.final.games }
    : list === "score" ? { score: d.score, games: d.games } : d.final ? { score: d.final.score } : null;
  const speed = list === "speed" ? { rounds: d.rounds, rounds_ci95: d.rounds_ci95, wins: d.rounds_wins || d.wins } : d.win_speed;
  return [rankFigures({ race, qual, final: d.vs_top, speed }, list)];
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
