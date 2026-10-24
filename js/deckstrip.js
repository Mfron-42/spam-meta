// The strip of a card's final decks (the Card tier list's one visual of its method, also in the card view's "Card tier" cell):
// one mark per final deck of the deck ranking holding the card, at its place (#1 on the left, the last final deck on the right),
// over a track whose first part, the ranking's top list (the top 30), is lifted; a variant of a better deck (it counts less) is a
// short mark. The marks take the card's tier colour. Data: a cardtiers.json card record and the file's `decks` totals.
// Decorative: the counts printed beside it say the same in words.

import { h } from "./util.js?v=47b1396378";
import { t } from "./i18n.js?v=47b1396378";

const TC = { "S+": "sp", S: "s", A: "a", B: "b", C: "c", D: "d", E: "e" };

/**
 * `r` a card record of cardtiers.json (its `places` and `tier`), `decks` the file's {top, final}. `axis` adds the caption under the
 * track ("Top 30" under the lifted part, "#128" at the end); `key` adds the two-mark key under it; `track: false` draws the axis
 * alone (a column header). A card in no final deck gets the empty track (its designed empty state).
 */
export function deckStrip(r, decks, { axis = false, key = false, track = true } = {}) {
  const n = decks.final, top = decks.top;
  const at = (p) => ((p - 0.5) / n) * 100 + "%";
  const zone = (top / n) * 100 + "%";
  const bar = h("span.ct-st.tc-" + (TC[r.tier] || "out"), [
    h("i.ct-st-top", { style: { width: zone } }),
    ...r.places.map(([p, k]) => h("i.ct-st-d" + (k ? ".cp" : ""), { style: { left: at(p) } })),
  ]);
  return h("span.ct-st-w", { "aria-hidden": "true" }, [
    track ? bar : null,
    axis ? h("span.ct-st-ax", [h("span.ct-st-ax-top", { style: { width: zone } }, t("ct.axTop", { n: top })), h("span", t("ct.place", { p: n }))]) : null,
    key ? h("span.ct-st-key.tc-" + (TC[r.tier] || "out"), [
      h("span", [h("i.ct-st-k"), t("ct.keyDeck")]),
      h("span", [h("i.ct-st-k.cp"), t("ct.keyVar")]),
    ]) : null,
  ]);
}
