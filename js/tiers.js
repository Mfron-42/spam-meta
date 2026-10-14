// Tier list tab: the best decks grouped by tier, each drawn as its four game cards with its measurements, matchups,
// strategy tip, shop picks, talents (only when the data has them) and how many of its cards the visitor owns.
// A deck withheld by the maintainer arrives as a stub (`withheld`, no cards) and is drawn as four face-down cards with its
// numbers and the pay-to-win note; it is never counted as a deck the visitor can build and the "Ready to play" filter hides
// it. Decks keep the lab's ranks, so a rank the data does not list is simply absent.

import { h, icon, fmtInt, pm, plural } from "./util.js";
import { DB, loadTier, WITHHELD_SHORT } from "./data.js";
import { on, isOwned, ownedCount, getLang } from "./store.js";
import { gameCard, cardBack, chip, strip, chipify, cardName } from "./cards.js";
import { disclosure, segmented, scrollToEl } from "./ui.js";

const pct1 = (p) => (p * 100).toFixed(1) + "%";          // one decimal everywhere in the cells, so 73.0% lines up with 67.5%
const pct0 = (p) => Math.round(p * 100) + "%";

let root, tier, decks = [], stubs = [], sections = [], jumpChips = new Map(), banner, detailBtns = [], readyBtn, readyOnly = false, spotted = false;

export async function mount(el) {
  root = el;
  tier = await loadTier();
  render();
  on("owned", () => { updateBadges(); updateBanner(); applyReady(); });
  on("lang", () => render());
}

const cardsOf = (d) => (d.withheld || !Array.isArray(d.cards) ? [] : d.cards.map((id) => DB.byId.get(id)));

/** A finalist's strategy tip (from the replay of the finals), card names as chips; null for every other deck. My decks reuses it. */
export function tipBlock(d) {
  if (!d || d.withheld || !d.playbook || !d.playbook.tip) return null;
  return h("p.tip", { lang: "en" }, [h("b", "How it wins. "), ...chipify(d.playbook.tip)]);
}

function render() {
  decks = [];
  stubs = [];
  sections = [];
  detailBtns = [];
  spotted = false;
  readyOnly = false;
  const gamesText = DB.meta && DB.meta.totals && DB.meta.totals.patch_games ? ` from about ${(DB.meta.totals.patch_games / 1e6).toFixed(2)} million simulated matches` : "";
  // names the face-down ranks (a withheld deck keeps its rank and its numbers); a no-break space keeps "Rank" with its number
  const down = tier.decks.filter((d) => d.withheld).map((d) => d.rank);
  const one = down.length === 1;
  const rankList = one ? String(down[0]) : `${down.slice(0, -1).join(", ")} and ${down[down.length - 1]}`;
  const downText = down.length ? ` ${one ? "Rank" : "Ranks"} ${rankList} ${one ? "is" : "are"} drawn face down: ${one ? "its" : "their"} numbers are shown, not ${one ? "its" : "their"} cards.` : "";
  banner = h("div.callout.panel");
  const guide = howToRead();
  const nodes = [
    h("div.vhead", [
      h("h1", "The best decks in SPAM"),
      h("p.lede", `The strongest decks of patch ${tier.patch}, ranked${gamesText} (strong AI, no talents).${downText}`),
    ]),
    banner,
    jumpNav(guide.btn),
    guide.region,
  ];
  for (const t of tier.tiers) nodes.push(tierSection(t));
  root.replaceChildren(...nodes);
  updateBanner();
  updateBadges();
  applyReady();
}

// ---------------------------------------------------------------- reading guide
function howToRead() {
  const btn = h("button.btn.ghost.disc", { type: "button", "aria-controls": "tl-guide" }, [icon("info"), "How to read this page", icon("chevron")]);
  const rules = tier.tier_rules;
  const region = h("div#tl-guide", h("div.collapse-in", h("div.guide", [
    h("p", rules.summary),
    h("p", "In practice, decks inside one tier are close and are not ranked apart with confidence. A new tier starts only when the gap to the tier leader is too big to be luck."),
    h("p", [h("b", "The same two numbers for every deck. "), "Each deck shows its win rate against the top 10 decks (the finalists) and against the good decks (the 47 other decks of the round-robin). They are measured the same way for all decks, so you can compare them from one tier to another. The rank itself comes from the finals for ranks 1 to 10 and from the round-robin for the rest; the number that sets the rank is tagged. For ranks 11 and below, the top-10 number rests on fewer games, so its interval is wider."]),
    h("ul", rules.caveats.filter((t) => !/^Ranks 1-10/.test(t)).map((t) => h("li", t))),
  ])));
  disclosure(btn, region, { open: false });
  return { btn, region };
}

function jumpNav(guideBtn) {
  readyBtn = h("button.chip.ready", { type: "button", "aria-pressed": "false", hidden: true, onclick: () => { readyOnly = !readyOnly; applyReady(); } }, [h("span.chip-l", "Ready to play"), h("span.n")]);
  jumpChips = new Map();
  return h("nav.jump", { "aria-label": "Jump to a tier" }, [
    ...tier.tiers.map((t) => {
      const a = h("a.chip.jump-chip", { href: "#tier-" + t.tier, title: `Tier ${t.tier}, ${plural(t.size, "deck")}`, onclick: (e) => {
        e.preventDefault();
        if (a.getAttribute("aria-disabled") === "true") return;       // its tier is hidden by the "Ready to play" filter
        scrollToEl(document.getElementById("tier-" + t.tier));
      } }, [h("span.chip-l", t.tier), h("span.n", String(t.size))]);
      jumpChips.set(t.tier, { a, title: a.title });
      return a;
    }),
    readyBtn,
    h("span.jump-gap"),
    guideBtn,
    h("button.btn.ghost.expand", { type: "button", onclick: toggleAll }, "Show all matchups and shop picks"),
  ]);
}

function toggleAll(e) {
  const closed = detailBtns.some((b) => b.getAttribute("aria-expanded") !== "true");
  detailBtns.forEach((b) => { if ((b.getAttribute("aria-expanded") !== "true") === closed) b.click(); });
  e.currentTarget.textContent = closed ? "Hide all matchups and shop picks" : "Show all matchups and shop picks";
}

// ---------------------------------------------------------------- tiers
function tierSection(t) {
  const sep = t.separated_from_previous_leader;
  let why;
  if (t.tier === "S") why = "The strongest deck of the patch.";
  else {
    const prev = tier.tiers[tier.tiers.indexOf(t) - 1];
    why = `Clearly below tier ${prev.tier}: the leader of tier ${prev.tier} scores ${(sep.difference * 100).toFixed(1)} points more than this tier’s leader against the same opponents (99.9% sure it is not luck).`;
  }
  const ranks = t.rank_from === t.rank_to ? `Rank ${t.rank_from}` : `Ranks ${t.rank_from} to ${t.rank_to}`;
  const what = t.tier === "S" ? `${ranks}, ${plural(t.size, "deck")}. ${why}` : `${ranks}, ${plural(t.size, "deck")}.`;
  const list = tier.decks.filter((d) => d.tier === t.tier);
  const panels = list.map((d) => deckPanel(d));
  const el = h("section.tier", { id: "tier-" + t.tier, "aria-labelledby": "tier-h-" + t.tier }, [
    h("header.tier-head", [
      h("div.tier-k", { "aria-hidden": "true" }, t.tier),
      h("div.tier-what", [h("h2", { id: "tier-h-" + t.tier }, `Tier ${t.tier}`), h("p.muted", what), t.tier === "S" ? null : h("p.muted", why)]),
    ]),
    h("div.decks", panels),
  ]);
  sections.push({ el, list });
  return el;
}

// ---------------------------------------------------------------- one deck
function stat(label, tip, m, caption, defining) {
  return h("div.stat", [
    h("span.stat-k", [h("span.stat-l", { title: tip }, label), defining ? h("span.tag.soft", { title: "This is the number that decides the deck’s rank" }, "Sets the rank") : null]),
    h("div.stat-line", [h("b.stat-v", pct1(m.win_rate)), h("span.stat-pm", { title: "95% interval, in percentage points" }, pm(m.ci95))]),
    h("span.stat-s", `${fmtInt(m.games)} games ${caption}`),
  ]);
}

function stats(d) {
  const opp = (d.round_robin && d.round_robin.opponents) || +((/the (\d+) other/.exec(d.measured_against_text) || [])[1]) || 47;
  return h("div.stats", [
    stat("vs top 10", "How often this deck beats the 10 best decks of the patch, the finalists. A deck is never counted against itself.", d.vs_top, d.finalist ? "against the 9 other finalists" : "against the 10 finalists", d.finalist),
    stat("vs good decks", `How often this deck beats the ${opp} other good decks of the round-robin. A deck is never counted against itself.`, d.vs_good, `against ${opp} other round-robin decks`, !d.finalist),
  ]);
}

function deckPanel(d) {
  if (d.withheld) return withheldPanel(d);
  const cs = cardsOf(d);
  const spotlight = !spotted;           // the first deck that can be shown gets full cards
  spotted = true;
  const badge = h("div.obadge", { hidden: true });

  const region = h("div", { id: "dk-d-" + d.rank });
  const inner = h("div.collapse-in");
  region.append(inner);
  const btn = h("button.btn.ghost.disc", { type: "button", "aria-controls": "dk-d-" + d.rank }, ["Matchups and shop picks", icon("chevron")]);
  let built = false;
  disclosure(btn, region, { open: false, onToggle: (v) => { if (v && !built) { built = true; inner.append(...details(d)); } } });
  detailBtns.push(btn);

  const cardsEl = h("div.deck-cards" + (spotlight ? ".full" : ""), cs.map((c) =>
    h("div.slot", gameCard(c, { size: spotlight ? "full" : "list", eager: spotlight }))));

  const el = h("article.deck.panel" + (spotlight ? ".spot" : ""), { id: "deck-" + d.rank, "aria-label": `Rank ${d.rank}: ${cs.map(cardName).join(", ")}` }, [
    h("div.deck-head", [
      h("h3.rk", `#${d.rank}`),
      d.finalist ? h("span.tag", "Finalist") : null,
      badge,
    ]),
    h("div.deck-body", [
      cardsEl,
      h("div.deck-facts", stats(d)),
    ]),
    tipBlock(d), btn, region,
  ]);
  decks.push({ d, cs, badge, el });
  return el;
}

/** A withheld deck: four face-down cards (only their rarity is known), its numbers, and why the cards are not shown. */
function withheldPanel(d) {
  const el = h("article.deck.panel.withheld", { id: "deck-" + d.rank, "aria-label": `Rank ${d.rank}: four cards, not shown yet` }, [
    h("div.deck-head", [
      h("h3.rk", `#${d.rank}`),
      d.finalist ? h("span.tag", "Finalist") : null,
      h("span.tag.soft", "Cards not shown yet"),
    ]),
    h("div.deck-body", [
      h("div.deck-cards", (d.rarities || []).map((r) => h("div.slot", cardBack(r)))),
      h("div.deck-facts", stats(d)),
    ]),
    h("p.tip", [h("b", "Why the cards are hidden. "), WITHHELD_SHORT]),
  ]);
  stubs.push(el);
  return el;
}

// ---------------------------------------------------------------- details: counters, shop picks, talents
function details(d) {
  const out = [h("section.dsec", [h("h4", "Hardest matchups"), countersBlock(d)])];
  if (d.playbook && d.playbook.upgrades && d.playbook.upgrades.length) out.push(h("section.dsec", [h("h4", "Most bought shop upgrades"), shopBlock(d)]));
  else if (!d.finalist) out.push(h("section.dsec", [h("h4", "Strategy and shop picks"), h("p.muted", "These come from replays of the finals, so only the finalists have them. This deck was measured in the round-robin only.")]));
  if (d.best_talents) out.push(h("section.dsec.wide", [h("h4", "Best talents"), talentsBlock(d)]));
  return [h("div.dgrid", out)];
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

function counterRow(c, worst) {
  const cards = c.cards.map((id) => DB.byId.get(id)).filter(Boolean);
  const tags = [];
  if (c.tier_rank) tags.push(h("span.tag", `#${c.tier_rank} in the tier list`));
  if (c.significant === false) tags.push(h("span.tag.soft", { title: "At this number of games the gap could be luck" }, "Not significant"));
  return h("li.crow", [
    strip(cards),
    h("div.crow-t", [
      h("p.crow-l", [worst ? h("b", "Worst matchup. ") : null, `This deck wins ${pct1(c.score)} of ${fmtInt(c.games)} games against it.`]),
      tags.length ? h("div.tags", tags) : null,
    ]),
  ]);
}

function countersBlock(d) {
  const wrap = h("div.counters");
  const hasFinals = d.finalist && Array.isArray(d.counters_finals);
  const mode = { v: hasFinals && d.counters_finals.length ? "finals" : "round_robin" };
  const body = h("div.counters-body");
  const paint = () => {
    const finals = mode.v === "finals";
    const list = (finals ? d.counters_finals : d.counters_round_robin) || [];
    const rows = [];
    const w = d.worst_matchup;
    const sameScale = w && w.scale === (finals ? "finals" : "round_robin");
    if (!list.length) {
      rows.push(h("p.muted", finals ? "No other deck listed on this site beats it in the finals." : "No deck listed on this site beats it in the round-robin."));
      if (sameScale) rows.push(h("ul.crows", counterRow({ cards: w.cards, score: w.score, games: w.games, significant: null, tier_rank: w.tier_rank }, true)));
    } else {
      rows.push(h("ul.crows", list.map((c, i) => counterRow(c, i === 0 && sameScale && sameSet(c.cards, w.cards)))));
    }
    rows.push(h("p.note", finals
      ? "Finals field: 200 games per pair. The worst of many noisy numbers is biased low, so it looks worse than the deck really is."
      : "Round-robin field: 32 games per pair. The worst of many noisy numbers is biased low, so most of these gaps are not significant."));
    body.replaceChildren(...rows);
  };
  if (hasFinals) {
    const seg = segmented([["finals", "Finals field"], ["round_robin", "Round-robin field"]], mode.v, (v) => { mode.v = v; paint(); }, "Matchup field");
    wrap.append(seg.el);
  }
  paint();
  wrap.append(body);
  return wrap;
}

function shopBlock(d) {
  const pb = d.playbook;
  return h("div.shopblk", [
    h("ul.shop", pb.upgrades.map((u) => {
      const card = DB.byId.get(u.card);
      return h("li.shop-row", [
        h("div.shop-main", [
          h("b.shop-n", { lang: "fr", translate: "no" }, u.upgrade),
          h("span.muted", " on "),
          card ? chip(card) : null,
        ]),
        h("p.shop-d", { lang: "fr" }, u.effect),
        h("p.shop-s", `Bought in ${pct0(u.share_of_games)} of games (${plural(u.games_bought, "game")} of ${pb.replay.games}), median round ${u.median_round}.`),
      ]);
    })),
    h("p.note", `Taken from a replay of ${pb.replay.games} finals games; upgrade names and effects are in French, as in the game. These counts show what the AI buys, not what causes wins.`),
  ]);
}

function talentsBlock(d) {
  const bt = d.best_talents;
  if (bt.status === "no_talent_improves") return h("p", "None of the talents improved this deck in testing.");
  const lang = getLang();
  const pick = bt.by_card.map((p) => {
    const c = DB.byId.get(p.card);
    const t = p.talent;
    return h("li.tal", [c ? chip(c) : null, t ? h("span", { lang }, ["→ ", h("b", lang === "fr" ? t.name_fr : t.name_en)]) : h("span.muted", "no talent")]);
  });
  return h("div.shopblk", [
    h("ul.tals", pick),
    h("p", `With these talents the deck wins ${pct1(bt.win_rate_with_talents)} against ${pct1(bt.win_rate_talent_free)} without: ${bt.gain >= 0 ? "+" : "−"}${(Math.abs(bt.gain) * 100).toFixed(1)} points (${pm(bt.ci95)}). ${bt.significant ? "The gain is larger than the noise." : "The gain is within the noise."}`),
  ]);
}

// ---------------------------------------------------------------- owned state
function updateBadges() {
  const any = ownedCount() > 0;
  for (const x of decks) {
    const own = x.cs.filter((c) => isOwned(c.key));
    const miss = x.cs.filter((c) => !isOwned(c.key));
    x.ready = own.length === 4;
    x.badge.hidden = !any;
    x.badge.className = "obadge" + (own.length === 4 ? " full" : "");
    if (!any) continue;
    if (own.length === 4) x.badge.replaceChildren(icon("check"), h("span", "You own all 4 cards. Ready to play."));
    else if (miss.length <= 2) x.badge.replaceChildren(h("span", `You own ${own.length}/4`), h("span.muted", " · missing"), ...miss.map(chip));
    else x.badge.replaceChildren(h("span", `You own ${own.length}/4`));
  }
}

/** The "Ready to play" chip: shown once there is a collection, hides the decks that are not fully owned. */
function applyReady() {
  if (!readyBtn) return;
  const any = ownedCount() > 0;
  const ready = decks.filter((x) => x.ready);
  if (!any) readyOnly = false;
  readyBtn.hidden = !any;
  readyBtn.setAttribute("aria-pressed", String(readyOnly));
  readyBtn.querySelector(".n").textContent = String(ready.length);
  readyBtn.disabled = !ready.length && !readyOnly;
  readyBtn.title = ready.length ? "Show only the decks you can already play" : "You do not own all 4 cards of any deck shown yet";
  for (const x of decks) x.el.hidden = readyOnly && !x.ready;
  for (const el of stubs) el.hidden = readyOnly;          // a withheld deck can never be owned
  for (const s of sections) {
    // withheld stubs are not in `decks`, so a section holding only stubs hides under the filter
    const shown = s.list.some((d) => { const x = decks.find((k) => k.d === d); return !readyOnly || (x && x.ready); });
    s.el.hidden = !shown;
    // a hidden tier keeps its jump chip in place, disabled, and says why (nothing jumps, nothing points at an empty box)
    const chip = jumpChips.get(s.el.id.replace(/^tier-/, ""));
    if (chip) {
      if (shown) { chip.a.removeAttribute("aria-disabled"); chip.a.removeAttribute("tabindex"); chip.a.title = chip.title; }
      else { chip.a.setAttribute("aria-disabled", "true"); chip.a.tabIndex = -1; chip.a.title = `No deck you can play in tier ${s.el.id.replace(/^tier-/, "")}`; }
    }
  }
}

function updateBanner() {
  if (!banner) return;
  const n = ownedCount();
  const go = (label, tab) => h("a.btn.primary", { href: "#" + tab, "data-goto": tab }, [label, icon("arrow")]);
  if (!n) {
    banner.replaceChildren(
      h("div.callout-t", [h("h2", "Which of these can you play?"), h("p", "Mark the cards you own in the Codex and every deck below shows how close you are.")]),
      go("Mark your cards in the Codex", "codex"),
    );
    return;
  }
  let ready = 0, near = 0;
  for (const x of decks) {
    const m = x.cs.filter((c) => !isOwned(c.key)).length;
    if (m === 0) ready++; else if (m === 1) near++;
  }
  banner.replaceChildren(
    h("div.callout-t", [h("h2", `You own ${plural(n, "card")}`), h("p", `${ready} of the ${decks.length} decks shown here with their cards ${ready === 1 ? "is" : "are"} ready to play and ${near} ${near === 1 ? "is" : "are"} one card away. My decks searches all ${fmtInt(DB.meta.totals.decks_listed || DB.meta.totals.decks_measured)} decks that are listed.`)]),
    go("See the decks you can build", "decks"),
  );
}
