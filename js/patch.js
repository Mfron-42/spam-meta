// Patch markers (DESIGN.md, "Patch mark"): which cards the last game patch changed, from cards.json `patch_change`, and
// the patch notice of the ranking views while the rankings are one patch behind the card data. One glyph, the diamond:
// filled when a value, an ability or a passive changed (the class "mechanical"), hollow when only talents or texts did.
// The data carries codes and positions; every word comes from i18n.js ("pc.*").

import { h, icon, fmtDate } from "./util.js?v=4bef3888cf";
import { DB } from "./data.js?v=4bef3888cf";
import { L } from "./cards.js?v=4bef3888cf";
import { t } from "./i18n.js?v=4bef3888cf";
import { disclosure } from "./ui.js?v=4bef3888cf";

// Three patches can differ, and each label names the one it is about (SPEC.md, "Patch labels"):
// - the GAME patch, the client players run today (below; the lab reads it from the game files);
// - the CARD DATA patch, DB.patch (cards.json `patch`): card faces, card markers, the Codex;
// - the RANKINGS patch, DB.meta.patch (meta.json `patch`): decks, tiers, counters, games, everything measured.
// The game patch has no export of its own yet: bump it here when the lab reports a new client (the bundle version of the
// game build: 1.26, Steam build 26109944, the update of 2026-10-21 18:51).
export const GAME_PATCH = { patch: "1.26", date: "2026-10-21" };

// The rankings (both tier lists, My decks, the Deck builder, the card view's Meta section) are not shown while the lab
// recomputes them for the game patch (owner, 2026-10-21: "we keep only the codex"). The views stay in the code: the two tier
// list tabs draw the "being computed" placeholder (pending.js), My decks and the Deck builder are not shown at all, the
// Codex is the landing view. Set it back to true when rankings of the game patch are exported (SPEC.md section 3.7).
export const RANKINGS_SHOWN = false;

export const changeOf = (c) => (c && c.patch_change) || null;
/** A value, an ability or a passive changed: the rankings' numbers for this card are from before the change. */
export const numbersMoved = (c) => (changeOf(c) || {}).class === "mechanical";
/** The patch the rankings were computed on (meta.json), when it is older than the card data's (cards.json). */
export const rankingsBehind = () => (DB.meta && DB.patch && DB.meta.patch !== DB.patch ? DB.meta.patch : null);
/** The rankings patch, when it is not the game's: the ranking views then carry the patch notice. */
const rankingsBehindGame = () => (RANKINGS_SHOWN && DB.meta && DB.meta.patch !== GAME_PATCH.patch ? DB.meta.patch : null);

/** The patches in one line (footer, About): "Game patch 1.24, card data 1.23, rankings 1.22"; while the rankings are not
 * shown, the game and card data only ("Game patch 1.26, card data 1.26"). */
export const patchLine = () => (RANKINGS_SHOWN ? t("pc.line", { game: GAME_PATCH.patch, cards: DB.patch, rank: DB.meta.patch })
  : t("pc.lineCards", { game: GAME_PATCH.patch, cards: DB.patch }));

/** The date of the "Updated ..." line: the rankings' export, or the game patch's while only the card data is shown. */
export const dataDate = () => (RANKINGS_SHOWN ? DB.meta.generated : GAME_PATCH.date);

const word = (c) => t("pc." + changeOf(c).class, { patch: DB.patch });

/** The diamond glyph alone (decorative): filled for a mechanical change, hollow otherwise. */
export const glyph = (c) => h("i.pglyph" + (numbersMoved(c) ? "" : ".hollow"), { "aria-hidden": "true" });

/** The card-level tag, "Changed in 1.23" / "Talents changed in 1.23" / "Text changed in 1.23", or null. */
export function patchTag(c) {
  if (!changeOf(c)) return null;
  return h("span.tag.ptag", [glyph(c), h("span", word(c))]);
}

/** The small mark on a card of a deck or a tier-list icon: the glyph with its words for screen readers and as a tooltip. */
export function patchMark(c, cls = "pmark") {
  if (!changeOf(c)) return null;
  const w = word(c);
  return h("span." + cls, { title: w }, [glyph(c), h("span.sr", w)]);
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
 * are on the game's patch. Its text is the lab's finding for that game patch (pc.notice), never a card name.
 * `legend`: the view draws the patch mark on its cards and has no other legend for it (the Deck tier list), so the notice
 * ends with "◆ changed in 1.23", the card data's patch (the glyph is decorative there; the marks carry their own words).
 */
export function patchNotice({ legend = false } = {}) {
  if (!rankingsBehindGame()) return null;
  const key = h("span.pnotice-key", [h("i.pglyph", { "aria-hidden": "true" }), t("pc.noticeKey", { patch: DB.patch })]);
  const date = fmtDate(GAME_PATCH.date, "long", false);
  return h("p.pnotice", { role: "note" }, [t("pc.notice", { game: GAME_PATCH.patch, date }), legend ? [" ", key] : null]);
}

// which views have their "About the numbers" open: kept across a redraw (a language change)
const infoOpen = new Set();

/**
 * A ranking view's intro line (DESIGN.md "Intro line"): the one short `lede`, then, when there is something more to say (the
 * patch notice, the view's `method` sentence), a quiet "About the numbers" text disclosure at its end that opens those lines
 * under it. Returns the nodes to put under the h1: the line, and the region when there is one. `key` names the view.
 */
export function introLine(key, lede, { method = null, legend = false } = {}) {
  const parts = [method ? h("p", method) : null, patchNotice({ legend })].filter(Boolean);
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
