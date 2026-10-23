// Patch markers (DESIGN.md, "Patch mark"): which cards the last game patch changed, from cards.json `patch_change`, and
// the patch notice of the ranking views while the rankings are one patch behind the card data. One glyph, the diamond:
// filled when a value, an ability or a passive changed (the class "mechanical"), hollow when only talents or texts did.
// The data carries codes and positions; every word comes from i18n.js ("pc.*").

import { h, icon, fmtDate } from "./util.js?v=b2212b274c";
import { DB } from "./data.js?v=b2212b274c";
import { L } from "./cards.js?v=b2212b274c";
import { t } from "./i18n.js?v=b2212b274c";
import { disclosure } from "./ui.js?v=b2212b274c";

// Three patches can differ, and each label names the one it is about (SPEC.md, "Patch labels"):
// - the GAME patch, the client players run today (below; the lab reads it from the game files);
// - the CARD DATA patch, DB.patch (cards.json `patch`): card faces, card markers, the Codex;
// - the RANKINGS patch, DB.meta.patch (meta.json `patch`): decks, tiers, counters, games, everything measured.
// The game patch has no export of its own yet: bump it here when the lab reports a new client (the bundle version of the
// game build: 1.26, Steam build 26109944, the update of 2026-10-21 18:51).
export const GAME_PATCH = { patch: "1.26", date: "2026-10-21" };

// What the site shows of the rankings (SPEC.md section 3.7). Two switches; the views stay in the code either way.
// - DECK_RANKING_SHOWN: the Deck tier list draws the lab's deck ranking of the game patch (ranking.json, tiers.js), labelled
//   provisional while its `final` is false (owner, 2026-10-23: "mets en ligne le classement temporaire"), and the card view's
//   Meta section counts its decks. Off, the Deck tier list draws the "being computed" placeholder (pending.js).
// - RANKINGS_SHOWN: the rankings still on the 1.22 files (the Card tier list, My decks, the Deck builder, the card view's card
//   tier and "With and against"), off while the lab recomputes them (owner, 2026-10-21: "we keep only the codex"): the Card
//   tier list draws the placeholder, My decks and the Deck builder are not shown. Set it back to true when they are exported.
export const DECK_RANKING_SHOWN = true;
export const RANKINGS_SHOWN = false;

export const changeOf = (c) => (c && c.patch_change) || null;
/** A value, an ability or a passive changed: the rankings' numbers for this card are from before the change. */
export const numbersMoved = (c) => (changeOf(c) || {}).class === "mechanical";
/** The patch the rankings were computed on (meta.json), when it is older than the card data's (cards.json). */
export const rankingsBehind = () => (DB.meta && DB.patch && DB.meta.patch !== DB.patch ? DB.meta.patch : null);
/** The rankings patch, when it is not the game's: the ranking views then carry the patch notice. A view that reads the deck
 * ranking (ranking.json) passes its patch; the others read meta.json's while they are shown. */
const rankingsBehindGame = (patch) => {
  const p = patch || (RANKINGS_SHOWN && DB.meta ? DB.meta.patch : null);
  return p && p !== GAME_PATCH.patch ? p : null;
};

/** The deck ranking (ranking.json) while the Deck tier list shows it, else null. */
export const deckRanking = () => (DECK_RANKING_SHOWN && DB.ranking) || null;

/** What the deck ranking's caveats quote (i18n "rk.limit.*"): its score list's narrowest and widest margins, in whole points. */
export function limitParams(R) {
  const ci = R.by_score.decks.map((d) => d.ci95 * 100);
  return { lo: Math.round(Math.min(...ci)), hi: Math.round(Math.max(...ci)) };
}

/** The patches in one line (footer, About): "Game patch 1.24, card data 1.23, rankings 1.22"; while only the deck ranking
 * is shown, "Game patch 1.26, card data 1.26, provisional deck ranking 1.26"; with no ranking shown, the game and card data
 * only ("Game patch 1.26, card data 1.26"). */
export function patchLine() {
  const game = GAME_PATCH.patch, cards = DB.patch, R = deckRanking();
  if (RANKINGS_SHOWN) return t("pc.line", { game, cards, rank: DB.meta.patch });
  if (R) return t(R.final ? "pc.lineDecks" : "pc.lineDecksProv", { game, cards, rank: R.patch });
  return t("pc.lineCards", { game, cards });
}

/** The date of the "Updated ..." line: the rankings' export, or the game patch's while only the card data is shown. */
export const dataDate = () => (RANKINGS_SHOWN ? DB.meta.generated : deckRanking() ? deckRanking().generated : GAME_PATCH.date);

const word = (c) => t("pc." + changeOf(c).class, { patch: DB.patch });

/** The diamond glyph alone (decorative): filled for a mechanical change, hollow otherwise. */
export const glyph = (c) => h("i.pglyph" + (numbersMoved(c) ? "" : ".hollow"), { "aria-hidden": "true" });

/** The card-level tag, "Changed in 1.23" / "Talents changed in 1.23" / "Text changed in 1.23", or null. */
export function patchTag(c) {
  if (!changeOf(c)) return null;
  return h("span.tag.ptag", [glyph(c), h("span", word(c))]);
}

/** What changed, in one line: "Changed: HP 550 → 750, Dragon's Breath. Removed: Scorching Bite." (null for an unchanged card). */
export function patchDetail(c) {
  const ch = changeOf(c);
  if (!ch) return null;
  const items = [];
  if (ch.hp) items.push(t("pc.hp", { a: ch.hp[0], b: ch.hp[1] }));
  if (ch.gold_income) items.push(t("pc.gold", { a: ch.gold_income[0], b: ch.gold_income[1] }));
  if (ch.resistances) items.push(t("pc.res"));
  for (const part of ["abilities", "passives", "talents"]) for (const i of ch[part] || []) if (c[part][i]) items.push(L(c[part][i], "name"));
  const out = [];
  if (items.length) out.push(t("pc.what", { list: items.join(", ") }));
  if (ch.removed && ch.removed.length) out.push(t("pc.removed", { list: ch.removed.map((e) => L(e, "name")).join(", ") }));
  return out.join(" ") || null;
}

/** Whether an ability, passive or talent of the card changed in the patch (`part` "abilities" | "passives" | "talents"). */
export const entryChanged = (c, part, i) => !!(changeOf(c) && (changeOf(c)[part] || []).includes(i));

/** The quiet tag on a changed entry of the card dialog; its glyph is the card's (filled or hollow, as on every mark). */
export const entryTag = (c) => h("span.tag.ptag", [glyph(c), h("span", t("pc.entry", { patch: DB.patch }))]);

/** One line where a ranking number of a changed card is read: "1.22 numbers, from before the change." */
export function oldNumbersNote(c) {
  const old = rankingsBehind();
  if (!old || !numbersMoved(c)) return null;
  return h("p.dnote.pold", [icon("info"), h("span", t("pc.old", { old }))]);
}

/**
 * The patch notice of the ranking views (Deck tier list, Card tier list, My decks, Deck builder), or null when the rankings
 * are on the game's patch (`patch`: the view's rankings patch when it reads the deck ranking). Its text is the lab's finding
 * for that game patch (pc.notice), never a card name.
 */
export function patchNotice({ patch = null } = {}) {
  if (!rankingsBehindGame(patch)) return null;
  const date = fmtDate(GAME_PATCH.date, "long", false);
  return h("p.pnotice", { role: "note" }, t("pc.notice", { game: GAME_PATCH.patch, date }));
}

// which views have their "About the numbers" open: kept across a redraw (a language change)
const infoOpen = new Set();

/**
 * A ranking view's intro line (DESIGN.md "Intro line"): the one short `lede`, then, when there is something more to say (the
 * patch notice, the view's `method` sentence), a quiet "About the numbers" text disclosure at its end that opens those lines
 * under it. Returns the nodes to put under the h1: the line, and the region when there is one. `key` names the view;
 * `method` is one sentence or a list of them (one paragraph each, or a node of its own such as a list); `patch` is the view's
 * rankings patch when it reads the deck ranking (ranking.json).
 */
export function introLine(key, lede, { method = null, patch = null } = {}) {
  const parts = [...[].concat(method || []).map((m) => (m instanceof Node ? m : h("p", m))), patchNotice({ patch })].filter(Boolean);
  if (!parts.length) return [h("div.vsub", lede)];
  const id = "info-" + key;
  const btn = h("button.tdisc", { type: "button", "aria-controls": id }, [icon("info"), h("span", t("pc.info")), icon("chevron")]);
  const region = h("div.vinfo-wrap", { id }, h("div.collapse-in", h("div.vinfo", parts)));
  disclosure(btn, region, { open: infoOpen.has(key), onToggle: (v) => { if (v) infoOpen.add(key); else infoOpen.delete(key); } });
  return [h("div.vsub", [lede, btn]), region];
}

/** The suggested talent of a card (cards.json `suggested_talent`): the talent object and its position, or null. */
export function suggestedTalent(c) {
  const s = c && c.suggested_talent;
  const tl = s && c.talents[s.talent];
  return tl ? { tl, i: s.talent } : null;
}
