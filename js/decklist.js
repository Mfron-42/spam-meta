// The one way to list measured decks (the ranking run's deck table, ranking-decks.json), shared by My decks and the Deck
// builder, and the deck parts the Deck tier list reuses: a deck's card with its talent under it, the stage meter, a deck's facts
// (My decks and the Deck builder) and a listed deck's three figures with their notes (the Deck tier list, listFigures), the owned
// badge; and, for the two deck
// table views, the paging and their footer Method sub-section (what each stage of the ranking means, which "How reliable?" said
// above the list until 2026-10-24). Rows arrive sorted by the furthest stage reached, then the score there (docs/DATA.md,
// "ranking-decks.json"), so a filter that keeps their order keeps the canonical ranking.

import { h, icon, pct, pct1, pm, dec, fmtInt } from "./util.js?v=c953b2bc64";
import { DB, deckKey } from "./data.js?v=c953b2bc64";
import { getLang, isOwned, ownedCount } from "./store.js?v=c953b2bc64";
import { gameCard, chip, cardName, L } from "./cards.js?v=c953b2bc64";
import { t, tx } from "./i18n.js?v=c953b2bc64";
import { tipButton } from "./cardtext.js?v=c953b2bc64";
import { introLine, provBanner, gameSpan, medianRounds, isMatchupTalent, matchupMark, DECK_TABLE_PREVIOUS } from "./patch.js?v=c953b2bc64";

// ---------------------------------------------------------------- stages, in plain words
// The stages of the ranking, in order (owner, 2026-10-25: each name means one stage only): the First sort (a fast AI), the
// Tournament and the Qualifier (our AI against the 12 benchmark decks; the Qualifier with more games), then the Final (the
// Qualifier's best decks against each other, ranking.json `vs_top`). The deck table names the first three by its own keys
// (`stages.screen`, `.race`, `.final`); level -> that key: 3 the Qualifier, 2 the Tournament, 1 the First sort.
export const STAGE = { 3: "final", 2: "race", 1: "screen" };
const STAGE_NAME = { final: "st.qual", race: "st.race", screen: "st.screen" };
/** A deck table stage's name ("Qualifier", "Tournament", "First sort"). */
export const stageName = (st) => t(STAGE_NAME[st]);
const LEVELS = 3;

/** The stage meter: three small bars, filled to the furthest stage a deck reached, the empty ones hollow (DESIGN.md "Stage
 * meter"); its name, also its title, says which stage ("Stage 2 of 3: Tournament"). */
export function meter(level) {
  const name = t("md.meter", { l: level, n: LEVELS, stage: stageName(STAGE[level]) });
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
// the deck table's stages a deck can have played, in order (owner, 2026-10-24: every figure is named by the stage it comes from,
// never by a version): the First sort, the Tournament, the Qualifier; then the Final (`vs_top`) and how fast it wins
const PHASES = ["screen", "race", "final"];
const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
let topByKey = null;

/** The number of decks of the Final list (ranking.json `by_score`: the Qualifier's best decks that played each other), 0 without
 * the ranking. */
export const topSize = () => (DB.ranking && DB.ranking.by_score ? DB.ranking.by_score.decks.length : 0);

/** A deck's Final reading (ranking.json `vs_top`: its win rate against the other decks of the Final), or null. */
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
  return h("p", tx("rk.mAIs", { race: names(P.race), top_ai: names(P.top) }));
}

/** The title of a Final reading on My decks and the Deck builder: its games, the field, the margin; 50% is the Final's level. */
export function topTip(v) {
  const R = DB.ranking, gpp = R && R.by_score.vs_top ? gameSpan(R.by_score.vs_top.games_per_pair) : "";
  return t("vt.tip", { v: pct1(v.win_rate), games: fmtInt(v.games), opp: v.opponents, gpp, pm: pm(v.ci95) });
}

/**
 * A deck's facts on My decks and the Deck builder (DESIGN.md "Deck facts"): the furthest stage of the deck table it completed,
 * big, with the stage meter, its name ("Qualifier", "Tournament", "First sort") and its win rate (the Qualifier's margin), then
 * its other stages small, and its Final win rate when it played the Final. The row carries no sentence: each value's basis is its
 * title and its screen-reader text. `r` is a deck table row.
 */
export function deckFacts(r) {
  const s = r.stages, n = DB.decks ? DB.decks.stages : null, last = STAGE[r.level];
  const rate = (st) => (st === "final" ? s.final.score : s[st].rate);
  const games = (x) => (x && x.games ? t("ui.comma") + t("jy.games", { games: x.games }) : "");
  const basis = (st) => {
    const x = s[st];
    if (st === "final") return (n ? t("jy.final", { rank: x.rank, n: n.final.decks }) : "#" + x.rank) + games(x);
    if (st === "race") {
      return cap(t("jy.games", { games: x.games })) + t("ui.comma") + t(x.kept ? "jy.toQual" : "jy.stopped") +
        (!s.screen && n && n.screen ? t("ui.comma") + t("jy.direct") : "");
    }
    return cap(t("jy.games", { games: x.games })) + t("ui.comma") + t(x.kept ? "jy.kept" : s.race ? "jy.check" : "jy.stopped");
  };
  const small = (label, value, title) => h("li", { title }, [
    h("span.ms-k", label), h("b.ms-n", value), h("span.sr", t("ui.sep") + title)]);
  const top = topReading(r.cards);
  const figTitle = basis(last) + t("ui.dot") + t("ev." + r.level);
  const items = PHASES.filter((st) => st !== last && s[st]).map((st) => small(stageName(st), pct1(rate(st)), basis(st)));
  if (top) items.push(small(t("st.final"), pct1(top.win_rate), topTip(top)));
  return h("div.dfacts", [
    h("div.dr-fig", { title: figTitle }, h("p.fig-line", [
      meter(r.level),
      h("span.fig-k", stageName(last)),
      h("b.stat-v", pct1(rate(last))),
      last === "final" && s.final.ci95 != null ? h("span.fig-pm", pm(s.final.ci95)) : null,
      h("span.sr", t("ui.sep") + figTitle),
    ])),
    // role="list": a list drawn without markers loses its list role in WebKit
    items.length ? h("ol.ms", { role: "list", "aria-label": t("jy.aria") }, items) : null,
  ]);
}

// ---------------------------------------------------------------- a listed deck's three figures (the Deck tier list)
// the Deck tier list's three lists, in its switch's order (the lead, 2026-10-27: the players' meta first and by default); a
// listed deck's figures follow the same names and the same order
export const LISTS = ["meta", "top", "speed"];

/** A signed number of points to one decimal: "+5.6", "−1.2". */
const pts = (x) => (x < 0 ? "−" : "+") + dec(Math.abs(x) * 100, 1);

/**
 * The three figures of a listed deck (DESIGN.md "Deck figures"): Players' meta, Against the top, Speed, named like the three lists
 * and always in their order, so they line up on every card; the active list's figure big, the others small. Each is a button that
 * explains itself with the page's tooltip (cardtext.js tipButton) on hover, keyboard focus or a tap, in plain sentences that are
 * also its description for a screen reader. Under a value, one quiet note when the figure needs it on its face: the AI that played
 * the players' meta (every row names its pilot: two AIs share that list), "core" under a finalist of the Nash core, "family cap"
 * under a deck its family's cap kept out of the final. A figure the deck lacks keeps its slot with a quiet state ("not in the
 * final", "too few wins") and its tooltip says why; no other number takes its place (a deck after the final is ranked by a rating
 * on another scale, which the site never prints). `d`: a deck of deck-lists.json; `active`: the list shown.
 */
export function listFigures(d, active) {
  const R = DB.lists, P = R.pilots;
  const big = (k) => k === active;
  const P1 = (v, k) => (big(k) ? pct1(v) : pct(v, 0));      // the active list's figure to one decimal, the others whole
  const fig = {};
  const m = d.meta, fast = m.pilot === "fast";
  const ai = (name) => h("span", { translate: "no" }, name);   // an AI's name is a code token: never machine-translated
  fig.meta = { value: P1(m.win_rate, "meta"), note: fast ? tx("fx.metaNoteFast", { ai: ai(P.fast) }) : ai(P.full),
    desc: t("fx.meta", { v: pct1(m.win_rate), pm: dec(m.ci95 * 100, 1), n: m.decks }) + " " +
      (fast ? t("fx.metaFast", { fast: P.fast, ai: P.full, shift: pts(R.meta.shift), n: R.meta.shift_decks }) : t("fx.metaFull", { ai: P.full })) };
  const tp = d.top, anchor = d.anchor ? " " + t("fx.anchor", { v: pct1(d.anchor.win_rate), games: fmtInt(d.anchor.games) }) : "";
  if (tp.win_rate != null) {
    const core = tp.core >= 0.5;
    fig.top = { value: P1(tp.win_rate, "top"), note: core ? t("fx.core") : null,
      desc: t("fx.top", { v: pct1(tp.win_rate), games: fmtInt(tp.games), opp: tp.opponents, pm: dec(tp.ci95 * 100, 1) }) +
        (core ? " " + t("fx.coreTip", { share: pct(tp.core, 0) }) : "") + anchor };
  } else {
    fig.top = { state: t("fx.topNo"), note: tp.family_capped ? t("fx.capped") : null,
      desc: t("fx.topNone", { n: R.top.final }) + (tp.family_capped ? " " + t("fx.cappedTip", { cap: R.top.family_cap }) : "") + anchor };
  }
  const ws = d.speed;
  fig.speed = ws.rounds != null
    ? { value: dec(ws.rounds, big("speed") ? 1 : 0), unit: t("fx.rounds"),
      desc: t("fx.speed", { v: dec(ws.rounds, 1), pm: dec(ws.rounds_ci95, 1), wins: fmtInt(ws.wins), median: medianRounds(R) }) }
    : { state: t("fx.fewWins"), desc: t("fx.speedFew", { wins: fmtInt(ws.wins || 0) }) };
  // a toolbar: the role that tells a screen reader the arrow keys move between its buttons
  const row = h("div.rfig", { role: "toolbar", "aria-label": t("fx.aria"), onkeydown: rove, onfocusin: keep }, LISTS.map((k, i) => {
    const f = fig[k], name = t("rk.list." + k);
    const value = f.state ? h("span.rf-s", f.state) : [h("b.rf-v", f.value), f.unit ? h("span.rf-u", " " + f.unit) : null];
    // the name and the value read as one ("Against the top, 67.0%"), the note after them, then the description
    const [b, dsc] = tipButton("button.rf" + (big(k) ? ".act" : "") + (f.state ? ".none" : ""), name,
      [h("span.rf-k", name), h("span.sr", t("ui.comma")), h("span.rf-n", value),
        h("span.rf-x", f.note ? [h("span.sr", t("ui.comma")), f.note] : null)], f.desc);
    if (i) b.tabIndex = -1;          // one tab stop per deck; the arrow keys move between its three figures
    return [b, dsc];
  }));
  return row;
}

/** A figure focused by a click or a tap becomes the deck's tab stop (roving focus). */
function keep(e) {
  const b = e.target.closest(".rf");
  if (b) e.currentTarget.querySelectorAll(".rf").forEach((x) => { x.tabIndex = x === b ? 0 : -1; });
}

/** The arrow keys inside a deck's figures (roving focus, as the Card tier list's icons): Left / Right, Home / End. */
function rove(e) {
  const bs = [...e.currentTarget.querySelectorAll(".rf")], i = bs.indexOf(document.activeElement);
  const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: bs.length - 1 }[e.key];
  if (i < 0 || to == null || to < 0 || to >= bs.length) return;
  e.preventDefault();
  bs.forEach((b, k) => { b.tabIndex = k === to ? 0 : -1; });
  bs[to].focus();
}

/**
 * The head of a view that lists the deck table (My decks, the Deck builder): the title and, while the run is not final, the
 * one-line temporary banner. Everything that explains (what the table holds, the decks it does not list, what each stage of the
 * ranking means, its games) goes to the view's footer Method sub-section (patch.js introLine; owner, 2026-10-24).
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
    // the deck table is still the previous ranking's (patch.js DECK_TABLE_PREVIOUS): said once, where the decks are read
    DECK_TABLE_PREVIOUS ? h("p.dnote.md-prev", [icon("info"), h("span", t("md.prev"))]) : null,
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

// ---------------------------------------------------------------- what each stage means (footer)
/** What each stage of the ranking means, for the footer Method sub-sections of My decks and the Deck builder (until 2026-10-24
 * the "How reliable?" disclosure above their lists), from the furthest: the Final, then the deck table's stages, each with its
 * stage meter, its decks and games. */
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
      vt ? h("li", [h("span.meter-gap", { "aria-hidden": "true" }), h("div", [h("b", t("st.final")), h("span.muted", " · "),
        t("md.topDesc", { decks: R.by_score.decks.length, gpp: gameSpan(vt.games_per_pair) })])]) : null,
      ...[3, 2, 1].filter((l) => count(l)).map((l) => h("li", [meter(l), h("div", [h("b", stageName(STAGE[l])),
        h("span.muted", ` · ${t("md.levelDecks", { n: count(l) })} · `), desc[l]])])),
    ]),
    t("md.mCut"),
  ];
}
