// The one way to list measured decks (decks.json rows), shared by My decks and the Deck builder: the deck row (four game
// cards, the evidence level, the win rate, the tier tag), the paging, the "How reliable?" legend and the owned badge. Rows arrive already sorted by the rank key of docs/DATA.md (level
// descending, then rank_score), so a filter that keeps their order keeps the canonical ranking.

import { h, icon, pct } from "./util.js?v=a7940cbe94";
import { DB, deckKey } from "./data.js?v=a7940cbe94";
import { isOwned, ownedCount } from "./store.js?v=a7940cbe94";
import { gameCard, chip } from "./cards.js?v=a7940cbe94";
import { disclosure } from "./ui.js?v=a7940cbe94";
import { t } from "./i18n.js?v=a7940cbe94";

// ---------------------------------------------------------------- evidence, in plain words
// level -> funnel stage; the numbers of each stage come from meta.json `methodology.pipeline`
export const STAGE = { 4: "finals", 3: "round_robin", 2: "halving", 1: "screen" };
const stageOf = (level) => (DB.meta.methodology.pipeline || []).find((s) => s.stage === STAGE[level]) || {};

/** What the deck's own test was, in one line ("ev.<level>.text"). */
function evidenceText(r) {
  const fin = stageOf(4);
  return t(`ev.${r.level}.text`, { games: r.games, r: r.rounds, opp: fin.decks ? fin.decks - 1 : 9 });
}

/** What a level means, for the legend ("ev.<level>.desc"). */
function levelText(level) {
  const s = stageOf(level), g = s.rounds_games || [];
  return t(`ev.${level}.desc`, { gpp: s.games_per_pair, decks: s.decks, probes: s.probe_decks, min: g[0], max: g[g.length - 1],
    refs: s.reference_decks, games: s.games_per_deck });
}

function meter(level) {
  return h("span.meter", { role: "img", "aria-label": t("md.meter", { l: level }) }, [1, 2, 3, 4].map((i) => h("i", { class: i <= level ? "on" : "" })));
}

/** The tier-list entry with the same 4 cards, or null (the tier list did not load, or the deck is not in the top 30). */
const tierDeckOf = (r) => (DB.tierBySet ? DB.tierBySet.get(deckKey(r.cards.filter(Boolean).map((c) => c.id))) || null : null);

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
 * A measured deck as a row: its rank label, its four game cards (list size), its evidence level and win rate, its tier tag.
 * `cards` reorders the cards for display (a deck is a set); `tag` is one more quiet tag; `note` and `badge` are nodes
 * added under the facts (a "missing" line, an owned badge); `hits` (the cards a card search found) dims the other cards.
 */
export function deckRow(r, rankLabel, { cards = r.cards, tag = null, note = null, badge = null, hits = null } = {}) {
  const tr = tierDeckOf(r);
  const rank = tr ? tr.rank : r.tierRank;
  const tags = [tag, rank ? h("span.tag", tr ? t("md.tagTier", { tier: tr.tier, rank }) : t("md.tagRank", { rank })) : null].filter(Boolean);
  return h("article.dr", [
    h("div.dr-rank", [h("h3.rk", rankLabel)]),
    h("div.deck-cards", cards.map((c) => h("div.slot", { class: hits && !hits.includes(c) ? "miss" : null }, gameCard(c, { size: "list" })))),
    h("div.dr-info", [
      h("div.ev", [meter(r.level), h("b", t(`stage.${STAGE[r.level]}.title`)), h("span.muted", t("ev." + r.level))]),
      h("div.dr-fig", [h("b.stat-v", pct(r.rate)), h("span.stat-s", t("md.rateCap"))]),
      h("p.dr-t", evidenceText(r)),
      note,
      tags.length ? h("div.tags", tags) : null,
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
/** The "How reliable?" disclosure: what each evidence level means. `state.open` survives a redraw. */
export function legend(id, state) {
  const btn = h("button.btn.ghost.disc", { type: "button", "aria-controls": id }, [icon("info"), t("md.legend"), icon("chevron")]);
  const lv = DB.decks.levels;
  const region = h("div", { id }, h("div.collapse-in", h("div.guide", [
    h("p", t("md.legendP")),
    h("ul.levels", [4, 3, 2, 1].map((l) => h("li", [meter(l), h("div", [h("b", t(`stage.${STAGE[l]}.title`)),
      h("span.muted", ` · ${t("md.levelDecks", { n: lv[l].decks })} · `), levelText(l)])]))),
  ])));
  disclosure(btn, region, { open: state.open, onToggle: (v) => { state.open = v; } });
  return h("div.guide-wrap", [btn, region]);
}
