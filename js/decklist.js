// The one way to list measured decks (the ranking run's deck table, ranking-decks.json), shared by My decks and the Deck
// builder, and the deck parts the Deck tier list reuses: a deck's card with its talent under it, the stage meter and its
// caption, the journey (the stages a deck played and its score at each), the owned badge; and, for the two deck table views,
// the paging and the "How reliable?" legend. Rows arrive
// sorted by the furthest stage reached, then the score there (docs/DATA.md, "ranking-decks.json"), so a filter that keeps
// their order keeps the canonical ranking.

import { h, icon, pct1, pm } from "./util.js?v=f04c2f75e4";
import { DB } from "./data.js?v=f04c2f75e4";
import { getLang, isOwned, ownedCount } from "./store.js?v=f04c2f75e4";
import { gameCard, chip, cardName, L } from "./cards.js?v=f04c2f75e4";
import { disclosure } from "./ui.js?v=f04c2f75e4";
import { t, tx } from "./i18n.js?v=f04c2f75e4";
import { introLine, provBanner, gameSpan } from "./patch.js?v=f04c2f75e4";

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

/** A caption under a deck's figure, led by the stage meter of the furthest stage it reached: `text` says what the figure is. */
export const stageCaption = (level, text) => h("p.ev", [meter(level), h("span", text)]);

/** The caption under a deck's figure: the stage meter, then what the figure is and how reliable it is ("win rate in the
 * race · Fairly reliable"). Every measured deck carries it (My decks, the Deck builder), so a deck reads the same everywhere. */
export const evLine = (level) => stageCaption(level, t("md.rateCap." + STAGE[level]) + t("ui.dot") + t("ev." + level));

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
 * score"): the first sort (kept or not; a deck not kept but raced was one of the random checks; a deck the run seeded straight
 * into the race says so on that line), the race (sent to the final or not), the final (its rank among the 60, and its score
 * unless the row's figure is that score), the top-16 round robin (place). Each stage keeps its best `kept` decks by a cautious
 * reading (DATA.md), so the lines say kept or stopped, never a cut score.
 * `figure`: the stage whose score is the row's figure, so its line drops the number (default the furthest stage, as on My decks
 * and the Deck tier list's win-rate list; null when the figure is not a win rate, as on the speed list, so the final's line then
 * carries its score). `rr`: the deck's round-robin win rate when the view has it (`{rate, title}`, ranking.json), printed after
 * its place with its basis as the title; the deck table holds the place only.
 */
export function journey(r, { figure = STAGE[r.level], rr = null } = {}) {
  const s = r.stages, n = DB.decks.stages;
  const games = (stage, x) => t("jy.games", { games: x.games }) + (stage === figure ? "" : t("ui.comma") + pct1(x.rate));
  const li = (stage, text, title = null) => h("li", [h("span.jy-s", t("st." + stage) + t("jy.sep")), h("span", { title }, text)]);
  const items = [];
  if (s.screen) {
    const word = s.screen.kept ? "jy.kept" : s.race ? "jy.check" : "jy.stopped";
    items.push(li("screen", games("screen", s.screen) + t("ui.comma") + t(word)));
  } else if (s.race && n.screen) {
    // seeded straight into the race: its first sort says so, so every stage keeps one line of its own
    items.push(li("screen", t("jy.direct")));
  }
  if (s.race) items.push(li("race", games("race", s.race) + t("ui.comma") + t(s.race.kept ? "jy.toFinal" : "jy.stopped")));
  if (s.final) {
    items.push(li("final", figure === "final" ? t("jy.final", { rank: s.final.rank, n: n.final.decks })
      : t("jy.finalPct", { rank: s.final.rank, n: n.final.decks, pct: pct1(s.final.score) })));
  }
  if (s.rt) {
    // the round robin's basis is the value's title, and the same words follow for screen readers (a title alone is not read)
    items.push(rr ? li("rt", [t("jy.rtPct", { place: s.rt, n: n.round_robin.decks, pct: pct1(rr.rate) }), h("span.sr", t("ui.sep") + rr.title)], rr.title)
      : li("rt", t("jy.rt", { place: s.rt, n: n.round_robin.decks })));
  }
  // role="list": a list drawn without markers loses its list role in WebKit
  return h("ol.jy", { role: "list", "aria-label": t("jy.aria") }, items);
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
 * A measured deck as a row, in the Deck tier list's pattern (DESIGN.md "Deck row"): on the ground, a head (its place in this
 * list, the four card names hidden after it for screen readers, a quiet word, the owned badge pushed right), then its four game
 * cards with their talents and its facts: the win rate at its furthest stage with the stage meter caption, its journey, a
 * "Missing:" / "Without:" line. On one column the figure comes before the cards and the journey after them. `cards` reorders the
 * cards for display (a deck is a set; the talents follow their cards); `hits` (the cards a card search found) or `dim` (the card
 * the visitor lacks) dims the other cards.
 */
export function deckRow(r, rankLabel, { cards = r.cards, tag = null, note = null, badge = null, hits = null, dim = null } = {}) {
  const talentOf = (c) => r.talents[r.cards.indexOf(c)];
  const miss = (c) => (hits ? !hits.includes(c) : !!(dim && dim.includes(c)));
  return h("article.deck", [
    // the list position (not a rank: the deck's rank is its final's, in the journey)
    h("div.deck-head", [h("h3.rk", [rankLabel, h("span.sr", " " + r.cards.map(cardName).join(", "))]), tag, badge]),
    h("div.deck-body", [
      h("div.deck-cards", cards.map((c) => deckSlot(c, talentOf(c), { miss: miss(c) }))),
      h("div.deck-facts", [
        h("div.dfacts", h("div.dr-fig", [
          h("span.fig-line", [h("b.stat-v", pct1(r.rate)), r.level === 3 ? h("span.fig-pm", { title: t("tl.pmTip") }, pm(r.stages.final.ci95)) : null]),
          evLine(r.level),
        ])),
        journey(r),
        note,
      ]),
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
      // the round robin of the best 16: a second reading that sets no stage
      st.round_robin && st.round_robin.decks ? h("li", [h("span.meter-gap", { "aria-hidden": "true" }), h("div", [h("b", t("st.rt")),
        h("span.muted", " · "), t("md.rtDesc", { decks: st.round_robin.decks })])]) : null,
    ]),
  ])));
  disclosure(btn, region, { open: state.open, onToggle: (v) => { state.open = v; } });
  return h("div.guide-wrap", [btn, region]);
}
