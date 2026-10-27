// My decks tab: the best decks the visitor can build from the cards they marked as owned, plus the best decks that are
// exactly one card away, read from the current ranking's deck table (deck-table.json). Each list shows its decks of the full
// AI's scale first, by their rating (the table's order, so the first rows that fit are the best), then, apart, the decks only
// the fast AI looked at (decklist.js scaleGroups: the two scales are never sorted together). A deck of the Deck tier list
// carries its speed beside its Elo. The card search (search.js) keeps only the decks of both lists that hold a matching card, and
// "Without these cards" (search.js outRow; the game's ban mode) leaves out the decks holding a card the visitor names; both
// survive a redraw (a card ticked, a language change), not a reload.

import { h, icon, fmtInt } from "./util.js?v=e550ac9b69";
import { loadDecks } from "./data.js?v=e550ac9b69";
import { on, isOwned, ownedCount } from "./store.js?v=e550ac9b69";
import { deckRow, missingLine, scaleGroups, tableHead } from "./decklist.js?v=e550ac9b69";
import { findRow, terms, namedCards, outRow, bringBack, announcer } from "./search.js?v=e550ac9b69";
import { openCollection } from "./dialogs.js?v=e550ac9b69";
import { keepLine, paintNoStore, inAppNotice } from "./keep.js?v=e550ac9b69";
import { t } from "./i18n.js?v=e550ac9b69";

let root, D, listeners = new Set();
let result = { build: [], near: [] };
let query = "", find, lists;
let out = [], outQuery = "", outEl, voice;

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
  outEl = outRow({ id: "md-out", out, value: outQuery, onQuery: (v) => { outQuery = v; }, onOut: (list) => { out = list; paintLists(true); } });
  voice = announcer();
  lists = h("div.md-lists");
  // the search rows sit right above the lists they filter, under the collection bar (whose counts are the whole collection's)
  root.replaceChildren(...[head, notice, summary, find.el, outEl.el, lists, voice.el].filter(Boolean));
  paintLists();
}

/** Whether a deck holds none of the cards left out (`skip`: the list to test, the visitor's by default). */
const allowed = (r, skip = out) => !skip.some((c) => r.cards.includes(c));

/**
 * The two lists, filtered by the card search and the cards left out: a deck shows when one of its cards is named by the query
 * (its other cards dim) and it holds none of the cards left out; a list left with no deck hides (as a tier does on the Deck tier
 * list). Without either both lists show as they are. When the cards left out hide every deck, one line says so and offers to
 * bring a card back. `said`: a change of the cards left out, whose count of decks shown a hidden polite region says.
 */
function paintLists(said = false) {
  const ts = terms(query);
  const hits = ts.length ? namedCards(ts) : null;
  const holds = (r) => !hits || r.cards.some((c) => hits.includes(c));
  const pass = (r, skip = out) => holds(r) && allowed(r, skip);
  const build = result.build.filter((r) => pass(r)), near = result.near.filter((x) => pass(x.row));
  const opt = hits ? { hits } : {};
  const filtering = !!hits || out.length > 0;
  const parts = [];
  if (!build.length && !near.length && out.length && (result.build.some(holds) || result.near.some((x) => holds(x.row)))) {
    // the cards left out hide every deck the search would show
    const count = (c) => result.build.filter((r) => pass(r, out.filter((x) => x !== c))).length +
      result.near.filter((x) => pass(x.row, out.filter((y) => y !== c))).length;
    parts.push(h("div.md-out-none", [h("p.fd-none", t("out.none")), bringBack(out, count, (c) => {
      out = out.filter((x) => x !== c);
      outEl.set(out);
      paintLists(true);
      // as in the Deck builder: the focus goes to the first list now shown
      const hd = lists.querySelector("h2");
      (hd || outEl.field.input).focus();
    })]));
  }
  if (!filtering || build.length) {
    parts.push(h("section.mdsec", { "aria-labelledby": "md-build" }, [
      h("h2#md-build", { tabindex: "-1" }, t("md.buildH")),
      ...(build.length
        ? scaleGroups(build, (r) => r, (r, i) => deckRow(r, String(i + 1), opt))
        : [h("div.panel.soft", [h("p", t("md.buildNone")), h("a.btn", { href: "#codex", "data-goto": "codex" }, t("md.markMore"))])]),
    ]));
  }
  if (!filtering || near.length) {
    parts.push(h("section.mdsec", { "aria-labelledby": "md-near" }, [
      h("h2#md-near", { tabindex: "-1" }, t("md.nearH")),
      near.length
        ? [h("p.muted.sub", t("md.nearSub")),
          ...scaleGroups(near, (x) => x.row, (x, i) => deckRow(x.row, String(i + 1), { ...opt, dim: [x.miss], note: missingLine(x.miss) }))]
        : h("div.panel.soft", h("p", t("md.nearNone"))),
    ]));
  }
  lists.replaceChildren(...parts);
  if (hits) {
    const all = [...result.build, ...result.near.map((x) => x.row)].filter((r) => allowed(r));
    find.paint(ts, hits, hits.filter((c) => all.some((r) => r.cards.includes(c))), build.length + near.length);
  } else find.paint(ts, [], [], 0);
  if (said) voice.say(t("out.shown", { n: build.length + near.length }));
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
