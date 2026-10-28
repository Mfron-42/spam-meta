// The strip of a card's strength on the Card tier list (its one visual of the method): a sunken track over the page's one axis
// (cardtiers.json `axis`, the same for every card, lowest on the left), the card's range as a soft bar in its tier colour
// across the track's middle, the strength itself as a short Cream Lavender tick on the bar, and a hairline at 50% (an average
// card: the figure is the win chance against the same deck holding one), so a strip reads without its axis. Decorative: the
// figures printed beside it say the same in words.

import { h, pct } from "./util.js?v=813db21b65";
import { t } from "./i18n.js?v=813db21b65";

// a tier's class on the card tier scale (DESIGN.md "Card tier scale"); "few" is the row of the cards with not enough data
export const TC = { S: "s", A: "a", B: "b", C: "c", D: "d", E: "e", F: "f", few: "few" };

/** `r` a placed card of cardtiers.json (null with `track: false`), `T` the file. `axis` adds the axis labels under the track; `key`
 * the one-line key; `track: false` draws the axis alone (a column header). */
export function deckStrip(r, T, { axis = false, key = false, track = true } = {}) {
  const [lo, hi] = T.axis;
  const at = (p) => Math.max(0, Math.min(100, ((p - lo) / (hi - lo)) * 100));
  const tc = "tc-" + ((r && TC[r.tier]) || "few");
  const mid = lo < 0.5 && 0.5 < hi;
  const kids = r ? [
    mid ? h("i.ct-st-mid", { style: { left: at(0.5) + "%" } }) : null,
    h("i.ct-st-ci", { style: { left: at(r.range[0]) + "%", width: at(r.range[1]) - at(r.range[0]) + "%" } }),
    h("i.ct-st-f", { style: { left: at(r.score) + "%" } }),
  ] : [];
  return h("span.ct-st-w", { "aria-hidden": "true" }, [
    track ? h("span.ct-st." + tc, kids) : null,
    axis ? h("span.ct-st-ax", [h("span", pct(lo, 0)), mid ? h("span.ct-st-ax-mid", { style: { left: at(0.5) + "%" } }, pct(0.5, 0)) : null,
      h("span", pct(hi, 0))]) : null,
    key ? h("span.ct-st-key." + tc, [h("span", [h("i.ct-st-k.ci"), t("ct.keyRange")]),
      mid ? h("span", [h("i.ct-st-k.mid"), t("ct.keyMid")]) : null]) : null,
  ]);
}
