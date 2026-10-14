// My decks tab: the best decks the visitor can build from the cards they marked as owned, plus the best decks that are
// exactly one card away. Order is the one docs/DATA.md defines: evidence level first, then rank_score (the rows are
// already sorted that way, so the first rows that fit are the best). A deck that is also in the tier list carries its
// tier tag (joined by card set, never by position).

import { h, icon, fmtInt, pct } from "./util.js";
import { DB, loadDecks, loadTier, deckKey } from "./data.js";
import { on, isOwned, ownedCount } from "./store.js";
import { gameCard, chip } from "./cards.js";
import { disclosure } from "./ui.js";
import { openCollection } from "./dialogs.js";
import { keepLine, paintNoStore, inAppNotice } from "./keep.js";
import { t } from "./i18n.js";

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
// level -> funnel stage; the numbers of each stage come from meta.json `methodology.pipeline`
const STAGE = { 4: "finals", 3: "round_robin", 2: "halving", 1: "screen" };
const stageOf = (level) => (DB.meta.methodology.pipeline || []).find((s) => s.stage === STAGE[level]) || {};

/** What the deck's own test was, in one line ("ev.<level>.text"). */
function evidenceText(r) {
  const fin = stageOf(4);
  return t(`ev.${r.level}.text`, { games: r.games, r: r.rounds, opp: fin.decks ? fin.decks - 1 : 9 });
}

/** What a level means, for the legend ("ev.<level>.desc"). */
function levelText(level) {
  const s = stageOf(level), g = s.rounds_games || [];
  return t(`ev.${level}.desc`, { gpp: s.games_per_pair, decks: s.decks, probes: s.probe_decks, min: g[0], max: g[g.length - 1],
    refs: s.reference_decks, games: s.games_per_deck });
}

function meter(level) {
  return h("span.meter", { role: "img", "aria-label": t("md.meter", { l: level }) }, [1, 2, 3, 4].map((i) => h("i", { class: i <= level ? "on" : "" })));
}

/** The tier-list entry with the same 4 cards, or null (the tier list did not load, or the deck is not in the top 30). */
const tierDeckOf = (r) => (DB.tierBySet ? DB.tierBySet.get(deckKey(r.cards.filter(Boolean).map((c) => c.id))) || null : null);

function deckRow(r, rankLabel, miss) {
  const tr = tierDeckOf(r);
  const rank = tr ? tr.rank : r.tierRank;
  const tags = rank ? [h("span.tag", tr ? t("md.tagTier", { tier: tr.tier, rank }) : t("md.tagRank", { rank }))] : [];
  return h("article.dr", [
    h("div.dr-rank", [h("h3.rk", rankLabel)]),
    h("div.deck-cards", r.cards.map((c) => h("div.slot", gameCard(c, { size: "list" })))),
    h("div.dr-info", [
      h("div.ev", [meter(r.level), h("b", t(`stage.${STAGE[r.level]}.title`)), h("span.muted", t("ev." + r.level))]),
      h("div.dr-fig", [h("b.stat-v", pct(r.rate)), h("span.stat-s", t("md.rateCap"))]),
      h("p.dr-t", evidenceText(r)),
      miss ? h("p.dr-miss", [h("span.muted", t("md.missing") + " "), chip(miss)]) : null,
      tags.length ? h("div.tags", tags) : null,
    ]),
  ]);
}

// ---------------------------------------------------------------- page
let legendOpen = false;
function legend() {
  const btn = h("button.btn.ghost.disc", { type: "button", "aria-controls": "md-legend" }, [icon("info"), t("md.legend"), icon("chevron")]);
  const lv = DB.decks.levels;
  const region = h("div#md-legend", h("div.collapse-in", h("div.guide", [
    h("p", t("md.legendP")),
    h("ul.levels", [4, 3, 2, 1].map((l) => h("li", [meter(l), h("div", [h("b", t(`stage.${STAGE[l]}.title`)),
      h("span.muted", ` · ${t("md.levelDecks", { n: lv[l].decks })} · `), levelText(l)])]))),
  ])));
  disclosure(btn, region, { open: legendOpen, onToggle: (v) => { legendOpen = v; } });
  return h("div.guide-wrap", [btn, region]);
}

function render() {
  if (!root) return;
  const n = ownedCount();
  const head = h("div.vhead", [
    h("h1", t("md.h1")),
    h("p.lede", t("md.lede")),
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

  const parts = [head, notice, summary, legend()].filter(Boolean);

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
        paged(near, (x, i) => deckRow(x.row, `#${i + 1}`, x.miss))]
      : h("div.panel.soft", h("p", t("md.nearNone"))),
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
    count.textContent = t("md.showing", { a: shown, b: items.length });
    btn.textContent = t("md.showMore", { n: Math.min(PAGE, items.length - shown) });
    btn.hidden = shown >= items.length;
  };
  paint();
  return h("div", [list, items.length > PAGE ? h("div.more", [count, btn]) : null]);
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
  ]);
}
