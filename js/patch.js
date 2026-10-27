// Patch markers (DESIGN.md, "Patch mark"): which cards the last game patch changed, from cards.json `patch_change`, and
// the patch notice of the ranking views while the rankings are one patch behind the card data. One glyph, the diamond:
// filled when a value, an ability or a passive changed (the class "mechanical"), hollow when only talents or texts did.
// The data carries codes and positions; every word comes from i18n.js ("pc.*").

import { h, icon, fmtDate, dec, reducedMotion } from "./util.js?v=7a68f47bac";
import { DB } from "./data.js?v=7a68f47bac";
import { L } from "./cards.js?v=7a68f47bac";
import { t } from "./i18n.js?v=7a68f47bac";
import { disclosure } from "./ui.js?v=7a68f47bac";

// Three patches can differ, and each label names the one it is about (SPEC.md, "Patch labels"):
// - the GAME patch, the client players run today (below; the lab reads it from the game files);
// - the CARD DATA patch, DB.patch (cards.json `patch`): card faces, card markers, the Codex;
// - the RANKINGS patch, DB.meta.patch (meta.json `patch`): decks, tiers, counters, games, everything measured.
// The game patch has no export of its own yet: bump it here when the lab reports a new client (the bundle version of the
// game build: 1.26, Steam build 26109944, the update of 2026-10-21 18:51).
export const GAME_PATCH = { patch: "1.26", date: "2026-10-21" };

// What the site shows of the rankings (SPEC.md section 3.7). Three switches; the views stay in the code either way.
// - DECK_RANKING_SHOWN: the Deck tier list draws the lab's three deck lists of the game patch (deck-lists.json, tiers.js),
//   labelled temporary while its `final` is false (owner, 2026-10-23: "mets en ligne le classement temporaire"); the footer,
//   About and the card view's Meta section quote them. Off, the Deck tier list draws the "being computed" placeholder (pending.js).
// - DECK_TABLE_SHOWN: My decks and the Deck builder read the current ranking's deck table (deck-table.json: every deck the run
//   rated, the full AI's scale then the fast AI's picks, never mixed; owner, 2026-10-23: "tu as perdu beaucoup de features").
// - CARD_TIERS_SHOWN: the Card tier list and the card view's card tier read the card tiers of the stage ranking's run
//   (cardtiers.json, tools/export_cardtiers.py from ranking-decks.json; owner, 2026-10-24: "redo the card tier list too").
//   Off, the Card tier list draws the "being computed" placeholder.
// - CARD_RANKINGS_SHOWN: what is still on the 1.22 files, off since the lab recomputes the rankings (owner, 2026-10-21): the
//   card view's "With and against" (cardcounters.json: the lab has no 1.26 card pairs yet), the 1.22 Meta section and the
//   footer and About lines built from meta.json.
export const DECK_RANKING_SHOWN = true;
export const DECK_TABLE_SHOWN = true;
export const CARD_TIERS_SHOWN = true;
export const CARD_RANKINGS_SHOWN = false;

export const changeOf = (c) => (c && c.patch_change) || null;
/** A value, an ability or a passive changed: the rankings' numbers for this card are from before the change. */
export const numbersMoved = (c) => (changeOf(c) || {}).class === "mechanical";
/** The patch the rankings were computed on (meta.json), when it is older than the card data's (cards.json). */
export const rankingsBehind = () => (DB.meta && DB.patch && DB.meta.patch !== DB.patch ? DB.meta.patch : null);
/** The rankings patch, when it is not the game's: the ranking views then carry the patch notice. A view that reads the deck
 * ranking (ranking.json) passes its patch; the others read meta.json's while they are shown. */
const rankingsBehindGame = (patch) => {
  const p = patch || (CARD_RANKINGS_SHOWN && DB.meta ? DB.meta.patch : null);
  return p && p !== GAME_PATCH.patch ? p : null;
};

/** The deck lists of the Deck tier list (deck-lists.json) while it shows them, else null: what the footer, About and the card
 * view quote as "the deck ranking". */
export const deckRanking = () => (DECK_RANKING_SHOWN && DB.lists) || null;

/** What the deck lists' caveats and method quote (i18n "rk.limit.*", "rk.m*"): the narrowest and widest margins of the final's
 * rates, in points to one decimal, the final's size, how many decks of the players' meta the full AI played, the players' panel's
 * patch and the lists' patch. */
export function limitParams(R) {
  const ci = R.top.rows.filter((d) => d.top.win_rate != null).map((d) => d.top.ci95 * 100);
  return { lo: dec(Math.min(...ci), 1), hi: dec(Math.max(...ci), 1), top: R.top.final, pp: R.meta.panel_patch, patch: R.patch };
}

/** The median round of a won game of the listed decks (deck-lists.json speed.median_rounds): "13" when whole, else "13.5". */
export const medianRounds = (R) => dec(R.speed.median_rounds, Number.isInteger(R.speed.median_rounds) ? 0 : 1);

/** The patches in one line (footer, About): "Game patch 1.24, card data 1.23, rankings 1.22"; while only the deck ranking
 * is shown, "Game patch 1.26, card data 1.26, provisional deck ranking 1.26"; with no ranking shown, the game and card data
 * only ("Game patch 1.26, card data 1.26"). */
export function patchLine() {
  const game = GAME_PATCH.patch, cards = DB.patch, R = deckRanking();
  if (CARD_RANKINGS_SHOWN) return t("pc.line", { game, cards, rank: DB.meta.patch });
  if (R) return t(R.final ? "pc.lineDecks" : "pc.lineDecksProv", { game, cards, rank: R.patch });
  return t("pc.lineCards", { game, cards });
}

/** The date of the "Updated ..." line: the rankings' export, or the game patch's while only the card data is shown. */
export const dataDate = () => (CARD_RANKINGS_SHOWN ? DB.meta.generated : deckRanking() ? deckRanking().generated : GAME_PATCH.date);

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

/** One line where a ranking number of a changed card is read: "1.22 numbers, from before the change." `patch`: the patch the
 * numbers shown were measured on, when it is not the rankings patch of meta.json (the card tiers carry their own). */
export function oldNumbersNote(c, patch = null) {
  const old = patch ? (DB.patch && patch !== DB.patch ? patch : null) : rankingsBehind();
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

// ---------------------------------------------------------------- explanations live in the footer
// (owner, 2026-10-24: "trop de texte explicatif en tête"; DESIGN.md "Explanations live in the footer"): every method note, basis,
// caveat and legend of a ranking view goes to the footer's Method section (#method), one sub-section per tab (#method-<tab>), a
// text disclosure each; the top of a view keeps its title, the one-line banner, its search and its switch. A pointer is a small
// link to the sub-section ("How it is measured"), never prose.
const METHOD_TABS = ["tiers", "card-tiers", "decks", "builder"];
const METHOD_TITLES = { tiers: "tab.tiers", "card-tiers": "tab.cardTiers", decks: "tab.decks", builder: "fd.title" };
const methodOpen = new Set();               // the sub-sections open: kept across a redraw (a language change)
let methodWanted = null;                    // a sub-section asked for before its view filled it (a #method-<tab> address)

/** The footer sub-section of a view, created in the tabs' order the first time; its disclosure is kept across redraws. */
function methodSub(key) {
  const root = document.getElementById("method");
  if (!root) return null;
  let sub = document.getElementById("method-" + key);
  if (!sub) {
    sub = h("div.msub", { id: "method-" + key });
    const btn = h("button.tdisc.msub-b", { type: "button", "aria-controls": "method-r-" + key }, [icon("info"), h("span.msub-t"), icon("chevron")]);
    const region = h("div.vinfo-wrap", { id: "method-r-" + key }, h("div.collapse-in", h("div.vinfo.msub-body")));
    sub.append(btn, region);
    sub._disc = disclosure(btn, region, { open: methodOpen.has(key), onToggle: (v) => { if (v) methodOpen.add(key); else methodOpen.delete(key); } });
    const after = METHOD_TABS.slice(METHOD_TABS.indexOf(key) + 1).map((k) => document.getElementById("method-" + k)).find(Boolean);
    root.querySelector(".msubs").insertBefore(sub, after || null);
    root.hidden = false;
  }
  return sub;
}

/** Fills a view's footer sub-section with its explanation (`nodes`: sentences, paragraphs or nodes), titled by the tab. */
export function methodSection(key, nodes) {
  const sub = methodSub(key);
  if (!sub) return;
  sub.querySelector(".msub-t").textContent = t(METHOD_TITLES[key] || "mt.h");
  sub.querySelector(".msub-body").replaceChildren(...[].concat(nodes || []).filter(Boolean).map((m) => (m instanceof Node ? m : h("p", m))));
  // asked for before the view drew: open it once the view's list is laid out (two frames), so the scroll lands on it
  if (methodWanted === key) { methodWanted = null; requestAnimationFrame(() => requestAnimationFrame(() => openMethod(key))); }
}

/** Opens a view's footer sub-section and brings it into view, its button focused (no scroll animation under reduced motion). */
export function openMethod(key) {
  const sub = document.getElementById("method-" + key);
  if (!sub || !sub.querySelector(".msub-body").childElementCount) { methodWanted = key; return; }
  sub._disc.set(true);
  const b = sub.querySelector(".msub-b");
  b.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  b.focus({ preventScroll: true });
}

// The way back from the footer: following the link adds one history entry (the same address), so Back returns to the place the
// visitor left, the link focused again, instead of leaving the site (the critique of 2026-10-24).
let methodReturn = null;
window.addEventListener("popstate", (e) => {
  if (!methodReturn || (e.state && e.state.method)) return;
  const { y, link } = methodReturn;
  methodReturn = null;
  window.scrollTo(0, y);
  if (link && link.isConnected) link.focus({ preventScroll: true });
});

/** The small pointer to a view's footer sub-section ("How it is measured"): a real link (#method-<tab>, which the router
 * understands on a fresh load) that opens the sub-section in place, Back returning to where it was followed. */
export function methodLink(key) {
  const a = h("a.link.mlink", { href: "#method-" + key, onclick: (e) => {
    if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;     // a new tab or window: the router opens it there
    e.preventDefault();
    methodReturn = { y: window.scrollY, link: a };
    try { history.pushState({ ...(history.state || {}), method: key }, "", location.href); } catch (err) { methodReturn = null; }
    openMethod(key);
  } }, t("mt.link"));
  return a;
}

/**
 * A ranking view's intro: since 2026-10-24 nothing at the top of the view. Its `lede` (the facts line) and its `method` (sentences,
 * paragraphs or nodes such as a list), then the patch notice, go to the view's footer sub-section (methodSection). Returns the
 * nodes to put under the h1: none, or, with `link` (a view without the temporary banner, which carries the link), the small
 * "How it is measured" link alone.
 */
export function introLine(key, lede, { method = null, patch = null, link = false } = {}) {
  methodSection(key, [lede, ...[].concat(method || []), patchNotice({ patch })]);
  return link ? [h("p.vsub", methodLink(key))] : [];
}

/**
 * The banner of a temporary ranking (DESIGN.md "Provisional banner"; owner, 2026-10-24: one short line, no version wording): the
 * clock, "Temporary ranking, being refined." and the small link to the view's footer sub-section, where why and how live. Not
 * dismissible, no motion. `key` names the view (a second argument, the older sentence option, is ignored).
 */
export function provBanner(key) {
  return h("div.rk-banner", { role: "note" }, [
    icon("clock", 24),
    h("p.rk-banner-t", t("rk.bannerLine")),
    methodLink(key),
  ]);
}

// ---------------------------------------------------------------- talents picked against the opponent
// In ranked, every card's talent is picked in a private draft before turn 1, for that match: a talent that guards against some
// elements only (the element shields) is chosen against the opponent (owner, 2026-10-24). The exporters flag them from the talent
// texts (tools/matchup_talents.py: `matchup_talents` of deck-lists.json and ranking.json); the site marks them where a deck shows a
// card's talent.

/** Whether talent `i` of card `c` is picked against the opponent. */
export const isMatchupTalent = (c, i) => {
  // the same rule in both files (tools/matchup_talents.py): the deck lists' (loaded at boot), else the stage ranking's
  const m = (DB.lists && DB.lists.matchup_talents) || (DB.ranking && DB.ranking.matchup_talents);
  return !!(m && c && (m[c.id] || []).includes(Number(i)));
};

/** The quiet mark of such a talent (DESIGN.md "Matchup mark"): the swap glyph, one image, its title the rule; its name the rule
 * too, or the short "Pick against the opponent" (`label`) where the rule is read nearby or on every arrow key (the card view's
 * tabs, the footer line). */
export const matchupMark = ({ label = "tl.matchup" } = {}) =>
  h("span.mu", { role: "img", "aria-label": t(label), title: t("tl.matchup") }, icon("swap", 14));

/** The suggested talent of a card (cards.json `suggested_talent`): the talent object and its position, or null. */
export function suggestedTalent(c) {
  const s = c && c.suggested_talent;
  const tl = s && c.talents[s.talent];
  return tl ? { tl, i: s.talent } : null;
}
