// Patch markers (DESIGN.md, "Patch mark"): which cards the last game patch changed, from cards.json `patch_change`, and
// the patch notice of the ranking views while the rankings are one patch behind the card data. One glyph, the diamond:
// filled when a value, an ability or a passive changed (the class "mechanical"), hollow when only talents or texts did.
// The data carries codes and positions; every word comes from i18n.js ("pc.*").

import { h, icon } from "./util.js?v=4835fc01ee";
import { DB } from "./data.js?v=4835fc01ee";
import { L } from "./cards.js?v=4835fc01ee";
import { t } from "./i18n.js?v=4835fc01ee";

export const changeOf = (c) => (c && c.patch_change) || null;
/** A value, an ability or a passive changed: the rankings' numbers for this card are from before the change. */
export const numbersMoved = (c) => (changeOf(c) || {}).class === "mechanical";
/** The patch the rankings were computed on (meta.json), when it is older than the card data's (cards.json). */
export const rankingsBehind = () => (DB.meta && DB.patch && DB.meta.patch !== DB.patch ? DB.meta.patch : null);

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
 * The patch notice of the ranking views (Deck tier list, Card tier list, My decks), or null when the rankings are current.
 * `legend`: the view draws the patch mark on its cards and has no other legend for it (the Deck tier list), so the notice
 * ends with "◆ card changed" (the glyph is decorative there; the marks carry their own words for screen readers).
 */
export function patchNotice({ legend = false } = {}) {
  const old = rankingsBehind();
  if (!old) return null;
  const key = h("span.pnotice-key", [h("i.pglyph", { "aria-hidden": "true" }), t("pc.noticeKey")]);
  return h("p.pnotice", { role: "note" }, [icon("info"), h("span", [t("pc.notice", { patch: DB.patch, old }), legend ? [" ", key] : null])]);
}

/** The suggested talent of a card (cards.json `suggested_talent`): the talent object and its position, or null. */
export function suggestedTalent(c) {
  const s = c && c.suggested_talent;
  const tl = s && c.talents[s.talent];
  return tl ? { tl, i: s.talent } : null;
}
