// Deck tier list tab: the best decks grouped by tier, each drawn as its four game cards with its measurements, matchups
// and how many of its cards the visitor owns. Playbook tips and shop picks are pulled for now (tierlist.json carries no
// `playbook`); they come back later for the top 10 decks only (SPEC.md).
// A deck withheld by the maintainer arrives as a stub (`withheld`, no cards) and is drawn as four face-down cards with its
// facts and one line of mystery; it is never counted as a deck the visitor can build and the "Ready to play" filter hides
// it. A secret deck (`secret: true`, only its rank and tier) is drawn as four blank grey cards and the word "Secret", nothing
// else. Ranks 1-10 are the finals; the decks after them are ranked by their win rate against the top 10 (`tier.ordering`).
// Every deck keeps its rank in that full order, so a rank the data does not list is simply absent.
// A card search (the shared field of search.js) keeps only the decks holding a card whose French or English name matches;
// withheld and secret decks have no cards and hide while it is on.
// A language change redraws the page and keeps what the visitor opened (the reading guide, deck details, the filter).

import { h, icon, pm, pct, pct1, dec } from "./util.js?v=6c55cce066";
import { DB, loadTier } from "./data.js?v=6c55cce066";
import { on, isOwned, ownedCount } from "./store.js?v=6c55cce066";
import { gameCard, cardBack, secretCard, strip, cardName } from "./cards.js?v=6c55cce066";
import { disclosure, segmented, scrollToEl, cascade } from "./ui.js?v=6c55cce066";
import { t, tx, millions } from "./i18n.js?v=6c55cce066";
import { findRow, terms, namedCards } from "./search.js?v=6c55cce066";
import { introLine, patchMark } from "./patch.js?v=6c55cce066";
import { paintOwned, evLine } from "./decklist.js?v=6c55cce066";

let root, tier, decks = [], stubs = [], sections = [], jumpChips = new Map(), banner, detailBtns = [], readyBtn, readyOnly = false, spotted = false;
let find;
let openDetails = new Set(), guideOpen = false, query = "";      // kept across a redraw (language change)

export async function mount(el) {
  root = el;
  tier = await loadTier();
  render();
  // the one load sequence of this tab: the first time it is shown, the decks on screen arrive in rank order
  cascade(root, () => [...root.querySelectorAll(".tier-k, .deck:not([hidden])")]);
  on("owned", () => { updateBadges(); updateBanner(); applyShown(); });
  on("lang", () => render());
}

const cardsOf = (d) => (d.withheld || !Array.isArray(d.cards) ? [] : d.cards.map((id) => DB.byId.get(id)));

// ---------------------------------------------------------------- page
function render() {
  // what the visitor had open survives the redraw
  if (detailBtns.length) openDetails = new Set(detailBtns.filter((b) => b.getAttribute("aria-expanded") === "true").map((b) => b.dataset.rank));
  decks = [];
  stubs = [];
  sections = [];
  detailBtns = [];
  spotted = false;
  if (!ownedCount()) readyOnly = false;
  banner = h("div.callout");      // one line on the ground between two hairlines, no panel (DESIGN.md "Collection bar and callout")
  const guide = howToRead();
  const games = DB.meta && DB.meta.totals && DB.meta.totals.patch_games;
  const nodes = [
    h("div.vhead", [
      h("h1", t("tl.h1")),
      // one short line (games and patch); the method and the patch notice wait behind "About the numbers"
      ...introLine("tiers", h("p.lede.quiet", t("tl.lede", { patch: tier.patch, games: games ? millions(games) : "—" })),
        { method: t("tl.method"), legend: true }),
    ]),
    findBar(),
    banner,
    jumpNav(guide.btn),
    guide.region,
  ];
  for (const tr of tier.tiers) nodes.push(tierSection(tr));
  // the way to the overlay: one quiet line after the last tier, no banner (it promises no download)
  nodes.push(h("p.ov-tease", [h("span", t("tl.ovTease")), " ", h("a.link", { href: "overlay/" }, t("tl.ovLink"))]));
  root.replaceChildren(...nodes);
  updateBanner();
  updateBadges();
  applyShown();
}

// ---------------------------------------------------------------- card search: the decks that hold a card
// A withheld or secret deck has no cards in the data, so it never matches and hides like any other deck while a search is on.
function findBar() {
  find = findRow({ id: "tl-q", name: "deck-card", placeholder: t("find.decksPh"), label: t("find.decksAria"), clearLabel: t("cx.clearSearch"), value: query,
    onChange: (v) => { query = v; applyShown(); },
    onEnter: () => { const x = decks.find((k) => !k.el.hidden); if (x && query.trim()) scrollToEl(x.el); } });
  return find.el;
}

// ---------------------------------------------------------------- reading guide
function howToRead() {
  const btn = h("button.btn.ghost.disc", { type: "button", "aria-controls": "tl-guide" }, [icon("info"), t("tl.guide"), icon("chevron")]);
  const o = tier.ordering, rules = tier.tier_rules;
  const opp = opponents();
  const kids = [
    h("p", tx("tl.gTiers", { conf: pct(rules.confidence, 1) })),
    h("p", tx("tl.gNumbers", { opp })),
  ];
  if (o && o.key === "vs_top") {
    const from = o.first_rank_after_finals;
    kids.push(h("p", tx("tl.gOrder", { last: from - 1, from, games: o.vs_top_games, pm: Math.round(o.vs_top_ci95_mean * 100) })));
    const rr = rules.games_per_pair && rules.games_per_pair.round_robin;
    if (rr) kids.push(h("p", tx("tl.gCheck", { from, rg: rr })));
  }
  const region = h("div#tl-guide", h("div.collapse-in", h("div.guide", kids)));
  disclosure(btn, region, { open: guideOpen, onToggle: (v) => { guideOpen = v; } });
  return { btn, region };
}

/** The other good decks a deck meets in the round-robin (47 of the 48: a deck never plays itself). */
function opponents() {
  const d = tier.decks.find((x) => x.round_robin && x.round_robin.opponents);
  return d ? d.round_robin.opponents : 47;
}

function jumpNav(guideBtn) {
  readyBtn = h("button.chip.ready", { type: "button", "aria-pressed": "false", hidden: true, onclick: () => { readyOnly = !readyOnly; applyShown(); } }, [h("span.chip-l", t("tl.ready")), h("span.n")]);
  jumpChips = new Map();
  const expand = h("button.btn.ghost.expand", { type: "button", onclick: toggleAll }, t(openDetails.size ? "tl.closeAll" : "tl.openAll"));
  return h("nav.jump", { "aria-label": t("tl.jump") }, [
    ...tier.tiers.map((tr) => {
      const title = t("tl.jumpTitle", { tier: tr.tier, n: tr.size });
      const a = h("a.chip.jump-chip", { href: "#tier-" + tr.tier, title, onclick: (e) => {
        e.preventDefault();
        if (a.getAttribute("aria-disabled") === "true") return;       // its tier is hidden by the "Ready to play" filter
        scrollToEl(document.getElementById("tier-" + tr.tier));
      } }, [h("span.chip-l", tr.tier), h("span.n", String(tr.size))]);
      jumpChips.set(tr.tier, { a, title });
      return a;
    }),
    readyBtn,
    h("span.jump-gap"),
    guideBtn,
    expand,
  ]);
}

function toggleAll(e) {
  const closed = detailBtns.some((b) => b.getAttribute("aria-expanded") !== "true");
  detailBtns.forEach((b) => { if ((b.getAttribute("aria-expanded") !== "true") === closed) b.click(); });
  e.currentTarget.textContent = t(closed ? "tl.closeAll" : "tl.openAll");
}

// ---------------------------------------------------------------- tiers
function tierSection(tr) {
  const sep = tr.separated_from_previous_leader;
  const ranks = t(tr.rank_from === tr.rank_to ? "tl.rank1" : "tl.ranks", { from: tr.rank_from, to: tr.rank_to });
  let why;
  if (!sep) why = t("tl.sTop");
  else {
    const prev = tier.tiers[tier.tiers.indexOf(tr) - 1];
    why = t(sep.scale === "round_robin" ? "tl.gapRR" : "tl.gapFinals", { gap: dec(sep.difference * 100, 1), prev: prev.tier });
  }
  const list = tier.decks.filter((d) => d.tier === tr.tier);
  const panels = list.map((d) => deckPanel(d));
  // the tier letter is the anchor: a big letter in its own rail (it follows the scroll along its decks), no box around it;
  // a hairline spine down the decks groups them, a hairline between two decks separates them (DESIGN.md "Deck tier list")
  const el = h("section.tier", { id: "tier-" + tr.tier, "aria-labelledby": "tier-h-" + tr.tier }, [
    h("div.tier-rail", h("h2.tier-k", { id: "tier-h-" + tr.tier }, [h("span.sr", t("tl.tier", { tier: "" })), tr.tier])),
    h("div.tier-body", [
      // the ranks only; why the tier starts here is one hover away (and in "How to read")
      // (a one-rank tier says nothing its deck's "#1" does not; its line keeps its place, empty, for the tooltip)
      h("p.tier-what", { title: why }, tr.rank_from === tr.rank_to ? "" : ranks),
      h("div.decks", panels),
    ]),
  ]);
  sections.push({ el, list });
  return el;
}

// ---------------------------------------------------------------- one deck
/** The two measurements of a deck, the one that sets the rank first; `basis` lists their captions (games, field). */
function measures(d) {
  const opp = (d.round_robin && d.round_robin.opponents) || opponents();
  // the finals set ranks 1-10 (that is the vs top 10 number); after them the rank follows vs top 10 too (tier.ordering)
  const byTop = d.finalist || (tier.ordering && tier.ordering.key === "vs_top");
  const top = { all: "tl.allTop", label: t("tl.vsTop"), tip: t("tl.vsTopTip"), m: d.vs_top, cap: t(d.finalist ? "tl.capFinalist" : "tl.capFinalists", { games: d.vs_top.games }) };
  const good = { all: "tl.allGood", label: t("tl.vsGood"), tip: t("tl.vsGoodTip", { opp }), m: d.vs_good, cap: t("tl.capRR", { games: d.vs_good.games, opp }) };
  return byTop ? [top, good] : [good, top];
}

/**
 * A deck's facts, drawn as every measured deck of the site is (decklist.js, My decks and the Deck builder): the evidence
 * line (four bars, the stage, how reliable), the number that sets the rank with its field under it, then the other number
 * as one quiet line. The basis of each (games and field) is its tooltip and the first line of the Matchups region.
 */
function facts(d) {
  const [main, other] = measures(d);
  return h("div.dfacts", [
    evLine(d.finalist ? 4 : 3),
    h("div.dr-fig", { title: `${main.tip} ${main.cap}.` }, [
      h("span.fig-line", [h("b.stat-v", pct1(main.m.win_rate)), h("span.fig-pm", { title: t("tl.pmTip") }, pm(main.m.ci95))]),
      h("span.stat-s", [main.label, h("span.sr", t("ui.sep") + t("tl.setsRank"))]),
    ]),
    h("p.fig-all", { title: `${other.tip} ${other.cap}.` }, t(other.all, { pct: pct1(other.m.win_rate) })),
  ]);
}
/** "vs top 10: 1,800 games vs the 9 other finalists." and the same for the second number: the basis of both figures. */
const basis = (d) => h("p.note.basis", measures(d).map((x) => t("tl.basis", { label: x.label, caption: x.cap })).join(" "));

function deckPanel(d) {
  if (d.secret) return secretPanel(d);
  if (d.withheld) return withheldPanel(d);
  const cs = cardsOf(d);
  const spotlight = !spotted;           // the first deck that can be shown gets full cards
  spotted = true;
  const badge = h("div.obadge", { hidden: true });

  const region = h("div", { id: "dk-d-" + d.rank });
  const inner = h("div.collapse-in");
  region.append(inner);
  const btn = h("button.btn.ghost.disc", { type: "button", "aria-controls": "dk-d-" + d.rank, "data-rank": String(d.rank) }, [t("tl.details"), icon("chevron")]);
  let built = false;
  disclosure(btn, region, { open: openDetails.has(String(d.rank)), onToggle: (v) => { if (v && !built) { built = true; inner.append(basis(d), ...details(d)); } } });
  detailBtns.push(btn);

  // a card the last patch changed carries the small patch mark on its slot, never on its face (patch.js)
  const slots = cs.map((c) => h("div.slot", [gameCard(c, { size: spotlight ? "full" : "list", eager: spotlight }), patchMark(c)]));
  const cardsEl = h("div.deck-cards" + (spotlight ? ".full" : ""), slots);

  const el = h("article.deck" + (spotlight ? ".spot" : ""), { id: "deck-" + d.rank, "aria-label": t("tl.rankAria", { rank: d.rank, cards: cs.map(cardName).join(", ") }) }, [
    h("div.deck-head", [
      h("h3.rk", `#${d.rank}`),
      badge,
    ]),
    h("div.deck-body", [
      cardsEl,
      h("div.deck-facts", facts(d)),
    ]),
    btn, region,
  ]);
  decks.push({ d, cs, badge, el, slots });
  return el;
}

/** A withheld deck: four face-down cards (only their rarity is known), its facts like any deck, and one line of mystery. */
function withheldPanel(d) {
  const el = h("article.deck.withheld", { id: "deck-" + d.rank, "aria-label": t("tl.downAria", { rank: d.rank }) }, [
    h("div.deck-head", [
      h("h3.rk", `#${d.rank}`),
      h("span.deck-word.hush", t("tl.downLine")),
    ]),
    h("div.deck-body", [
      h("div.deck-cards", (d.rarities || []).map((r) => h("div.slot", cardBack(r)))),
      h("div.deck-facts", facts(d)),
    ]),
  ]);
  stubs.push(el);
  return el;
}

/** A secret deck: its rank, four blank grey cards and the word "Secret". The data holds nothing else about it. */
function secretPanel(d) {
  const el = h("article.deck.secret", { id: "deck-" + d.rank, "aria-label": t("tl.secretAria", { rank: d.rank }) }, [
    h("div.deck-head", [h("h3.rk", `#${d.rank}`), h("span.deck-word", t("tl.secret"))]),
    h("div.deck-body", [
      h("div.deck-cards", { "aria-hidden": "true" }, [0, 1, 2, 3].map(() => h("div.slot", secretCard()))),   // the panel's label says it
      h("div.deck-facts", h("p.muted", t("tl.secretLine"))),
    ]),
  ]);
  stubs.push(el);
  return el;
}

// ---------------------------------------------------------------- details: counters
function details(d) {
  return [h("div.dgrid", h("section.dsec", [h("h4", t("tl.hard")), countersBlock(d)]))];
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

function counterRow(c, worst) {
  const cards = c.cards.map((id) => DB.byId.get(id)).filter(Boolean);
  // facts about the counter in quiet words, not boxes: its tier-list rank, and "could be luck" when it could
  const tags = [];
  if (c.tier_rank) tags.push(h("span.deck-word", t("tl.counterRank", { rank: c.tier_rank })));
  if (c.significant === false) tags.push(h("span.deck-word.luck", { title: t("tl.luckTip") }, t("tl.luck")));
  return h("li.crow", [
    strip(cards),
    h("div.crow-t", [
      h("p.crow-l", [...(worst ? [...tx("tl.worst"), " "] : []), t("tl.wins", { pct: pct1(c.score), games: c.games })]),
      tags.length ? h("div.tags", tags) : null,
    ]),
  ]);
}

function countersBlock(d) {
  const wrap = h("div.counters");
  const hasFinals = d.finalist && Array.isArray(d.counters_finals);
  const mode = { v: hasFinals && d.counters_finals.length ? "finals" : "round_robin" };
  const body = h("div.counters-body");
  const perPair = (finals) => {
    const g = tier.tier_rules.games_per_pair || {};
    return finals ? g.finals : g.round_robin;
  };
  const paint = () => {
    const finals = mode.v === "finals";
    const list = (finals ? d.counters_finals : d.counters_round_robin) || [];
    const rows = [];
    const w = d.worst_matchup;
    const sameScale = w && w.scale === (finals ? "finals" : "round_robin");
    if (!list.length) {
      rows.push(h("p.muted", t(finals ? "tl.noBeatFinals" : "tl.noBeatRR")));
      if (sameScale) rows.push(h("ul.crows", counterRow({ cards: w.cards, score: w.score, games: w.games, significant: null, tier_rank: w.tier_rank }, true)));
    } else {
      rows.push(h("ul.crows", list.map((c, i) => counterRow(c, i === 0 && sameScale && sameSet(c.cards, w.cards)))));
    }
    rows.push(h("p.note", t(finals ? "tl.noteFinals" : "tl.noteRR", { games: perPair(finals) })));
    body.replaceChildren(...rows);
  };
  if (hasFinals) {
    const seg = segmented([["finals", t("tl.fieldFinals")], ["round_robin", t("tl.fieldRR")]], mode.v, (v) => { mode.v = v; paint(); }, t("tl.field"));
    wrap.append(seg.el);
  }
  paint();
  wrap.append(body);
  return wrap;
}

// ---------------------------------------------------------------- owned state
function updateBadges() {
  for (const x of decks) x.ready = paintOwned(x.badge, x.cs) === 4;
}

/**
 * Which decks show: the "Ready to play" chip (shown once there is a collection) hides the decks that are not fully owned,
 * and a card search hides the decks that hold no matching card. Withheld and secret decks hide under either.
 */
function applyShown() {
  if (!readyBtn) return;
  const any = ownedCount() > 0;
  const ready = decks.filter((x) => x.ready);
  if (!any) readyOnly = false;
  readyBtn.hidden = !any;
  readyBtn.setAttribute("aria-pressed", String(readyOnly));
  readyBtn.querySelector(".n").textContent = String(ready.length);
  readyBtn.disabled = !ready.length && !readyOnly;
  readyBtn.title = t(ready.length ? "tl.readyOn" : "tl.readyOff");
  const ts = terms(query);
  const hits = ts.length ? namedCards(ts) : [];
  let found = 0;
  for (const x of decks) {
    const hit = !ts.length || x.cs.some((c) => hits.includes(c));
    x.show = hit && (!readyOnly || x.ready);
    x.el.hidden = !x.show;
    if (hit && ts.length) found += x.show ? 1 : 0;
    // inside a deck that matches, the cards that do not are dimmed, so the matching card stands out
    x.slots.forEach((s, i) => s.classList.toggle("miss", ts.length > 0 && !hits.includes(x.cs[i])));
  }
  for (const el of stubs) el.hidden = readyOnly || ts.length > 0;          // no cards: never owned, never found
  for (const s of sections) {
    // withheld and secret stubs are not in `decks`, so a section holding only stubs hides under either filter
    const shown = s.list.some((d) => { const x = decks.find((k) => k.d === d); return x ? x.show : !readyOnly && !ts.length; });
    s.el.hidden = !shown;
    // a hidden tier keeps its jump chip in place, disabled, and says why (nothing jumps, nothing points at an empty box)
    const name = s.el.id.replace(/^tier-/, "");
    const chipRef = jumpChips.get(name);
    if (chipRef) {
      if (shown) { chipRef.a.removeAttribute("aria-disabled"); chipRef.a.removeAttribute("tabindex"); chipRef.a.title = chipRef.title; }
      else { chipRef.a.setAttribute("aria-disabled", "true"); chipRef.a.tabIndex = -1; chipRef.a.title = t(ts.length ? "tl.jumpNoHit" : "tl.jumpOff", { tier: name }); }
    }
  }
  find.paint(ts, hits, hits.filter((c) => decks.some((x) => x.cs.includes(c))), found);
}

function updateBanner() {
  if (!banner) return;
  const n = ownedCount();
  const go = (label, tab) => h("a.btn.primary", { href: "#" + tab, "data-goto": tab }, [label, icon("arrow")]);
  if (!n) {
    banner.replaceChildren(
      h("div.callout-t", h("h2", t("tl.callH"))),
      go(t("tl.callGo"), "codex"),
    );
    return;
  }
  let ready = 0, near = 0;
  for (const x of decks) {
    const m = x.cs.filter((c) => !isOwned(c.key)).length;
    if (m === 0) ready++; else if (m === 1) near++;
  }
  banner.replaceChildren(
    h("div.callout-t", [h("h2", t("tl.ownH", { n })), h("p", t("tl.ownP", { total: decks.length, ready, near }))]),
    go(t("tl.ownGo"), "decks"),
  );
}

