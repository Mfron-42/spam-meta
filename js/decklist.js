// The one way to list measured decks (the ranking run's deck table, ranking-decks.json), shared by My decks and the Deck
// builder, and the deck parts the Deck tier list reuses: a deck's card with its talent under it, the stage line, the journey
// (the stages a deck played and its score at each), the paging, the "How reliable?" legend and the owned badge. Rows arrive
// sorted by the furthest stage reached, then the score there (docs/DATA.md, "ranking-decks.json"), so a filter that keeps
// their order keeps the canonical ranking.

import { h, icon, pct1, pm } from "./util.js?v=92a8dd692d";
import { DB } from "./data.js?v=92a8dd692d";
import { getLang, isOwned, ownedCount } from "./store.js?v=92a8dd692d";
import { gameCard, chip, cardName, L } from "./cards.js?v=92a8dd692d";
import { disclosure } from "./ui.js?v=92a8dd692d";
import { t, tx } from "./i18n.js?v=92a8dd692d";
import { introLine, provBanner } from "./patch.js?v=92a8dd692d";

// ---------------------------------------------------------------- stages, in plain words
// level -> stage of the ranking run: 3 the final (the full AI against the benchmark decks), 2 the race (its faster setting),
// 1 the first sort (an old fast AI, 12 games)
export const STAGE = { 3: "final", 2: "race", 1: "screen" };
const LEVELS = 3;

function meter(level) {
  return h("span.meter", { role: "img", "aria-label": t("md.meter", { l: level, n: LEVELS }) },
    Array.from({ length: LEVELS }, (_, i) => h("i", { class: i < level ? "on" : "" })));
}

/** The caption under a deck's figure: the stage meter, then what the figure is and how reliable it is ("win rate in the
 * race · Fairly reliable"). Every measured deck carries it (My decks, the Deck builder), so a deck reads the same everywhere. */
export const evLine = (level) => h("p.ev", [meter(level), h("span", t("md.rateCap." + STAGE[level]) + t("ui.dot") + t("ev." + level))]);

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

// ---------------------------------------------------------------- the journey
/**
 * The stages a deck played and its score at each (owner, 2026-10-23: "à quelle étape du tournoi il s'est arrêté et avec quel
 * score"): the first sort (kept or not; a deck not kept but raced was one of the random checks; a deck with no first sort went
 * straight to the race), the race (sent to the final or not), the final (rank, score and margin), the top-16 round robin
 * (place). Each stage keeps its best `kept` decks by a cautious reading (DATA.md), so the line says "among the 60", not a cut.
 */
export function journey(r) {
  const s = r.stages, n = DB.decks.stages, top = STAGE[r.level];
  // the furthest stage's score is the row's figure: its line keeps the games and what happened, not the number again
  const games = (stage, x) => t("jy.games", { games: x.games }) + (stage === top ? "" : t("ui.comma") + pct1(x.rate));
  const li = (stage, text) => h("li", [h("span.jy-s", t("st." + stage) + t("jy.sep")), h("span", text)]);
  const items = [];
  if (s.screen) {
    const word = s.screen.kept ? "jy.kept" : s.race ? "jy.check" : "jy.stopped";
    items.push(li("screen", games("screen", s.screen) + t("ui.comma") + t(word)));
  }
  if (s.race) {
    const word = t(s.race.kept ? "jy.toFinal" : "jy.stopped") + (!s.screen && n.screen ? t("jy.direct") : "");
    items.push(li("race", games("race", s.race) + t("ui.comma") + word));
  }
  if (s.final) items.push(li("final", t("jy.final", { rank: s.final.rank, n: n.final.decks })));
  if (s.rt) items.push(li("rt", t("jy.rt", { place: s.rt, n: n.round_robin.decks })));
  return h("ol.jy", { "aria-label": t("jy.aria") }, items);
}

/**
 * The head of a view that lists the deck table (My decks, the Deck builder): the title, the temporary-ranking banner while
 * the run is not final, and the intro line whose "About the numbers" says why it is temporary and what the table holds.
 */
export function tableHead(key, h1, lede) {
  const D = DB.decks.raw, R = DB.ranking;
  const method = [
    D.final ? null : h("p", tx("rk.mWhy")),
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
 * A measured deck as a row: its rank label, its four game cards with their talents, its stage line, its score at that stage
 * and its journey (its rank in the final is its rank on the Deck tier list). `cards` reorders the cards for display (a deck is a set; the
 * talents follow their cards); `tag` is one more quiet tag; `note` and `badge` are nodes added under the facts (a "missing"
 * line, an owned badge); `hits` (the cards a card search found) dims the other cards.
 */
export function deckRow(r, rankLabel, { cards = r.cards, tag = null, note = null, badge = null, hits = null, dim = null } = {}) {
  const talentOf = (c) => r.talents[r.cards.indexOf(c)];
  const miss = (c) => (hits ? !hits.includes(c) : !!(dim && dim.includes(c)));
  return h("article.dr", [
    // the list position (not a rank: the deck's rank is its final's, in the journey); its cards name the row for screen readers
    h("div.dr-rank", [h("h3.rk", [rankLabel, h("span.sr", " " + r.cards.map(cardName).join(", "))])]),
    h("div.deck-cards", cards.map((c) => deckSlot(c, talentOf(c), { miss: miss(c) }))),
    h("div.dr-info", [
      h("div.dr-fig", [
        h("span.fig-line", [h("b.stat-v", pct1(r.rate)), r.level === 3 ? h("span.fig-pm", { title: t("tl.pmTip") }, pm(r.stages.final.ci95)) : null]),
        evLine(r.level),
      ]),
      journey(r),
      note,
      tag ? h("div.tags", tag) : null,
      badge,
    ]),
  ]);
}

/** The "Missing: <chip>" line of a deck one card away. */
export const missingLine = (c) => h("p.dr-miss", [h("span.muted", t("md.missing") + " "), chip(c)]);

/** A list that shows `page` rows and appends the next `page` on demand, without re-rendering what is already there. */
export function paged(items, mk, page = 8) {
  let shown = Math.min(page, items.length);
  const list = h("div.drs", items.slice(0, shown).map((it, i) => mk(it, i)));
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
    3: t("ev.3.desc", { n: st.final.opponents, per: st.final.games_per_opponent }),
    2: t(race.from_screen != null ? "ev.2.desc" : "ev.2.descAll", { n: race.opponents, min: race.games_min, max: race.games_max, decks: race.decks,
      screen: race.from_screen, direct: race.direct, checks: race.checks, keep: race.kept }),
    1: st.screen ? t("ev.1.desc", { games: st.screen.games, decks: st.screen.decks, keep: st.screen.kept }) : "",
  };
  const region = h("div", { id }, h("div.collapse-in", h("div.guide", [
    h("p", t("md.legendP")),
    h("p.muted", t("md.mCut")),
    h("ul.levels", [
      ...[3, 2, 1].filter((l) => count(l)).map((l) => h("li", [meter(l), h("div", [h("b", t("st." + STAGE[l])),
        h("span.muted", ` · ${t("md.levelDecks", { n: count(l) })} · `), desc[l]])])),
      // the round robin of the best 16: a second reading that sets no stage
      st.round_robin && st.round_robin.decks ? h("li", [h("span.meter-gap", { "aria-hidden": "true" }), h("div", [h("b", t("st.rt")),
        h("span.muted", " · "), t("md.rtDesc", { decks: st.round_robin.decks })])]) : null,
    ]),
  ])));
  disclosure(btn, region, { open: state.open, onToggle: (v) => { state.open = v; } });
  return h("div.guide-wrap", [btn, region]);
}
