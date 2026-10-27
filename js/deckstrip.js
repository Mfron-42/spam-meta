// The strip of a card's decks in one view of the Card tier list (its one visual of the method): a track over the view's win-rate
// axis (cardtiers.json `race.axis` / `all.axis`), lowest on the left. Race: the card's race decks as a quiet
// density (one bar per 2.5 points, its height the share of the card's decks there), and its best decks, the ones its score
// averages, as marks. All: the likely range of the card's figure (`ci95`) as a soft bar across the track, its 5 best decks as
// marks, and the figure itself as a short Cream Lavender tick on the bar. The marks and the range take the card's tier colour in
// that view. Decorative: the figures printed beside it say the same in words.

import { h, pct } from "./util.js?v=e550ac9b69";
import { t } from "./i18n.js?v=e550ac9b69";

const TC = { "S+": "sp", S: "s", A: "a", B: "b", C: "c", D: "d", E: "e" };

/** `v` the card's record in the view (`race` or `all` of a cardtiers.json card), `view` its name, `T` the file. `axis`
 * adds the axis labels under the track; `key` the one-line key; `track: false` draws the axis alone (a column header). A card with
 * no deck in the view gets the empty track. */
export function deckStrip(v, view, T, { axis = false, key = false, track = true } = {}) {
  const [lo, hi] = T[view].axis;
  const at = (p) => Math.max(0, Math.min(100, ((p - lo) / (hi - lo)) * 100));
  const x = (p) => at(p) + "%";
  const kids = [];
  if (view === "all") {
    if (v.ci95) kids.push(h("i.ct-st-ci", { style: { left: x(v.ci95[0]), width: at(v.ci95[1]) - at(v.ci95[0]) + "%" } }));
    v.rates.forEach((p) => kids.push(h("i.ct-st-d", { style: { left: x(p) } })));
    if (v.score != null) kids.push(h("i.ct-st-f", { style: { left: x(v.score) } }));
  } else {
    const step = T.race.step, top = Math.max(1, ...v.hist);
    v.hist.forEach((n, i) => {
      if (n) kids.push(h("i.ct-st-h", { style: { left: x(lo + i * step), width: (step / (hi - lo)) * 100 + "%", height: Math.max(8, (n / top) * 100) + "%" } }));
    });
    v.rates.forEach((p) => kids.push(h("i.ct-st-d", { style: { left: x(p) } })));
  }
  const tc = "tc-" + (TC[v.tier] || "out");
  const keys = {
    race: () => [h("span", [h("i.ct-st-k.h"), t("ct.keyRace")]), h("span", [h("i.ct-st-k"), t("ct.keyBest", { n: T.best })])],
    all: () => [h("span", [h("i.ct-st-k.ci"), t("ct.keyRange")]), h("span", [h("i.ct-st-k"), t("ct.keyBest", { n: T.best })])],
  };
  return h("span.ct-st-w", { "aria-hidden": "true" }, [
    track ? h("span.ct-st." + tc, kids) : null,
    axis ? h("span.ct-st-ax", [h("span", pct(lo, 0)), h("span", pct(hi, 0))]) : null,
    key ? h("span.ct-st-key." + tc, keys[view]()) : null,
  ]);
}
