// My decks tab: the best decks the visitor can build from the cards they marked as owned, plus the best decks that are
// exactly one card away, read from the current ranking's deck table (deck-table.json). Each list shows its decks of the full
// AI's scale first, by their rating (the table's order, so the first rows that fit are the best), then, apart, the decks only
// the fast AI looked at (decklist.js scaleGroups: the two scales are never sorted together). A deck of the Deck tier list
// carries its three figures. The card search (search.js) keeps only the decks of both lists that hold a matching card; the
// query survives a redraw (a card ticked, a language change).

import { h, icon, fmtInt } from "./util.js?v=7a68f47bac";
import { loadDecks } from "./data.js?v=7a68f47bac";
import { on, isOwned, ownedCount } from "./store.js?v=7a68f47bac";
import { deckRow, missingLine, scaleGroups, tableHead } from "./decklist.js?v=7a68f47bac";
import { findRow, terms, namedCards } from "./search.js?v=7a68f47bac";
import { openCollection } from "./dialogs.js?v=7a68f47bac";
import { keepLine, paintNoStore, inAppNotice } from "./keep.js?v=7a68f47bac";
import { t } from "./i18n.js?v=7a68f47bac";

let root, D, listeners = new Set();
let result = { build: [], near: [] };
let query = "", find, lists;

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
  compute();
  render();
  on("owned", () => { compute(); render(); });
  on("lang", () => render());
}

// ---------------------------------------------------------------- page
function render() {
  if (!root) return;
  const n = ownedCount();
  const head = tableHead("decks", t("md.h1"), t("md.lede"));
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

  find = findRow({ id: "md-q", name: "deck-card", placeholder: t("find.decksPh"), label: t("find.decksAria"), clearLabel: t("cx.clearSearch"), value: query,
    onChange: (v) => { query = v; paintLists(); },
    onEnter: () => { const x = lists.querySelector(".deck"); if (x && query.trim()) x.scrollIntoView({ block: "start" }); } });
  lists = h("div.md-lists");
  // the search row sits right above the lists it filters, under the collection bar (whose counts are the whole collection's)
  root.replaceChildren(...[head, notice, summary, find.el, lists].filter(Boolean));
  paintLists();
}

/**
 * The two lists, filtered by the card search: a deck shows when one of its cards is named by the query, its other cards dim,
 * and a list left with no deck hides (as a tier does on the Deck tier list). Without a query both lists show as they are.
 */
function paintLists() {
  const ts = terms(query);
  const hits = ts.length ? namedCards(ts) : null;
  const holds = (r) => !hits || r.cards.some((c) => hits.includes(c));
  const build = result.build.filter(holds), near = result.near.filter((x) => holds(x.row));
  const opt = hits ? { hits } : {};
  const parts = [];
  if (!hits || build.length) {
    parts.push(h("section.mdsec", { "aria-labelledby": "md-build" }, [
      h("h2#md-build", t("md.buildH")),
      ...(build.length
        ? scaleGroups(build, (r) => r, (r, i) => deckRow(r, String(i + 1), opt))
        : [h("div.panel.soft", [h("p", t("md.buildNone")), h("a.btn", { href: "#codex", "data-goto": "codex" }, t("md.markMore"))])]),
    ]));
  }
  if (!hits || near.length) {
    parts.push(h("section.mdsec", { "aria-labelledby": "md-near" }, [
      h("h2#md-near", t("md.nearH")),
      near.length
        ? [h("p.muted.sub", t("md.nearSub")),
          ...scaleGroups(near, (x) => x.row, (x, i) => deckRow(x.row, String(i + 1), { ...opt, dim: [x.miss], note: missingLine(x.miss) }))]
        : h("div.panel.soft", h("p", t("md.nearNone"))),
    ]));
  }
  lists.replaceChildren(...parts);
  if (hits) {
    const all = [...result.build, ...result.near.map((x) => x.row)];
    find.paint(ts, hits, hits.filter((c) => all.some((r) => r.cards.includes(c))), build.length + near.length);
  } else find.paint(ts, [], [], 0);
}

function emptyState() {
  return h("div.empty.panel", [
    h("div.empty-ico", { "aria-hidden": "true" }, icon("plus", 28)),
    h("h2", t("md.emptyH")),
    h("p", t("md.emptyP", { n: D.rows.length })),
    h("div.empty-act", [
      h("a.btn.primary", { href: "#codex", "data-goto": "codex" }, [t("md.openCodex"), icon("arrow")]),
      h("button.btn.ghost", { type: "button", onclick: openCollection }, [icon("copy"), t("md.import")]),
    ]),
    // no collection yet: the Deck builder works without one
    h("p.empty-alt", [t("md.orFind") + " ", h("a.link", { href: "#builder", "data-goto": "builder" }, t("fd.title")), "."]),
  ]);
}
