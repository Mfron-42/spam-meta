// The one way to list measured decks (the ranking run's deck table, ranking-decks.json), shared by My decks and the Deck
// builder, and the deck parts the Deck tier list reuses: a deck's card with its talent under it, the stage meter, a deck's facts
// (its last completed phase and win rate, big, then its other phases, small), the owned badge; and, for the two deck table views,
// the paging and the "How reliable?" legend. Rows arrive
// sorted by the furthest stage reached, then the score there (docs/DATA.md, "ranking-decks.json"), so a filter that keeps
// their order keeps the canonical ranking.

import { h, icon, pct1, pm, dec } from "./util.js?v=ba817a7942";
import { DB, deckKey } from "./data.js?v=ba817a7942";
import { getLang, isOwned, ownedCount } from "./store.js?v=ba817a7942";
import { gameCard, chip, cardName, L } from "./cards.js?v=ba817a7942";
import { disclosure } from "./ui.js?v=ba817a7942";
import { t, tx } from "./i18n.js?v=ba817a7942";
import { introLine, provBanner, gameSpan } from "./patch.js?v=ba817a7942";

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
      h("span", { lang: getLang() }, [h("span.sr", t("rk.talentSr")), h("span", { translate: "no" }, L(tl, "name"))])]) : null,
  ]);
}

// ---------------------------------------------------------------- a deck's phases
const PHASES = ["screen", "race", "final"];
const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
let rrByKey = null;

/** A deck's win rate against the previous top 16 (ranking.json, the 30 best by win rate: the deck table holds the place only). */
function rtReading(cards) {
  const R = DB.ranking;
  if (!R) return null;
  if (!rrByKey) rrByKey = new Map(R.by_score.decks.filter((x) => x.round_robin).map((x) => [deckKey(x.cards), x.round_robin]));
  return rrByKey.get(deckKey(cards.map((c) => c.id))) || null;
}

/**
 * A deck's facts, the one component of every deck row (DESIGN.md "Deck facts"; owner, 2026-10-24: "la dernière phase complétée,
 * son win rate, et en plus petit les autres phases complétées et leur win rate", the same in the tier list, the speed list, My
 * decks and the Deck builder):
 * - the last phase the deck completed, big: the stage meter, the phase's name ("Final", "Race", "First sort") and its win rate,
 *   with the final's margin;
 * - `rounds` (the two tier lists: `{value, pm, title}`), its rounds to win as one quiet line, in the same place on every row;
 * - every other phase it completed, small, as its name and its win rate ("First sort 77.1%", "Race 83.3%", "Final 69.7%"), and
 *   its win rate against the previous top 16 when it played it (the deck table gives the place only: "#31" when no rate is known).
 * Games, ranks, where a deck went next and how reliable a stage is are each value's title and follow for screen readers; the row
 * itself carries no sentence. `r` is a deck table row, or a row the Deck tier list builds from ranking.json without the table.
 */
export function deckFacts(r, { rounds = null } = {}) {
  const s = r.stages, n = DB.decks ? DB.decks.stages : null, last = STAGE[r.level];
  const rate = (st) => (st === "final" ? s.final.score : s[st].rate);
  const games = (x) => (x && x.games ? t("ui.comma") + t("jy.games", { games: x.games }) : "");
  const basis = (st) => {
    const x = s[st];
    if (st === "final") return (n ? t("jy.final", { rank: x.rank, n: n.final.decks }) : "#" + x.rank) + games(x);
    if (st === "race") {
      return cap(t("jy.games", { games: x.games })) + t("ui.comma") + t(x.kept ? "jy.toFinal" : "jy.stopped") +
        (!s.screen && n && n.screen ? t("ui.comma") + t("jy.direct") : "");
    }
    return cap(t("jy.games", { games: x.games })) + t("ui.comma") + t(x.kept ? "jy.kept" : s.race ? "jy.check" : "jy.stopped");
  };
  const name = (st) => t("st." + st);
  const small = (label, value, title) => h("li", { title }, [
    h("span.ms-k", label), h("b.ms-n", value), h("span.sr", t("ui.sep") + title)]);
  const figTitle = basis(last) + t("ui.dot") + t("ev." + r.level);
  const items = PHASES.filter((st) => st !== last && s[st]).map((st) => small(name(st), pct1(rate(st)), basis(st)));
  const rr = s.rt || r.rr ? (r.rr || rtReading(r.cards)) : null;
  if (rr || s.rt) {
    const place = s.rt && n ? t("jy.rt", { place: s.rt, n: n.round_robin.decks }) : null;
    const tip = rr ? rtTip(rr) : "";
    items.push(small(t("st.rtShort"), rr ? pct1(rr.win_rate) : "#" + s.rt, [place, tip].filter(Boolean).join(t("ui.comma"))));
  }
  return h("div.dfacts", [
    h("div.dr-fig", { title: figTitle }, h("p.fig-line", [
      meter(r.level),
      h("span.fig-k", name(last)),
      h("b.stat-v", pct1(rate(last))),
      last === "final" && s.final.ci95 != null ? h("span.fig-pm", pm(s.final.ci95)) : null,
      h("span.sr", t("ui.sep") + figTitle),
    ])),
    rounds ? h("p.ms-line", { title: rounds.title }, [h("span.ms-k", t("ms.rounds")), h("b.ms-n", dec(rounds.value, 1)),
      h("span.ms-pm", "±" + dec(rounds.pm, 1)), h("span.sr", t("ui.sep") + rounds.title)]) : null,
    // role="list": a list drawn without markers loses its list role in WebKit
    items.length ? h("ol.ms", { role: "list", "aria-label": t("jy.aria") }, items) : null,
  ]);
}

/** The basis of a win rate against the previous top 16: its games against that field (a deck of it plays the others). */
function rtTip(rr) {
  const R = DB.ranking, field = R && R.round_robin ? R.round_robin.field : null;
  if (!field || rr.opponents == null) return "";
  return t(rr.opponents < field ? "rk.rrTipIn" : "rk.rrTip", { games: rr.games, opp: rr.opponents, field });
}

/**
 * The head of a view that lists the deck table (My decks, the Deck builder): the title, the temporary-ranking banner while
 * the run is not final, and the intro line whose "About the numbers" says why it is temporary and what the table holds.
 */
export function tableHead(key, h1, lede) {
  const D = DB.decks.raw, R = DB.ranking;
  const method = [
    D.final ? null : h("p", [...tx("rk.mWhy"), R ? " " + t("rk.mBench", { n: R.by_score.opponents }) : ""]),
    t("md.mTable", { n: DB.decks.rows.length }),
    D.not_listed ? t("md.mNotListed", { n: D.not_listed }) : null,
  ];
  return h("div.vhead", [
    h("h1", h1),
    D.final ? null : provBanner(key),
    ...introLine(key, h("p.lede", lede), { method, patch: D.patch }),
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

// ---------------------------------------------------------------- legend
/** The "How reliable?" disclosure: what each stage of the ranking run means. `state.open` survives a redraw. */
export function legend(id, state) {
  const btn = h("button.btn.ghost.disc", { type: "button", "aria-controls": id }, [icon("info"), t("md.legend"), icon("chevron")]);
  const st = DB.decks.stages, race = st.race;
  const count = (l) => DB.decks.rows.filter((r) => r.level === l).length;
  const desc = {
    3: t("ev.3.desc", { n: st.final.opponents, per: gameSpan(st.final.games_per_opponent) }),
    2: t(race.from_screen != null ? "ev.2.desc" : "ev.2.descAll", { n: race.opponents, min: race.games_min, max: race.games_max, decks: race.decks,
      screen: race.from_screen, direct: race.direct, checks: race.checks, keep: race.kept }),
    1: st.screen ? t("ev.1.desc", { min: st.screen.games_min, max: st.screen.games_max, decks: st.screen.decks, keep: st.screen.kept }) : "",
  };
  const region = h("div", { id }, h("div.collapse-in", h("div.guide", [
    h("p", t("md.legendP")),
    h("p.muted", t("md.mCut")),
    h("ul.levels", [
      ...[3, 2, 1].filter((l) => count(l)).map((l) => h("li", [meter(l), h("div", [h("b", t("st." + STAGE[l])),
        h("span.muted", ` · ${t("md.levelDecks", { n: count(l) })} · `), desc[l]])])),
      // the round robin of the final's best against the best decks of version 2 (its field): a second reading that sets no stage
      st.round_robin && st.round_robin.decks ? h("li", [h("span.meter-gap", { "aria-hidden": "true" }), h("div", [h("b", t("st.rt")),
        h("span.muted", " · "), t("md.rtDesc", { decks: st.round_robin.decks, field: st.round_robin.field || st.round_robin.decks })])]) : null,
    ]),
  ])));
  disclosure(btn, region, { open: state.open, onToggle: (v) => { state.open = v; } });
  return h("div.guide-wrap", [btn, region]);
}
