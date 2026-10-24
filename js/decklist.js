// The one way to list measured decks (the ranking run's deck table, ranking-decks.json), shared by My decks and the Deck
// builder, and the deck parts the Deck tier list reuses: a deck's card with its talent under it, the stage meter, a deck's facts
// (one number big, the others small), the owned badge; and, for the two deck table views, the paging and their footer Method
// sub-section (what each round of the tournament means, which "How reliable?" said above the list until 2026-10-24). Rows arrive
// sorted by the furthest stage reached, then the score there (docs/DATA.md, "ranking-decks.json"), so a filter that keeps
// their order keeps the canonical ranking.

import { h, icon, pct, pct1, pm, dec, fmtInt } from "./util.js?v=c59ee4eacb";
import { DB, deckKey } from "./data.js?v=c59ee4eacb";
import { getLang, isOwned, ownedCount } from "./store.js?v=c59ee4eacb";
import { gameCard, chip, cardName, L } from "./cards.js?v=c59ee4eacb";
import { t, tx } from "./i18n.js?v=c59ee4eacb";
import { introLine, provBanner, gameSpan, medianRounds, isMatchupTalent, matchupMark } from "./patch.js?v=c59ee4eacb";

// ---------------------------------------------------------------- stages, in plain words
// level -> stage of the ranking run: 3 the final (the full AI against the benchmark decks), 2 the race (the same AI and decks,
// fewer games), 1 the first sort (a fast AI)
export const STAGE = { 3: "final", 2: "race", 1: "screen" };
const LEVELS = 3;

/** The stage meter: three small bars, filled to the furthest stage a deck reached, the empty ones hollow (DESIGN.md "Stage
 * meter"); its name, also its title, says which stage ("Stage 2 of 3: Race"). */
export function meter(level) {
  const name = t("md.meter", { l: level, n: LEVELS, stage: t("st." + STAGE[level]) });
  return h("span.meter", { role: "img", "aria-label": name, title: name },
    Array.from({ length: LEVELS }, (_, i) => h("i", { class: i < level ? "on" : "" })));
}


// ---------------------------------------------------------------- a deck's card
/**
 * One card of a deck: the game card (list size, or full) and, under it, the talent the deck plays with it (the client's talent
 * glyph and its name, its game text as the title). The card opens the card view on that talent. `miss`: a card search dims it.
 */
export function deckSlot(c, talent, { full = false, miss = false } = {}) {
  const tl = c.talents[talent] || null;
  const card = gameCard(c, { size: full ? "full" : "list", eager: full });
  card.dataset.talent = String(talent);      // the card view opens on this talent (main.js, dialogs.js)
  return h("div.slot", { class: miss ? "miss" : null }, [
    card,
    tl ? h("p.slot-tl", { title: L(tl, "description") }, [h("i.ab-talent", { "aria-hidden": "true" }),
      h("span", { lang: getLang() }, [h("span.sr", t("rk.talentSr")), h("span", { translate: "no" }, L(tl, "name"))]),
      // a talent picked against the opponent (the element shields): the quiet mark after its name, the rule as its name
      isMatchupTalent(c, talent) ? matchupMark() : null]) : null,
  ]);
}

// ---------------------------------------------------------------- a deck's results
// the rounds of the tournament a deck can have played, in order (owner, 2026-10-24: every figure is named by the round it comes
// from, never by a version): the first sort, the race, the final (all three against the 12 benchmark decks), then "Top 50" (the
// round robin of the final's best, named by its size: 50 since 2026-10-24), then how fast it wins
const PHASES = ["screen", "race", "final"];
const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
let topByKey = null;

/** The size of the Top round (ranking.json `by_score`: the final's best decks that played each other), 0 without the ranking. */
export const topSize = () => (DB.ranking && DB.ranking.by_score ? DB.ranking.by_score.decks.length : 0);

/** A deck's "Top" reading (ranking.json `vs_top`: its win rate against the other decks of the final's best), or null. */
export function topReading(cards) {
  const R = DB.ranking;
  if (!R || !R.by_score.vs_top) return null;
  if (!topByKey) topByKey = new Map(R.by_score.decks.filter((x) => x.vs_top).map((x) => [deckKey(x.cards), x.vs_top]));
  return topByKey.get(deckKey(cards.map((c) => (c.id ? c.id : c)))) || null;
}

/** Which AI played which round (ranking.json `pilots`, in the order the run used them), one line for a footer Method sub-section
 * (the lead, 2026-10-24: "say plainly which AI played which stage"); nothing for an export without them. A round two AIs played
 * names the second as the wider search's. */
export function aiLine() {
  const R = DB.ranking, P = R && R.pilots;
  if (!P) return null;
  const names = (xs) => (xs.length > 1 ? t("rk.aiLater", { a: xs[0], b: xs[1] }) : xs[0]);
  return h("p", tx("rk.mAIs", { race: names(P.race), top: topSize(), top_ai: names(P.top) }));
}

/** The title of a "Top" reading: its games, the field, the margin; 50% is the level of the top. */
export function topTip(v) {
  const R = DB.ranking, gpp = R && R.by_score.vs_top ? gameSpan(R.by_score.vs_top.games_per_pair) : "";
  return t("vt.tip", { v: pct1(v.win_rate), games: fmtInt(v.games), opp: v.opponents, gpp, pm: pm(v.ci95), top: topSize() });
}

/**
 * A deck's facts, the one component of every deck row (DESIGN.md "Deck facts"; owner, 2026-10-24: one number big, "less text,
 * more visual", one uniform component):
 * - The Deck tier list (`big`): the big number is the active sort's metric, with no label (the sort switch names it), `{value,
 *   unit, pm, name, title[, bar]}`: the Top 50 win rate with its margin and the Top-level bar, the race win rate, or the rounds
 *   to win; then the stage meter (how far the deck went) and its other results, small, each with a one-word label, in the
 *   tournament's order: First sort, Race, Final, Top 50 (`vsTop` `{win_rate, ci95, games, opponents}`, ranking.json `vs_top`), then
 *   its rounds to win (`rounds` `{value, pm, wins}`), the active one left out (`omit`: "race", "top" or "rounds"). Percentages small are whole
 *   numbers; every exact value, its games and margin are its title and its screen-reader text.
 * - My decks and the Deck builder (no `big`): the last round the deck completed, big, with the stage meter, its name ("Final",
 *   "Race", "First sort") and its win rate (the final's margin), then its other rounds small, and its Top 50 win rate when it
 *   has one.
 * The row itself carries no sentence. `r` is a deck table row, or a row the Deck tier list builds from ranking.json without the
 * table.
 */
export function deckFacts(r, { big = null, vsTop = undefined, rounds = null, omit = null } = {}) {
  const s = r.stages, n = DB.decks ? DB.decks.stages : null, last = STAGE[r.level];
  const bench = DB.ranking ? DB.ranking.by_score.opponents : 12;
  const rate = (st) => (st === "final" ? s.final.score : s[st].rate);
  const games = (x) => (x && x.games ? t("ui.comma") + t("jy.games", { games: x.games }) : "");
  const basis = (st) => {
    const x = s[st];
    if (st === "final") {
      return (n ? t("jy.final", { rank: x.rank, n: n.final.decks }) : "#" + x.rank) + games(x) +
        (big && x.ci95 != null ? t("ui.comma") + t("vt.margin", { pm: pm(x.ci95) }) : "");
    }
    if (st === "race") {
      return cap(t("jy.games", { games: x.games })) + t("ui.comma") + t(x.kept ? "jy.toFinal" : "jy.stopped") +
        (!s.screen && n && n.screen ? t("ui.comma") + t("jy.direct") : "");
    }
    return cap(t("jy.games", { games: x.games })) + t("ui.comma") + t(x.kept ? "jy.kept" : s.race ? "jy.check" : "jy.stopped");
  };
  const small = (label, value, title) => h("li", { title }, [
    h("span.ms-k", label), h("b.ms-n", value), h("span.sr", t("ui.sep") + title)]);
  const top = vsTop === undefined ? topReading(r.cards) : vsTop;
  if (big) {
    // the tournament's order, the active sort's metric left out; whole percentages, the exact value in the title
    const tip = (st) => t(st === "screen" ? "ms.tipScreen" : "ms.tipBench", { v: pct1(rate(st)), n: bench, basis: basis(st) }) +
      (st === last ? t("ui.dot") + t("ev." + r.level) : "");
    const items = PHASES.filter((st) => s[st] && omit !== st).map((st) => small(t("st." + st), pct(rate(st), 0), tip(st)));
    if (top && omit !== "top") items.push(small(t("st.top", { n: topSize() }), pct(top.win_rate, 0), topTip(top)));
    if (rounds && omit !== "rounds") {
      const tipR = t("rk.winsInTip", { v: dec(rounds.value, 1), pm: dec(rounds.pm, 1), wins: rounds.wins, median: DB.ranking ? medianRounds(DB.ranking) : "" });
      items.push(h("li.ms-u", { title: tipR }, [h("b.ms-n", dec(rounds.value, 0)), h("span.ms-k", t("ms.roundsUnit")), h("span.sr", t("ui.sep") + tipR)]));
    }
    return h("div.dfacts", [
      h("div.dr-fig", { title: big.title }, [
        h("p.fig-line", [
          // the number and its unit never part ("10.8 rounds")
          h("span.fig-n", [h("b.stat-v", big.value), big.unit ? h("span.fig-u", big.unit) : null]),
          big.pm ? h("span.fig-pm", big.pm) : null,
          h("span.sr", t("ui.sep") + big.name + t("ui.sep") + big.title),
        ]),
        big.bar ? topBar(big.bar) : null,
      ]),
      // role="list": a list drawn without markers loses its list role in WebKit; the stage meter stands in its own column
      // before it, so a pair that wraps lines up under the first one
      items.length ? h("div.ms-row", [meter(r.level), h("ol.ms", { role: "list", "aria-label": t("jy.aria") }, items)]) : null,
    ]);
  }
  const figTitle = basis(last) + t("ui.dot") + t("ev." + r.level);
  const items = PHASES.filter((st) => st !== last && s[st]).map((st) => small(t("st." + st), pct1(rate(st)), basis(st)));
  if (top) items.push(small(t("st.top", { n: topSize() }), pct1(top.win_rate), topTip(top)));
  return h("div.dfacts", [
    h("div.dr-fig", { title: figTitle }, h("p.fig-line", [
      meter(r.level),
      h("span.fig-k", t("st." + last)),
      h("b.stat-v", pct1(rate(last))),
      last === "final" && s.final.ci95 != null ? h("span.fig-pm", pm(s.final.ci95)) : null,
      h("span.sr", t("ui.sep") + figTitle),
    ])),
    items.length ? h("ol.ms", { role: "list", "aria-label": t("jy.aria") }, items) : null,
  ]);
}

// the shared axis of the top-level bar: every row of the list on the same scale, 25% to 75% (the 50% mark in the middle); a
// value or a margin past an end stops at that end
export const BAR_AXIS = [0.25, 0.75];

/**
 * The top-level bar (DESIGN.md "Top-level bar"): a quiet sunken track on a shared axis, the 50% mark (the level of the top), the
 * deck's margin as a lighter band and its value as a short upright line. A picture of the figure above it, so it is one image for
 * screen readers whose name says the value, its margin and the mark (`label`); no motion, no colour of its own.
 */
export function topBar({ v, lo, hi, label }) {
  const [a, b] = BAR_AXIS;
  const at = (x) => (Math.min(b, Math.max(a, x)) - a) / (b - a);
  return h("span.vt-bar", { role: "img", "aria-label": label, title: label,
    style: `--lo:${at(lo).toFixed(4)};--hi:${at(hi).toFixed(4)};--v:${at(v).toFixed(4)}` }, [
    h("i.vt-band"), h("i.vt-mid"), h("i.vt-v"),
  ]);
}

/**
 * The head of a view that lists the deck table (My decks, the Deck builder): the title and, while the run is not final, the
 * one-line temporary banner. Everything that explains (what the table holds, the decks it does not list, what each round of the
 * tournament means, its games) goes to the view's footer Method sub-section (patch.js introLine; owner, 2026-10-24).
 */
export function tableHead(key, h1, lede) {
  const D = DB.decks.raw;
  const method = [
    D.final ? null : h("p", [...tx("rk.mWhy")]),
    t("md.mTable", { n: DB.decks.rows.length }),
    D.not_listed ? t("md.mNotListed", { n: D.not_listed }) : null,
    aiLine(),
    DB.ranking && DB.ranking.matchup_talents ? matchupLine() : null,
    ...legendNodes(),
  ];
  return h("div.vhead", [
    h("h1", h1),
    D.final ? null : provBanner(key),
    ...introLine(key, h("p", lede), { method, patch: D.patch, link: D.final }),
  ]);
}

// ---------------------------------------------------------------- owned badge
/**
 * Paints the owned badge of a deck ("You own 3/4 · missing <chips>", or "Ready to play" when all four are owned) into
 * `el`, hidden while the collection is empty. Returns how many of the cards are owned.
 */
export function paintOwned(el, cards) {
  const any = ownedCount() > 0;
  const own = cards.filter((c) => isOwned(c.key));
  const miss = cards.filter((c) => !isOwned(c.key));
  el.hidden = !any;
  el.className = "obadge" + (own.length === 4 ? " full" : "");
  if (!any) { el.replaceChildren(); return own.length; }
  if (own.length === 4) el.replaceChildren(icon("check"), h("span", t("tl.allOwned")));
  else if (miss.length <= 2) el.replaceChildren(h("span", t("tl.youOwn", { n: own.length })), h("span.muted", ` · ${t("tl.missing")}`), ...miss.map(chip));
  else el.replaceChildren(h("span", t("tl.youOwn", { n: own.length })));
  return own.length;
}

// ---------------------------------------------------------------- one deck row
/**
 * A measured deck as a row, in the Deck tier list's pattern (DESIGN.md "Deck row"): on the ground, a head (its place in this
 * list, the four card names hidden after it for screen readers, a quiet word, the owned badge pushed right), then its four game
 * cards with their talents and its facts (`deckFacts`: its last completed phase and win rate, big, then its other phases,
 * small), a "Missing:" / "Without:" line. On one column the facts come before the cards. `cards` reorders the
 * cards for display (a deck is a set; the talents follow their cards); `hits` (the cards a card search found) or `dim` (the card
 * the visitor lacks) dims the other cards.
 */
export function deckRow(r, rankLabel, { cards = r.cards, tag = null, note = null, badge = null, hits = null, dim = null } = {}) {
  const talentOf = (c) => r.talents[r.cards.indexOf(c)];
  const miss = (c) => (hits ? !hits.includes(c) : !!(dim && dim.includes(c)));
  return h("article.deck", [
    // the list position (not a rank: the deck's rank is its final's, beside its figure)
    h("div.deck-head", [h("h3.rk", [rankLabel, h("span.sr", " " + r.cards.map(cardName).join(", "))]), tag, badge]),
    h("div.deck-body", [
      h("div.deck-cards", cards.map((c) => deckSlot(c, talentOf(c), { miss: miss(c) }))),
      h("div.deck-facts", [deckFacts(r), note]),
    ]),
  ]);
}

/** The "Missing: <chip>" line of a deck one card away. */
export const missingLine = (c) => h("p.dr-miss", [h("span.muted", t("md.missing") + " "), chip(c)]);

/** A list that shows `page` rows and appends the next `page` on demand, without re-rendering what is already there. */
export function paged(items, mk, page = 8) {
  let shown = Math.min(page, items.length);
  const list = h("div.rk-list.decklist", items.slice(0, shown).map((it, i) => mk(it, i)));
  const count = h("p.muted", { "aria-live": "polite" });
  const btn = h("button.btn.soft", { type: "button", onclick: () => {
    const next = Math.min(items.length, shown + page);
    const fresh = items.slice(shown, next).map((it, i) => mk(it, shown + i));
    list.append(...fresh);
    shown = next;
    paint();
    const first = fresh[0] && fresh[0].querySelector("button");
    if (first) first.focus({ preventScroll: true });
  } });
  const paint = () => {
    count.textContent = t("md.showing", { a: shown, b: items.length });
    btn.textContent = t("md.showMore", { n: Math.min(page, items.length - shown) });
    btn.hidden = shown >= items.length;
  };
  paint();
  return h("div", [list, items.length > page ? h("div.more", [count, btn]) : null]);
}

/** The footer's line on the talents picked against the opponent, led by their mark (the Deck tier list's, My decks', the Deck
 * builder's Method). */
export function matchupLine() {
  return h("p.mu-line", [matchupMark({ label: "tl.matchupTag" }), " ", t("rk.mMatchup")]);
}

// ---------------------------------------------------------------- what each round means (footer)
/** What each round of the tournament means, for the footer Method sub-sections of My decks and the Deck builder (until
 * 2026-10-24 the "How reliable?" disclosure above their lists): the stage meter before each round, its decks and games. */
export function legendNodes() {
  const st = DB.decks.stages, race = st.race;
  const count = (l) => DB.decks.rows.filter((r) => r.level === l).length;
  const desc = {
    3: t("ev.3.desc", { n: st.final.opponents, per: gameSpan(st.final.games_per_opponent) }),
    2: t(race.from_screen != null ? "ev.2.desc" : "ev.2.descAll", { n: race.opponents, min: race.games_min, max: race.games_max, decks: race.decks,
      screen: race.from_screen, direct: race.direct, checks: race.checks, keep: race.kept }),
    1: st.screen ? t("ev.1.desc", { min: st.screen.games_min, max: st.screen.games_max, decks: st.screen.decks, keep: st.screen.kept }) : "",
  };
  const R = DB.ranking, vt = R && R.by_score.vs_top;
  return [
    t("md.legendP"),
    h("ul.levels", [
      ...[3, 2, 1].filter((l) => count(l)).map((l) => h("li", [meter(l), h("div", [h("b", t("st." + STAGE[l])),
        h("span.muted", ` · ${t("md.levelDecks", { n: count(l) })} · `), desc[l]])])),
      vt ? h("li", [h("span.meter-gap", { "aria-hidden": "true" }), h("div", [h("b", t("st.top", { n: topSize() })), h("span.muted", " · "),
        t("md.topDesc", { decks: R.by_score.decks.length, gpp: gameSpan(vt.games_per_pair) })])]) : null,
    ]),
    t("md.mCut"),
  ];
}
