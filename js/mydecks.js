// My decks tab: the best decks the visitor can build from the cards they marked as owned, plus the best decks that are
// exactly one card away. Order is the one docs/DATA.md defines: evidence level first, then rank_score (the rows are
// already sorted that way, so the first rows that fit are the best). A deck that is also in the tier list carries its
// tier tag and, for a finalist, the same strategy tip as on the Tier list (joined by card set, never by position).

import { h, icon, fmtInt, pct, plural } from "./util.js";
import { DB, loadDecks, loadTier, deckKey } from "./data.js";
import { on, isOwned, ownedCount } from "./store.js";
import { gameCard, chip } from "./cards.js";
import { disclosure } from "./ui.js";
import { openCollection } from "./dialogs.js";
import { tipBlock } from "./tiers.js";

const PAGE = 8;
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

// ---------------------------------------------------------------- evidence, in plain words
const EVIDENCE = {
  4: { name: "Finals", strength: "Very strong evidence", text: (r) => `Played ${fmtInt(r.games)} games against the 9 other finalists, with the strong AI.` },
  3: { name: "Round-robin", strength: "Strong evidence", text: (r) => `Played ${fmtInt(r.games)} games against the other top decks of the round-robin, with the strong AI.` },
  2: { name: "Halving", strength: "Fair evidence", text: (r) => `Reached round ${r.rounds} of 3 of the elimination against 8 probe decks, over ${fmtInt(r.games)} games with the strong AI.` },
  1: { name: "Quick screen", strength: "Rough evidence", text: (r) => `A quick screen: ${fmtInt(r.games)} games with the basic AI against 54 reference decks. Treat it as a lead, not a verdict.` },
};

function meter(level) {
  return h("span.meter", { role: "img", "aria-label": `Evidence level ${level} of 4` }, [1, 2, 3, 4].map((i) => h("i", { class: i <= level ? "on" : "" })));
}

/** The tier-list entry with the same 4 cards, or null (the tier list did not load, or the deck is not in the top 30). */
const tierDeckOf = (r) => (DB.tierBySet ? DB.tierBySet.get(deckKey(r.cards.filter(Boolean).map((c) => c.id))) || null : null);

function deckRow(r, rankLabel, miss) {
  const ev = EVIDENCE[r.level];
  const t = tierDeckOf(r);
  const rank = t ? t.rank : r.tierRank;
  const tags = rank ? [h("span.tag", t ? `Tier ${t.tier} · #${rank} overall` : `#${rank} overall`)] : [];
  return h("article.dr", [
    h("div.dr-rank", [h("h3.rk", rankLabel)]),
    h("div.deck-cards", r.cards.map((c) => h("div.slot", gameCard(c, { size: "list" })))),
    h("div.dr-info", [
      h("div.ev", [meter(r.level), h("b", ev.name), h("span.muted", ev.strength)]),
      h("div.dr-fig", [h("b.stat-v", pct(r.rate)), h("span.stat-s", "win rate in this test")]),
      h("p.dr-t", ev.text(r)),
      miss ? h("p.dr-miss", [h("span.muted", "Missing: "), chip(miss)]) : null,
      tags.length ? h("div.tags", tags) : null,
    ]),
    tipBlock(t),
  ]);
}

// ---------------------------------------------------------------- page
function legend() {
  const btn = h("button.btn.ghost.disc", { type: "button", "aria-controls": "md-legend" }, [icon("info"), "How reliable is each deck?", icon("chevron")]);
  const lv = DB.decks.levels;
  const region = h("div#md-legend", h("div.collapse-in", h("div.guide", [
    h("p", "Every deck was tested more or less thoroughly. The more thorough the test, the more you can trust its win rate. Decks are listed by evidence first, then by win rate inside the same level, because win rates from different levels cannot be compared."),
    h("ul.levels", [4, 3, 2, 1].map((l) => h("li", [meter(l), h("div", [h("b", EVIDENCE[l].name), h("span.muted", ` · ${fmtInt(lv[l].decks)} decks · `), lv[l].description + "."])]))),
  ])));
  disclosure(btn, region, { open: false });
  return h("div.guide-wrap", [btn, region]);
}

function render() {
  if (!root) return;
  const n = ownedCount();
  const head = h("div.vhead", [
    h("h1", "My decks"),
    h("p.lede", "The best decks you can build from the cards you marked as owned in the Codex."),
  ]);
  if (!n) { root.replaceChildren(head, emptyState()); return; }

  const { build, near } = result;
  const summary = h("div.cbar.panel", [
    h("div.cb-main", [
      h("div.cb-fig", [h("p.cb-h", [h("span.cb-n", fmtInt(build.length)), ` ${build.length === 1 ? "deck" : "decks"} you can build`])]),
      h("p.cb-txt", `From your ${plural(n, "card")}: ${plural(build.length, "deck")} fully owned, and ${plural(near.length, "deck")} one card away.`),
    ]),
    h("div.cb-act", [
      h("a.btn.primary", { href: "#codex", "data-goto": "codex" }, [icon("back"), "Edit your collection in the Codex"]),
      h("button.btn.ghost", { type: "button", onclick: openCollection }, [icon("copy"), "Export or import"]),
    ]),
  ]);

  const parts = [head, summary, legend()];

  // said once, above the first list that has decks; a deck without a tip shows nothing in its place
  const tips = "Strategy tips exist only for the finalists of the Tier list, whose finals games were replayed.";
  parts.push(h("section.mdsec", { "aria-labelledby": "md-build" }, [
    h("h2#md-build", "Decks you can build"),
    build.length ? h("p.note", `Win rates are only comparable between decks with the same evidence level, so decks are ordered by evidence first. ${tips}`) : null,
    build.length
      ? paged(build, (r, i) => deckRow(r, `#${i + 1}`))
      : h("div.panel.soft", [h("p", "None of the measured decks fits these cards yet. The decks below are only one card away."), h("a.btn", { href: "#codex", "data-goto": "codex" }, "Mark more cards in the Codex")]),
  ]));

  parts.push(h("section.mdsec", { "aria-labelledby": "md-near" }, [
    h("h2#md-near", "One card away"),
    near.length
      ? [h("p.muted.sub", "The best decks missing exactly one card. Press the card chip to see what it does."),
        build.length ? null : h("p.note", tips),
        paged(near, (x, i) => deckRow(x.row, `#${i + 1}`, x.miss))]
      : h("div.panel.soft", h("p", "No measured deck is exactly one card away from your collection.")),
  ]));
  root.replaceChildren(...parts);
}

/** A list that shows PAGE rows and appends the next PAGE on demand, without re-rendering what is already there. */
function paged(items, mk) {
  let shown = Math.min(PAGE, items.length);
  const list = h("div.drs", items.slice(0, shown).map((it, i) => mk(it, i)));
  const count = h("p.muted", { "aria-live": "polite" });
  const btn = h("button.btn.soft", { type: "button", onclick: () => {
    const next = Math.min(items.length, shown + PAGE);
    const fresh = items.slice(shown, next).map((it, i) => mk(it, shown + i));
    list.append(...fresh);
    shown = next;
    paint();
    const first = fresh[0] && fresh[0].querySelector("button");
    if (first) first.focus({ preventScroll: true });
  } });
  const paint = () => {
    count.textContent = `Showing ${shown} of ${fmtInt(items.length)}`;
    btn.textContent = `Show ${Math.min(PAGE, items.length - shown)} more`;
    btn.hidden = shown >= items.length;
  };
  paint();
  return h("div", [list, items.length > PAGE ? h("div.more", [count, btn]) : null]);
}

function emptyState() {
  return h("div.empty.panel", [
    h("div.empty-ico", { "aria-hidden": "true" }, icon("plus", 28)),
    h("h2", "Mark the cards you own"),
    h("p", `Open the Codex and press the round button on each card you own. My decks then searches all ${fmtInt(DB.meta.totals.decks_listed || DB.meta.totals.decks_measured)} decks listed here for the ones you can build, and for the ones that are only one card away.`),
    h("div.empty-act", [
      h("a.btn.primary", { href: "#codex", "data-goto": "codex" }, ["Open the Codex", icon("arrow")]),
      h("button.btn.ghost", { type: "button", onclick: openCollection }, [icon("copy"), "Import a collection code"]),
    ]),
  ]);
}
