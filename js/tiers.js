// Deck tier list tab: the lab's deck ranking of the game patch (data/ranking.json, tools/export_ranking.py) as two lists of
// one view (owner, 2026-10-23): the decks by win rate (their score against the benchmark decks, with its 95% margin) and the
// decks that win in the fewest rounds (with their win rate beside it). A ranked list, no tier letters and no hidden deck
// (owner, 2026-10-21). While the ranking is not final the view says so at its top ("Provisional ranking", one honest line),
// with its method and caveats behind "About the numbers".
// Each deck is its four game cards in board order, each with the talent it plays under it; a card opens the card view on that
// talent. A card search keeps the decks holding a card, "Ready to play" the decks the visitor owns. The list shown lives in the
// address (#tiers, #tiers/speed). A language change redraws the page and keeps the list, the query and the filter.
// (The tier-grouped view of the 1.22 rankings, with its matchups, withheld and secret decks, is in the git history.)

import { h, icon, pm, pct, pct1, dec, reducedMotion } from "./util.js?v=b2212b274c";
import { DB, loadRanking } from "./data.js?v=b2212b274c";
import { getLang, on, isOwned, ownedCount } from "./store.js?v=b2212b274c";
import { gameCard, cardName, L } from "./cards.js?v=b2212b274c";
import { segmented, scrollToEl, cascade, CURVE } from "./ui.js?v=b2212b274c";
import { t } from "./i18n.js?v=b2212b274c";
import { findRow, terms, namedCards } from "./search.js?v=b2212b274c";
import { introLine, limitParams, RANKINGS_SHOWN } from "./patch.js?v=b2212b274c";
import { paintOwned } from "./decklist.js?v=b2212b274c";

const LISTS = { score: "by_score", speed: "by_speed" };
let root, R, list = "score", query = "", readyOnly = false;
let decks = [], find, seg, readyBtn, banner, basisEl, listEl, headEl, sayEl, emptyEl;

export async function mount(el) {
  root = el;
  R = await loadRanking();
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
      // the status of the ranking, said first: the "being computed" strip of the placeholder, now with what is shown
      prov ? h("p.rk-status", [icon("clock", 24), h("span", t("rk.status", { patch: R.patch }))]) : null,
      ...introLine("tiers", h("p.lede.quiet", t(prov ? "rk.ledeProv" : "rk.lede", { v: R.version, next: R.version + 1, ai: R.pilot, games: R.games, patch: R.patch })),
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

/** What "About the numbers" opens: how the ranking was made, its caveats as a short list, the round robin and the speed. */
function methodLines() {
  const s = R.by_score, n = s.opponents;
  return [
    t("rk.mHow", { v: R.version, pool: R.pool, kept: s.decks_measured, n, per: s.games_per_opponent }),
    t("rk.mTalents"),
    h("ul.vinfo-l", R.limits.map((l) => h("li", t("rk.limit." + l, limitParams(R))))),
    t("rk.mRR", { decks: R.round_robin.decks, gpp: R.round_robin.games_per_pair }),
    t("rk.mSpeed", { n: R.by_speed.opponents, median: dec(R.by_speed.median_rounds, 1) }),
  ];
}

/** The list shown: its hidden heading, its basis line and its decks. `swap`: the visitor changed list (a short fade). */
function paintList(swap) {
  const L_ = R[LISTS[list]];
  headEl.textContent = t("rk.h." + list, { n: L_.decks.length });
  basisEl.textContent = list === "score"
    ? t("rk.basisScore", { n: L_.opponents, per: R.by_score.games_per_opponent })
    : t("rk.basisSpeed", { min: pct(L_.min_win_rate, 0), wins: L_.min_wins, median: dec(L_.median_rounds, 1) });
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
/** A deck's card: the game card (list size, or full for the first deck of the list) and, under it, the talent it plays. */
function slot(d, k, full) {
  const c = d.cs[k], tl = d.tls[k];
  const card = gameCard(c, { size: full ? "full" : "list", eager: full });
  card.dataset.talent = String(d.talents[k]);      // the card view opens on this talent (main.js, dialogs.js)
  return h("div.slot", [
    card,
    tl ? h("p.slot-tl", { title: L(tl, "description") }, [h("i.ab-talent", { "aria-hidden": "true" }),
      h("span", { lang: getLang() }, [h("span.sr", t("rk.talentSr")), h("span", { translate: "no" }, L(tl, "name"))])]) : null,
  ]);
}

/** The number that sets the rank, its margin and its field, then one quiet second line; the basis of each is its tooltip. */
function facts(d) {
  if (list === "score") {
    const s = R.by_score, rr = d.round_robin;
    return h("div.dfacts", [
      h("div.dr-fig", { title: t("rk.scoreTip", { games: d.games, n: s.opponents }) }, [
        h("span.fig-line", [h("b.stat-v", pct1(d.score)), h("span.fig-pm", { title: t("tl.pmTip") }, pm(d.ci95))]),
        h("span.stat-s", [t("rk.scoreK", { n: s.opponents }), h("span.sr", t("ui.sep") + t("tl.setsRank"))]),
      ]),
      rr ? h("p.fig-all", { title: t("rk.rrTip", { games: rr.games, opp: R.round_robin.opponents }) }, t("rk.rr", { pct: pct1(rr.win_rate), n: R.round_robin.decks })) : null,
    ]);
  }
  return h("div.dfacts", [
    h("div.dr-fig", { title: t("rk.roundsTip", { wins: d.wins }) }, [
      h("span.fig-line", [h("b.stat-v", dec(d.rounds, 1)), h("span.fig-pm", { title: t("rk.roundsPmTip") }, "±" + dec(d.rounds_ci95, 1))]),
      h("span.stat-s", [t("rk.roundsK"), h("span.sr", t("ui.sep") + t("tl.setsRank"))]),
    ]),
    h("p.fig-all", { title: t("rk.speedRateTip", { n: R.by_speed.opponents }) }, t("rk.speedRate", { pct: pct1(d.win_rate), games: d.games })),
  ]);
}

function deckEl(d, full) {
  const badge = h("div.obadge", { hidden: true });
  const slots = d.cs.map((c, k) => slot(d, k, full));
  // quiet facts about the rank in words, never boxes: a shared rank, the deck's place in the other list
  const words = [
    d.tied ? h("span.deck-word", { title: t("rk.tiedTip") }, t("rk.tied")) : null,
    d.score_rank ? h("span.deck-word", t("rk.alsoScore", { rank: d.score_rank })) : null,
  ];
  const el = h("li.deck" + (full ? ".spot" : ""), { id: `deck-${list}-${d.rank}-${decks.length}`, "aria-label": t("tl.rankAria", { rank: d.rank, cards: d.cs.map(cardName).join(", ") }) }, [
    h("div.deck-head", [h("h3.rk", `#${d.rank}`), ...words, badge]),
    h("div.deck-body", [
      h("div.deck-cards" + (full ? ".full" : ""), slots),
      h("div.deck-facts", facts(d)),
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
    // the way to My decks, while it is shown (patch.js RANKINGS_SHOWN)
    RANKINGS_SHOWN ? go(t("tl.ownGo"), "decks") : null,
  ].filter(Boolean));
}
