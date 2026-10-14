// My decks tab: the best decks the visitor can build from the cards they marked as owned, plus the best decks that are
// exactly one card away. Order is the one docs/DATA.md defines: evidence level first, then rank_score (the rows are
// already sorted that way, so the first rows that fit are the best). A deck that is also in the tier list carries its
// tier tag (joined by card set, never by position).

import { h, icon, fmtInt } from "./util.js";
import { DB, loadDecks, loadTier } from "./data.js";
import { on, isOwned, ownedCount } from "./store.js";
import { deckRow, missingLine, paged, legend, modeSwitch } from "./decklist.js";
import { openCollection } from "./dialogs.js";
import { keepLine, paintNoStore, inAppNotice } from "./keep.js";
import { t } from "./i18n.js";
import { patchNotice } from "./patch.js";

let root, D, listeners = new Set();
let result = { build: [], near: [] };

export const onCount = (fn) => { listeners.add(fn); fn(result.build.length); };
export const buildableCount = () => result.build.length;

function compute() {
  const build = [], near = [];
  if (!D) { result = { build, near }; return; }
  for (const r of D.rows) {
    let miss = null, n = 0;
    for (const c of r.cards) {
      if (isOwned(c.key)) n++; else miss = c;
    }
    if (n === 4) build.push(r);
    else if (n === 3) near.push({ row: r, miss });
  }
  result = { build, near };
  listeners.forEach((fn) => fn(build.length));
}

export async function mount(el) {
  root = el;
  D = await loadDecks();
  try { await loadTier(); } catch (e) { /* tier tags are optional */ }
  compute();
  render();
  on("owned", () => { compute(); render(); });
  on("lang", () => render());
}

// ---------------------------------------------------------------- page
const legendState = { open: false };

function render() {
  if (!root) return;
  const n = ownedCount();
  const head = h("div.vhead", [
    modeSwitch("decks"),
    h("h1", t("md.h1")),
    h("p.lede", t("md.lede")),
    patchNotice(),
  ]);
  const notice = inAppNotice();
  if (!n) { root.replaceChildren(...[head, notice, emptyState()].filter(Boolean)); return; }

  const { build, near } = result;
  const noStore = keepLine("nostore");
  paintNoStore(noStore);
  const summary = h("div.cbar.panel", [
    h("div.cb-main", [
      h("div.cb-fig", [h("p.cb-h", [h("span.cb-n", fmtInt(build.length)), t("md.canBuild", { n: build.length })])]),
      h("p.cb-txt", t("md.near", { n: near.length })),
    ]),
    h("div.cb-act", [
      h("a.btn.primary", { href: "#codex", "data-goto": "codex" }, [icon("back"), t("md.edit")]),
      h("button.btn.ghost", { type: "button", onclick: openCollection }, [icon("copy"), t("md.export")]),
    ]),
    noStore.el,
  ]);

  const parts = [head, notice, summary, legend("md-legend", legendState)].filter(Boolean);

  parts.push(h("section.mdsec", { "aria-labelledby": "md-build" }, [
    h("h2#md-build", t("md.buildH")),
    build.length
      ? paged(build, (r, i) => deckRow(r, `#${i + 1}`))
      : h("div.panel.soft", [h("p", t("md.buildNone")), h("a.btn", { href: "#codex", "data-goto": "codex" }, t("md.markMore"))]),
  ]));

  parts.push(h("section.mdsec", { "aria-labelledby": "md-near" }, [
    h("h2#md-near", t("md.nearH")),
    near.length
      ? [h("p.muted.sub", t("md.nearSub")),
        paged(near, (x, i) => deckRow(x.row, `#${i + 1}`, { note: missingLine(x.miss) }))]
      : h("div.panel.soft", h("p", t("md.nearNone"))),
  ]));
  root.replaceChildren(...parts);
}

function emptyState() {
  return h("div.empty.panel", [
    h("div.empty-ico", { "aria-hidden": "true" }, icon("plus", 28)),
    h("h2", t("md.emptyH")),
    h("p", t("md.emptyP", { n: DB.meta.totals.decks_listed || DB.meta.totals.decks_measured })),
    h("div.empty-act", [
      h("a.btn.primary", { href: "#codex", "data-goto": "codex" }, [t("md.openCodex"), icon("arrow")]),
      h("button.btn.ghost", { type: "button", onclick: openCollection }, [icon("copy"), t("md.import")]),
    ]),
    // no collection yet: the Deck finder works without one
    h("p.empty-alt", [t("md.orFind") + " ", h("a.link", { href: "#builder", "data-goto": "builder" }, t("fd.modeFind"))]),
  ]);
}
