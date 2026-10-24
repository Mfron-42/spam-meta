// The strip of a card's decks in one view of the Card tier list (its one visual of the method): a track over the view's win-rate
// axis (cardtiers.json `top.axis` / `race.axis`), lowest on the left. Top: one mark per deck of the top holding the card, at its
// win rate against the others there, and a tick at 50%, the level of the top. Race: the card's race decks as a quiet density (one bar
// per 2.5 points, its height the share of the card's decks there), and its best decks, the ones its score averages, as marks.
// The marks take the card's tier colour in that view. Decorative: the figures printed beside it say the same in words.

import { h, pct } from "./util.js?v=ee4f639b3e";
import { t } from "./i18n.js?v=ee4f639b3e";

const TC = { "S+": "sp", S: "s", A: "a", B: "b", C: "c", D: "d", E: "e" };

/** `v` the card's record in the view (`top` or `race` of a cardtiers.json card), `view` its name, `T` the file. `axis` adds the
 * axis labels under the track; `key` the one-line key; `track: false` draws the axis alone (a column header). A card with no deck
 * in the view gets the empty track. */
export function deckStrip(v, view, T, { axis = false, key = false, track = true } = {}) {
  const [lo, hi] = T[view].axis;
  const x = (p) => Math.max(0, Math.min(100, ((p - lo) / (hi - lo)) * 100)) + "%";
  const kids = [];
  if (view === "top") {
    kids.push(h("i.ct-st-mid", { style: { left: x(0.5) } }));
    v.rates.forEach((p, i) => kids.push(h("i.ct-st-d" + (i < T.best ? "" : ".cp"), { style: { left: x(p) } })));
  } else {
    const step = T.race.step, top = Math.max(1, ...v.hist);
    v.hist.forEach((n, i) => {
      if (n) kids.push(h("i.ct-st-h", { style: { left: x(lo + i * step), width: (step / (hi - lo)) * 100 + "%", height: Math.max(8, (n / top) * 100) + "%" } }));
    });
    v.rates.forEach((p) => kids.push(h("i.ct-st-d", { style: { left: x(p) } })));
  }
  const tc = "tc-" + (TC[v.tier] || "out");
  return h("span.ct-st-w", { "aria-hidden": "true" }, [
    track ? h("span.ct-st." + tc, kids) : null,
    axis ? h("span.ct-st-ax", [h("span", pct(lo, 0)),
      view === "top" ? h("span.ct-st-ax-mid", { style: { left: x(0.5) } }, pct(0.5, 0)) : null, h("span", pct(hi, 0))]) : null,
    key ? h("span.ct-st-key." + tc, view === "top"
      ? [h("span", [h("i.ct-st-k"), t("ct.keyTop", { n: T.best })]), v.decks > T.best ? h("span", [h("i.ct-st-k.cp"), t("ct.keyMore", { top: T.decks.top })]) : null,
        h("span", [h("i.ct-st-k.mid"), t("ct.keyMid")])]
      : [h("span", [h("i.ct-st-k.h"), t("ct.keyRace")]), h("span", [h("i.ct-st-k"), t("ct.keyBest", { n: T.best })])]) : null,
  ]);
}
