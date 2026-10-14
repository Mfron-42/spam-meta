// Card tier list tab: every card ranked on two separate measurements (competitive decks, random decks), one at a time,
// as classic tier rows S+ to E plus "Not measured". A toggle switches the measurement without moving the page (each row
// keeps the height the larger of its two lists needs, and the icons slide to their new place). A dot on a card says its
// tier differs on the other measurement beyond noise; the rings (different tier, within noise) are off by default and a
// secondary toggle in Find and filter shows them (owner's decision, 2026-10-14). Hover, focus or tap shows the card's
// numbers on both measurements and its presence in the decks the site lists; the pinned card links to the card dialog.
// A Details view lists every card in a sortable table. Data: data/cardtiers.json (tools/export_cardtiers.py); presence is
// counted here from tierlist.json and decks.json, the files the other tabs already read. No counter is shown per card.

import { h, $, $$, icon, fmtInt, plural, reducedMotion, norm } from "./util.js";
import { DB, loadCardTiers, loadTier, loadDecks } from "./data.js";
import { on, getLang } from "./store.js";
import { cardName, otherName, chip, ELEMENTS, ELEMENT_NAME, RARITIES, RARITY_NAME } from "./cards.js";
import { disclosure, filterChip, setChip } from "./ui.js";

const AX = { c: "Competitive decks", r: "Random decks" };
const KEY = { c: "competitive", r: "random" };
const TC = { "S+": "sp", S: "s", A: "a", B: "b", C: "c", D: "d", E: "e", nm: "nm" };
const LEVEL = { 4: "finals", 3: "round-robin", 2: "halving", 1: "quick screen" };
const AG = { same: "Same tier", noise: "Within noise", apart: "Disagree", differ: "Different tier" };
const thumb = (c) => `assets/thumbs/s/${c.key}.webp`;
const sgn = (x) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(2);
const pc1 = (x) => (x * 100).toFixed(1) + "%";
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
const other = (a) => (a === "c" ? "r" : "c");

let root, T, TIERS, rows = [], P, N = {};
const S = { axis: "c", view: "list", q: "", ra: new Set(), el: new Set(), tier: new Set(), sort: "score", rings: false };
const ui = {};

export async function mount(el) {
  root = el;
  [T] = await Promise.all([loadCardTiers(), loadTier(), loadDecks()]);
  TIERS = T.tiers.concat(["nm"]);
  rows = T.cards.map((r, i) => ({ i, c: r.card, ax: { c: r.competitive, r: r.random }, ag: r.agreement }));
  presence();
  build();
  on("lang", () => relabel());
  // the tab is left: a pinned card closes, so it is not waiting there when the visitor comes back
  window.addEventListener("hashchange", () => hidePop(true));
}

const axOf = (x, a) => x.ax[a];
const tierOf = (x, a) => (x.ax[a] ? x.ax[a].tier : "nm");

// ---------------------------------------------------------------- presence in the decks the site lists
function presence() {
  const shown = DB.tier.decks.filter((d) => !d.withheld && Array.isArray(d.cards));
  N = { top10: shown.filter((d) => d.rank <= 10).length, top30: shown.length, listed: DB.decks.rows.length };
  P = new Map();
  const get = (id) => { if (!P.has(id)) P.set(id, { t10: 0, t30: 0, all: 0, bt: null, br: null, bl: null, good: [], top: [] }); return P.get(id); };
  for (const d of shown) {
    for (const id of d.cards) {
      const p = get(id);
      p.t30++;
      if (d.rank <= 10) p.t10++;
      p.bt = p.bt == null ? d.rank : Math.min(p.bt, d.rank);
      p.good.push(d.vs_good.win_rate);
      p.top.push(d.vs_top.win_rate);
    }
  }
  DB.decks.rows.forEach((r, k) => {
    for (const c of r.cards) {
      if (!c) continue;
      const p = get(c.id);
      p.all++;
      if (p.br == null) { p.br = k + 1; p.bl = r.level; }
    }
  });
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  for (const p of P.values()) { p.vg = mean(p.good); p.vt = mean(p.top); }
}
const presOf = (x) => P.get(x.c.id) || { t10: 0, t30: 0, all: 0, bt: null, br: null, bl: null, vg: null, vt: null };

// ---------------------------------------------------------------- page
function build() {
  const f = T.facts;
  ui.announce = h("p.sr", { "aria-live": "polite" });
  ui.list = h("div.ct-list", { id: "ct-list", tabindex: "-1" });
  ui.pop = h("div.ct-pop#ct-pop", { "aria-hidden": "true" });
  ui.tbody = h("tbody");
  ui.notes = {};
  root.replaceChildren(
    h("div.vhead.ct-head", [
      h("h1", "The best cards in SPAM"),
      h("p.lede", "Every card ranked twice, on two separate measurements: switch between them below."),
    ]),
    caveat(),
    toolbar(),
    filtersRegion(),
    ui.announce,
    axisNotes(f),
    h("section.ct-view", { id: "ct-view-list", role: "tabpanel", "aria-labelledby": "ct-tab-list" }, [
      h("h2.sr", "Tiers"),
      ui.list,
      ui.pop,
    ]),
    details(),
  );
  tierRows();
  icons();
  wireList();
  tableRows();
  // the measurement and the view live in the address (#card-tiers/random, #card-tiers/details, #card-tiers/random-details)
  const start = (location.hash.split("/")[0] === "#card-tiers" && location.hash.split("/")[1]) || "";
  setAxis(/random/.test(start) ? "r" : "c", false);
  if (/details/.test(start)) setView("details", false, true);
  sizeRows();
  if ("ResizeObserver" in window) {
    let raf = 0;
    new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(sizeRows); }).observe(ui.list);
  }
  if (document.fonts) document.fonts.ready.then(sizeRows);
}

// the caveats: open on a desktop, folded under a one-line summary on a phone; the choice is remembered in the browser
function caveat() {
  const f = T.facts;
  const ex = f.examples.map((e) => ({ c: DB.byId.get(e.id), a: e.competitive_rank, b: e.random_rank })).filter((e) => e.c);
  ui.exSpans = ex.map((e) => h("span", [chip(e.c), ` is ${ordinal(e.a)} there, ${ordinal(e.b)} in random decks`]));
  const exList = [];
  ui.exSpans.forEach((s, k) => { if (k) exList.push("; "); exList.push(s); });
  const body = h("div", { id: "ct-cav-body" }, h("div.collapse-in", h("ul.ct-cav-list", [
    h("li", [h("b", "Two separate measurements, never blended."), ` Competitive decks: what a card adds to the decks the lab’s searches built (${fmtInt(f.competitive_games)} games, basic AI, no talents, patch ${T.patch}). Random decks: an interim sample of a study still running, about ${fmtInt(f.random_games)} games between ${fmtInt(f.random_decks)} random decks.`]),
    h("li", [h("b", "Synergy cards top the competitive list and sink alone."), " ", ...exList, `. Only ${Math.round(f.same_tier_share * 100)}% of cards get the same tier on both (rank correlation ${f.spearman.toFixed(2)}; ${f.spearman_most_used.toFixed(2)} among the ${f.most_used_cards} cards the searches used most).`]),
    h("li", [h("b", "Tiers are fragile."), ` ${f.straddling} of ${f.measured} cards have an interval crossing a tier border, so most cards could sit one tier up or down. The decks were played by the basic AI, without talents.`]),
  ])));
  const btn = h("button.btn.ghost.disc.ct-cav-btn", { type: "button", "aria-controls": "ct-cav-body" }, [h("span", "Hide"), icon("chevron")]);
  const lead = h("p.ct-cav-lead", "Two separate measurements, never blended. Most cards could sit one tier up or down.");
  const panel = h("section.panel.ct-cav", { "aria-labelledby": "ct-cav-h" }, [
    h("div.ct-cav-top", [h("h2#ct-cav-h", "What these tiers measure"), btn]), lead, body,
  ]);
  let pref = null;
  try { pref = localStorage.getItem("spam-meta:card-tiers-caveat:v1"); } catch (e) { /* storage blocked: the default applies */ }
  const open = pref ? pref === "open" : !matchMedia("(max-width: 759px)").matches;
  if (!open) body.style.transition = "none";            // folded from the first frame, not animated on load
  let ready = false;
  disclosure(btn, body, { open, onToggle: (v) => {
    btn.firstChild.textContent = v ? "Hide" : "More";
    panel.classList.toggle("folded", !v);
    if (ready) { try { localStorage.setItem("spam-meta:card-tiers-caveat:v1", v ? "open" : "folded"); } catch (e) { /* not kept */ } }
  } });
  ready = true;
  requestAnimationFrame(() => requestAnimationFrame(() => { body.style.transition = ""; }));
  return panel;
}

function toolbar() {
  ui.axisBtns = ["c", "r"].map((a) => h("button", { type: "button", "data-axis": a, "aria-pressed": String(a === "c"), onclick: () => setAxis(a, true) }, AX[a]));
  ui.fbtn = h("button.btn.ghost.disc.ct-fbtn", { type: "button", "aria-controls": "ct-filters", title: "Find a card, or filter by rarity or element" },
    [h("span", "Find and filter"), h("span.tab-n.ct-fn", { hidden: true }), icon("chevron")]);
  ui.tabs = [["list", "Tiers"], ["details", "Details"]].map(([v, label]) => h("button", {
    type: "button", role: "tab", id: "ct-tab-" + v, "aria-controls": "ct-view-" + v, "aria-selected": String(v === "list"), tabindex: v === "list" ? null : "-1",
    onclick: () => setView(v),
    onkeydown: (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); setView(S.view === "list" ? "details" : "list", true); } },
  }, label));
  return h("div.ct-bar", [
    h("div.seg.ct-seg", { role: "group", "aria-label": "Measurement" }, ui.axisBtns),
    h("div.ct-bar-r", [ui.fbtn, h("div.seg.ct-seg.ct-tabs", { role: "tablist", "aria-label": "View" }, ui.tabs)]),
  ]);
}

function filtersRegion() {
  const toggle = (set, v) => { if (set.has(v)) set.delete(v); else set.add(v); applyFilters(); };
  ui.raChips = RARITIES.map(([id, label]) => Object.assign(filterChip(label, "sp-gem-" + id, () => toggle(S.ra, id)), { id, label }));
  ui.elChips = ELEMENTS.map(([id, label]) => Object.assign(filterChip(label, "sp-el-" + id, () => toggle(S.el, id)), { id, label }));
  ui.q = h("input", { type: "search", id: "ct-q", name: "card-search", autocomplete: "off", spellcheck: "false", placeholder: "Find a card, in French or English",
    oninput: () => { S.q = norm(ui.q.value.trim()); qClear.hidden = !ui.q.value; applyFilters(); } });
  const qClear = h("button.field-clear", { type: "button", "aria-label": "Clear the search", hidden: true, onclick: () => { ui.q.value = ""; S.q = ""; qClear.hidden = true; applyFilters(); ui.q.focus(); } }, icon("close", 16));
  ui.qClear = qClear;
  ui.fcount = h("p.ct-fcount", { "aria-live": "polite" });
  ui.clear = h("button.btn.ghost.ct-clear", { type: "button", disabled: true, title: "No filter is on", onclick: clearAll }, "Clear filters");
  // a display option, not a filter: Clear filters leaves it as it is
  const rings = h("button.chip.ct-rings-btn", { type: "button", "aria-pressed": "false", title: "Also mark the cards whose tier differs only within noise",
    onclick: () => { S.rings = !S.rings; rings.setAttribute("aria-pressed", String(S.rings)); root.classList.toggle("ct-rings", S.rings); } },
    [h("i.ct-ring-ic", { "aria-hidden": "true" }), h("span.chip-l", "Within noise too")]);
  const region = h("div", { id: "ct-filters" }, h("div.collapse-in", h("div.ct-filters", { role: "group", "aria-label": "Filters" }, [
    h("label.field.ct-q", [icon("search"), h("span.sr", "Find a card"), ui.q, qClear]),
    h("div.ct-fgroup", { role: "group", "aria-label": "Rarity" }, [h("span.ct-fgroup-l", { "aria-hidden": "true" }, "Rarity"), ...ui.raChips.map((c) => c.el)]),
    h("div.ct-fgroup", { role: "group", "aria-label": "Element" }, [h("span.ct-fgroup-l", { "aria-hidden": "true" }, "Element"), ...ui.elChips.map((c) => c.el)]),
    h("div.ct-fgroup", { role: "group", "aria-label": "Dots" }, [h("span.ct-fgroup-l", { "aria-hidden": "true" }, "Dots"), rings]),
    h("div.ct-fstatus", [ui.fcount, ui.clear]),
  ])));
  disclosure(ui.fbtn, region, { open: false });
  return region;
}

const HINT = " Hover, focus or tap a card for its numbers; arrow keys move between cards.";

/** "A dot: the card's tier differs in <other> decks, beyond noise." The ring part shows only while the rings are on. */
function legend(other) {
  return [" A dot ", h("span.ct-legend", h("i", { "aria-hidden": "true" })), `: the card’s tier differs in ${other} decks, beyond noise`,
    h("span.ct-ring-only", ["; a ring ", h("span.ct-legend", h("i.ring", { "aria-hidden": "true" })), ": a different tier, within noise"]), "."];
}

function axisNotes(f) {
  ui.notes.c = h("p", { "data-note": "c" }, [`Basic AI, no talents, patch ${T.patch}.`,
    h("span.ct-list-only", [" Ordered by score inside each tier.", ...legend("random"), HINT])]);
  ui.notes.r = h("p", { "data-note": "r", "aria-hidden": "true" }, [`Interim sample of a study still running, about ${fmtInt(f.random_games)} games.`,
    T.random_intervals ? " Intervals: deck bootstrap of the sample." : " No intervals for this sample: scores and tiers only.",
    h("span.ct-list-only", [...legend("competitive"), HINT])]);
  return h("div.ct-notes", [ui.notes.c, ui.notes.r]);
}

// ---------------------------------------------------------------- tier rows and card icons
function tierRows() {
  ui.rows = {};
  ui.rowN = {};
  ui.list.replaceChildren(...TIERS.map((t) => {
    const nm = t === "nm";
    const id = "ct-t-" + TC[t];
    ui.rowN[t] = h("span.ct-tl-n");
    const cards = h("div.ct-cards", h("p.ct-empty", nm ? "Every card has a score in this measurement." : "No card in this tier."));
    ui.rows[t] = cards;
    return h("div.ct-row", { role: "group", "aria-labelledby": id }, [
      h("div.ct-tl.tc-" + TC[t], { id }, h("div.ct-tl-in", [nm ? h("span.ct-tl-word", "Not measured") : h("span.ct-tl-k", [h("span.sr", "Tier "), t]), ui.rowN[t]])),
      cards,
    ]);
  }));
}

function icons() {
  for (const x of rows) {
    x.ic = h("button.ct-ic", { type: "button", "data-i": x.i, "aria-expanded": "false", "aria-controls": "ct-pop", tabindex: "-1" }, [
      h("img", { class: "ct-ic-art", loading: "lazy", decoding: "async", alt: "", width: 112, height: 160, src: thumb(x.c) }),
      h("i.ct-ic-orb.sp-el-" + x.c.element, { "aria-hidden": "true" }),
      h("i.ct-ic-dot", { "aria-hidden": "true" }),
    ]);
  }
  ui.order = {};
  for (const a of ["c", "r"]) {
    const by = Object.fromEntries(TIERS.map((t) => [t, []]));
    rows.forEach((x) => by[tierOf(x, a)].push(x));
    TIERS.forEach((t) => by[t].sort((p, q) => (q.ax[a] ? q.ax[a].score : -9) - (p.ax[a] ? p.ax[a].score : -9)));
    ui.order[a] = by;
  }
}

function label(x, a) {
  const t = (k) => (x.ax[k] ? "tier " + x.ax[k].tier : "not measured");
  const o = other(a);
  const gap = x.ag === "noise" ? " (the gap may be noise)" : "";
  return `${cardName(x.c)}: ${t(a)} in ${AX[a].toLowerCase()}, ${t(o)} in ${AX[o].toLowerCase()}${gap}` + (x.dim ? " (filtered out)" : "");
}

function place(a) {
  const by = ui.order[a];
  for (const t of TIERS) {
    const row = ui.rows[t], empty = row.querySelector(".ct-empty");
    by[t].forEach((x) => row.insertBefore(x.ic, empty));
    row.classList.toggle("is-empty", by[t].length === 0);
    ui.rowN[t].textContent = plural(by[t].length, "card");
  }
  for (const x of rows) {
    x.ic.classList.toggle("diff", tierOf(x, other(a)) !== tierOf(x, a));
    x.ic.classList.toggle("noise", x.ag === "noise");
    x.ic.setAttribute("aria-label", label(x, a));
  }
  rove(roving && roving.isConnected ? roving : ui.list.querySelector(".ct-ic"));
}

// rows keep the height the larger of the two lists needs, so switching the measurement never moves the page
function sizeRows() {
  const any = rows[0] && rows[0].ic;
  if (!any || !any.offsetWidth) return;
  const w = any.offsetWidth, ht = any.offsetHeight;
  for (const t of TIERS) {
    const row = ui.rows[t], cs = getComputedStyle(row);
    const gap = parseFloat(cs.columnGap) || 0, rgap = parseFloat(cs.rowGap) || 0;
    const inner = row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const per = Math.max(1, Math.floor((inner + gap) / (w + gap)));
    const lines = Math.max(1, Math.ceil(Math.max(ui.order.c[t].length, ui.order.r[t].length) / per));
    row.style.minHeight = (lines * ht + (lines - 1) * rgap + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)) + "px";
  }
}

// one card of the list is in the tab order; arrow keys move between cards (left/right in order, up/down by line)
let roving = null;
function rove(b) {
  if (roving) roving.tabIndex = -1;
  roving = b;
  if (b) b.tabIndex = 0;
}
function step(b, key) {
  const all = $$(".ct-ic", ui.list), i = all.indexOf(b);
  if (key === "ArrowRight") return all[i + 1];
  if (key === "ArrowLeft") return all[i - 1];
  if (key === "Home") return all[0];
  if (key === "End") return all[all.length - 1];
  const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, down = key === "ArrowDown";
  const rects = all.map((x) => x.getBoundingClientRect());
  const line = rects.map((x) => x.top).filter((t) => (down ? t > r.top + 4 : t < r.top - 4));
  if (!line.length) return null;
  const target = down ? Math.min(...line) : Math.max(...line);
  let best = null, dist = Infinity;
  all.forEach((x, k) => {
    if (Math.abs(rects[k].top - target) > 4) return;
    const d = Math.abs(rects[k].left + rects[k].width / 2 - cx);
    if (d < dist) { dist = d; best = x; }
  });
  return best;
}

function setAxis(a, animate) {
  if (a === S.axis && animate) return;
  const keep = pinned ? cur : null;            // a pinned card follows its icon to the other list
  hidePop(true);
  const play = animate && !reducedMotion() && S.view === "list";
  const first = new Map();
  if (play) rows.forEach((x) => first.set(x.ic, x.ic.getBoundingClientRect()));
  S.axis = a;
  place(a);
  ui.axisBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.axis === a)));
  for (const k of ["c", "r"]) ui.notes[k].setAttribute("aria-hidden", String(k !== a));
  $$("th[data-ax]", root).forEach((th) => th.classList.toggle("on", th.dataset.ax === a));
  if (play) {
    const vh = innerHeight;
    for (const x of rows) {
      const f = first.get(x.ic), l = x.ic.getBoundingClientRect();
      const dx = f.left - l.left, dy = f.top - l.top;
      if (!dx && !dy) continue;
      if ((f.bottom < -200 || f.top > vh + 200) && (l.bottom < -200 || l.top > vh + 200)) continue;   // off screen both ways
      x.ic.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 280, easing: "cubic-bezier(.4, 0, .2, 1)" });
    }
  }
  renderTable();
  applyFilters();
  if (animate) { say(`Showing the card tiers from ${AX[a].toLowerCase()}.`); saveState(); }
  if (keep && S.view === "list") setTimeout(() => showPop(keep, true), play ? 300 : 0);
}
const say = (t) => { ui.announce.textContent = t; };

/** Keeps the measurement and the view in the address without a history entry, only while this tab is shown. A card key
 * never collides with these words, so main.js still reads the tab and ignores the rest. */
function saveState() {
  if (location.hash.split("/")[0] !== "#card-tiers") return;
  const parts = [S.axis === "r" ? "random" : "", S.view === "details" ? "details" : ""].filter(Boolean).join("-");
  const next = "#card-tiers" + (parts ? "/" + parts : "");
  if (location.hash !== next) { try { history.replaceState(history.state, "", next); } catch (e) { /* the address stays as it is */ } }
}

// ---------------------------------------------------------------- filters: dim on the tier rows, hide in the table
const found = (x) => !S.q || norm(x.c.name_fr).includes(S.q) || norm(x.c.name_en).includes(S.q);
const matches = (x) => found(x) && (!S.ra.size || S.ra.has(x.c.rarity)) && (!S.el.size || S.el.has(x.c.element));
const matchesTier = (x) => !S.tier.size || S.tier.has(tierOf(x, S.axis));

function applyFilters() {
  const on_ = !!S.q || S.ra.size + S.el.size + (S.view === "details" ? S.tier.size : 0) > 0;
  let shown = 0;
  for (const x of rows) {
    const ok = matches(x);
    if (!!x.dim === ok) { x.dim = !ok; x.ic.classList.toggle("dim", !ok); x.ic.setAttribute("aria-label", label(x, S.axis)); }
    const okT = ok && matchesTier(x);
    x.tr.hidden = !okT;
    if (S.view === "list" ? ok : okT) shown++;
  }
  const total = rows.length;
  ui.fcount.textContent = !on_ ? `${total} cards` : shown === 0
    ? (S.view === "list" ? "No card matches these filters: every card is dimmed." : `0 of ${total} cards match.`)
    : `${shown} of ${total} cards match` + (S.view === "list" ? "; the others are dimmed." : ".");
  // each rarity or element chip counts the cards it would show with the other group's filter on
  for (const c of ui.raChips) setChip(c, rows.filter((x) => found(x) && x.c.rarity === c.id && (!S.el.size || S.el.has(x.c.element))).length, S.ra.has(c.id), `Show ${c.label} cards`, "No card with this and the other filter on");
  for (const c of ui.elChips) setChip(c, rows.filter((x) => found(x) && x.c.element === c.id && (!S.ra.size || S.ra.has(x.c.rarity))).length, S.el.has(c.id), `Show ${c.label} cards`, "No card with this and the other filter on");
  const counts = {};
  rows.forEach((x) => { if (matches(x)) { const t = tierOf(x, S.axis); counts[t] = (counts[t] || 0) + 1; } });
  for (const c of ui.tierChips) setChip(c, counts[c.id] || 0, S.tier.has(c.id), `Show the cards of ${c.label}`, "No card in this tier with the filters on");
  const nOn = S.ra.size + S.el.size + (S.q ? 1 : 0);
  const fn = ui.fbtn.querySelector(".ct-fn");
  fn.hidden = nOn === 0;
  fn.textContent = String(nOn);
  ui.fbtn.title = nOn ? `${plural(nOn, "filter")} on` : "Find a card, or filter by rarity or element";
  // row counts follow the filters: "2 of 7 cards" while some cards of the row are dimmed
  for (const t of TIERS) {
    const all = ui.order[S.axis][t], k = all.filter(matches).length;
    ui.rowN[t].textContent = k === all.length ? plural(all.length, "card") : `${k} of ${plural(all.length, "card")}`;
  }
  ui.clear.disabled = !on_;
  ui.clear.title = on_ ? "Turn every filter off" : "No filter is on";
  ui.dtEmpty.hidden = !(S.view === "details" && shown === 0);
}

function clearAll() {
  S.ra.clear(); S.el.clear(); S.tier.clear();
  S.q = ""; ui.q.value = ""; ui.qClear.hidden = true;
  applyFilters();
}

// ---------------------------------------------------------------- the card numbers (hover, focus, tap)
let cur = null, pinned = false, hoverT = 0, restoring = false;
const sheet = matchMedia("(max-width: 759px)");

function verdict(x) {
  if (!x.ax.c) return "Not measured in competitive decks: no deck of the searches holds it.";
  if (x.ag === "same") return [h("b", "Same tier"), " on both measurements."];
  if (x.ag === "noise") return [h("b", "Different tiers"), ", but the two intervals overlap: the gap may be noise."];
  if (x.ag === "apart") return [h("b", "The measurements disagree:"), " different tiers and intervals that do not overlap."];
  return [h("b", "Different tiers"), " (no interval for the random sample)."];
}

const tchip = (t) => h("span.ct-tchip.tc-" + TC[t], t);

function popContent(x, full) {
  const c = x.c, p = presOf(x);
  const cell = (a, fmt) => h("td", { class: a === S.axis ? "on" : null }, x.ax[a] ? fmt(x.ax[a]) : "—");
  const facts = [
    ["Tier", (v) => tchip(v.tier)],
    ["Score", (v) => sgn(v.score)],
    ["95% interval", (v) => (v.ci_low == null ? "no interval" : `${sgn(v.ci_low)} to ${sgn(v.ci_high)}`)],
    ["Confidence", (v) => (v.confidence == null ? "—" : `${Math.round(v.confidence * 100)}% in this tier`)],
    ["Rank", (v) => (v.rank ? `${v.rank} of ${T.measured}` : "not compared")],
    ["Games", (v) => (v.games == null ? "—" : fmtInt(v.games))],
  ];
  const brief = facts.filter(([k]) => k === "Tier" || k === "Score");
  const best = p.bt ? `#${p.bt} on the Deck tier list` : p.br ? `#${fmtInt(p.br)} of ${fmtInt(N.listed)} listed decks (${LEVEL[p.bl] || p.bl})` : "none";
  const pres = [
    ["In the top 10", `${p.t10} of ${N.top10} decks`],
    ["In the top 30", `${p.t30} of ${N.top30} decks`],
    ["Listed decks", `${fmtInt(p.all)} of ${fmtInt(N.listed)}`],
    ["Best deck", best],
    ["Their win rate", p.t30 ? `${pc1(p.vg)} vs good decks, ${pc1(p.vt)} vs top 10 (${plural(p.t30, "deck")})` : "in no top-30 deck"],
  ];
  return [
    h("div.ct-pop-h", [
      h("img.ct-pop-art", { alt: "", width: 48, height: 69, src: thumb(c) }),
      h("div", [
        h("div.ct-pop-name", { lang: getLang(), translate: "no" }, cardName(c)),
        otherName(c) !== cardName(c) ? h("div.ct-pop-sub", { translate: "no" }, otherName(c)) : null,
        h("div.ct-pop-sub", `${RARITY_NAME[c.rarity]}, ${ELEMENT_NAME[c.element]}`),
      ]),
    ]),
    h("table.ct-pop-t", [
      h("thead", h("tr", [h("th", { scope: "col" }, h("span.sr", "Measure")),
        h("th", { scope: "col", class: S.axis === "c" ? "on" : null }, "Competitive"), h("th", { scope: "col", class: S.axis === "r" ? "on" : null }, "Random")])),
      h("tbody", (full ? facts : brief).map(([k, f]) => h("tr", [h("th", { scope: "row" }, k), cell("c", f), cell("r", f)]))),
    ]),
    h("p.ct-pop-v", verdict(x)),
    full ? h("table.ct-pop-t.ct-pop-p", [h("caption.sr", "Presence in the decks the site lists"),
      h("tbody", pres.map(([k, v]) => h("tr", [h("th", { scope: "row" }, k), h("td.on", v)])))]) : h("p.ct-pop-more", "Click it, or press Enter, for every number and the decks that play it."),
  ];
}

function showPop(b, pin) {
  const x = rows[+b.dataset.i];
  if (cur && cur !== b) cur.setAttribute("aria-expanded", "false");
  cur = b;
  pinned = !!pin;
  const pop = ui.pop;
  const kids = popContent(x, pinned);
  if (pinned) {
    // the card dialog opens from the delegated [data-card] click; focus moves back to the icon first, so closing the dialog
    // returns there (the popover is hidden by then)
    kids.push(h("div.ct-pop-act", h("button.btn.ct-pop-open", { type: "button", "data-card": x.c.key, onclick: () => { const k = cur; hidePop(true); refocus(k); } }, ["Show the card", icon("arrow")])));
    kids.push(h("button.close.ct-pop-x", { type: "button", "aria-label": "Close the numbers", title: "Close", onclick: () => { const k = cur; hidePop(true); refocus(k); } }, icon("close", 16)));
  }
  pop.replaceChildren(...kids);
  pop.classList.toggle("pinned", pinned);
  // a pinned card is a small non-modal dialog; a hover or focus preview repeats the icon's label, so it is hidden from readers
  if (pinned) { pop.removeAttribute("aria-hidden"); pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", cardName(x.c)); }
  else { pop.setAttribute("aria-hidden", "true"); pop.removeAttribute("role"); pop.removeAttribute("aria-label"); }
  b.setAttribute("aria-expanded", "true");
  if (pinned) say(summary(x));
  if (sheet.matches) { pop.style.left = pop.style.top = ""; pop.classList.add("on"); return; }     // a bottom sheet on a phone, placed by the stylesheet
  const r = b.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  const vw = document.documentElement.clientWidth, m = 16;
  let left = Math.max(m, Math.min(r.left + r.width / 2 - pw / 2, vw - pw - m));
  // below the card, else above it, else as low as it fits under the header (it scrolls inside when taller than the window)
  const head = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--chrome-h")) || 64;
  let top = r.bottom + 12, oy = "0";
  if (top + ph > innerHeight - m) {
    if (r.top - 12 - ph > head + m) { top = r.top - 12 - ph; oy = "100%"; }
    else top = Math.max(head + m, innerHeight - m - ph);
  }
  pop.style.left = left + scrollX + "px";
  pop.style.top = top + scrollY + "px";
  pop.style.setProperty("--ox", (r.left + r.width / 2 - left) + "px");
  pop.style.setProperty("--oy", oy);
  pop.classList.add("on");
}

function summary(x) {
  const t = (a) => (x.ax[a] ? `tier ${x.ax[a].tier}, score ${sgn(x.ax[a].score)}` : "not measured");
  const v = { same: "Same tier.", noise: "Different tiers, within noise.", apart: "The measurements disagree." }[x.ag] || "";
  return `${cardName(x.c)}. Competitive decks: ${t("c")}. Random decks: ${t("r")}. ${v}`;
}

function hidePop(force) {
  if (!ui.pop || (pinned && !force)) return;
  pinned = false;
  ui.pop.classList.remove("on", "pinned");
  ui.pop.setAttribute("aria-hidden", "true");
  if (cur) cur.setAttribute("aria-expanded", "false");
  cur = null;
}
function refocus(b) { if (!b) return; restoring = true; b.focus(); restoring = false; }

function wireList() {
  const list = ui.list;
  // hover intent: a card opens after 120 ms under the pointer, at once when another card is already open
  list.addEventListener("pointerover", (e) => {
    const b = e.target.closest(".ct-ic");
    if (!b || e.pointerType !== "mouse" || pinned || sheet.matches) return;
    clearTimeout(hoverT);
    if (cur) showPop(b, false); else hoverT = setTimeout(() => { if (!pinned) showPop(b, false); }, 120);
  });
  list.addEventListener("pointerout", (e) => {
    const b = e.target.closest(".ct-ic");
    if (b && e.pointerType === "mouse" && !b.contains(e.relatedTarget)) { clearTimeout(hoverT); hidePop(false); }
  });
  // focus shows the numbers, except when focus comes back after closing them, and never as a sheet on a phone
  list.addEventListener("focusin", (e) => {
    const b = e.target.closest(".ct-ic");
    if (!b) return;
    if (b !== roving) rove(b);
    if (!pinned && !restoring && !sheet.matches) showPop(b, false);
  });
  list.addEventListener("focusout", (e) => { if (!pinned && !list.contains(e.relatedTarget)) hidePop(false); });
  list.addEventListener("click", (e) => {
    const b = e.target.closest(".ct-ic");
    if (!b) return;
    clearTimeout(hoverT);
    if (pinned && cur === b) hidePop(true); else showPop(b, true);
  });
  list.addEventListener("keydown", (e) => {
    const b = e.target.closest(".ct-ic");
    if (!b || !["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const n = step(b, e.key);
    if (!n) return;
    hidePop(true);
    rove(n);
    n.focus();
  });
  document.addEventListener("pointerdown", (e) => {
    if (pinned && !ui.pop.contains(e.target) && !e.target.closest(".ct-ic")) hidePop(true);
  });
  document.addEventListener("keydown", (e) => {
    // the card dialog handles its own Escape; a pinned card closes only when no dialog is open
    if (e.key === "Escape" && cur && !document.querySelector("dialog[open]")) { const b = cur; hidePop(true); refocus(b); }
  });
  addEventListener("resize", () => { if (!sheet.matches) hidePop(true); });
}

// ---------------------------------------------------------------- details table
function details() {
  ui.tierChips = TIERS.map((t) => {
    const lab = t === "nm" ? "Not measured" : `tier ${t}`;
    const c = filterChip(t === "nm" ? "Not measured" : t, "ct-sw tc-" + TC[t], () => { if (S.tier.has(t)) S.tier.delete(t); else S.tier.add(t); applyFilters(); });
    return Object.assign(c, { id: t, label: lab });
  });
  const sort = h("select", { id: "ct-sort", onchange: (e) => { S.sort = e.target.value; renderTable(); applyFilters(); } }, [
    ["score", "Score, highest first"], ["score-asc", "Score, lowest first"], ["gap", "Gap between the two measurements"],
    ["presence", "Presence in the top 30 decks"], ["winrate", "Win rate of those decks"],
  ].map(([v, t]) => h("option", { value: v }, t)));
  ui.dtEmpty = h("div.ct-dt-empty", { hidden: true }, [h("p", "No card matches these filters."),
    h("button.btn", { type: "button", onclick: () => { clearAll(); ui.clear.focus(); } }, "Clear filters")]);
  const th = (text, title, ax) => h("th", { scope: "col", title, "data-ax": ax || null }, text);
  return h("section.ct-view", { id: "ct-view-details", role: "tabpanel", "aria-labelledby": "ct-tab-details", hidden: true }, [
    h("h2.sr", "Details"),
    h("div.ct-dt-tools", [
      h("div.ct-fgroup", { role: "group", "aria-label": "Tier" }, [h("span.ct-fgroup-l", { "aria-hidden": "true" }, "Tier"), ...ui.tierChips.map((c) => c.el)]),
      h("label.field.select.ct-sort", [h("span.sr", "Sort by"), sort, icon("chevron")]),
    ]),
    h("div.ct-dt", [
      h("table.ct-tab", [
        h("caption.sr", "Every card on both measurements, with its presence in the decks of the Deck tier list"),
        h("colgroup", ["rank", "card", "ax", "ax", "ag", "pr", "wr", "best"].map((k) => h("col.ct-w-" + k))),
        h("thead", h("tr", [
          th("#", "Rank on the measurement chosen above"), th("Card"),
          th("Competitive decks", null, "c"), th("Random decks", null, "r"),
          th("Agreement", "Same tier; different tier but overlapping intervals (within noise); or intervals apart (disagree)"),
          th("In top decks", `Decks of the Deck tier list holding the card: top 10 (${N.top10} decks shown) and top 30 (${N.top30} decks shown)`),
          th("Their win rate", "Average win rate of the top-30 decks holding the card: against good decks (round-robin field) and against the top 10"),
          th("Best deck", "Best rank of a deck holding the card: Deck tier list rank, else its place among the listed decks"),
        ])),
        ui.tbody,
      ]),
      ui.dtEmpty,
    ]),
    h("p.ct-hint", `The score is what a card adds to a deck’s odds compared with an average card: 25 times the score is roughly the win-rate points it adds. Each bar runs over the tier bands, lowest tier on the left; the dot is the card and the line its 95% interval. In top decks: decks of the Deck tier list holding the card (${N.top10} shown in the top 10, ${N.top30} in the top 30). Their win rate: the mean of those decks against good decks (the round-robin field) and against the top 10.`),
  ]);
}

function bands() {
  const e = T.tier_edges_z, z0 = -3, z1 = 3;
  const cuts = [z1, ...e, z0];          // S+ from z1 down to e[0], ... E from e[last] down to z0
  return T.tiers.map((t, k) => [t, cuts[k + 1], cuts[k]]).reverse();
}
let BANDS = null;
const zx = (z) => ((Math.max(-3, Math.min(3, z)) + 3) / 6) * 100;

function bar(v) {
  if (!BANDS) BANDS = bands();
  const kids = BANDS.map(([t, a, b]) => h("i.tc-" + TC[t], { style: { width: ((b - a) / 6) * 100 + "%" } }));
  if (v.z != null) {
    if (v.z_low != null) kids.push(h("span.ct-rb-i", { style: { left: zx(v.z_low) + "%", width: zx(v.z_high) - zx(v.z_low) + "%" } }));
    kids.push(h("span.ct-rb-p", { style: { left: zx(v.z) + "%" } }));
  }
  return h("span.ct-rb", { "aria-hidden": "true" }, kids);
}

function axCell(x, a) {
  const v = x.ax[a];
  if (!v) return h("td.ct-c-" + a, { "data-label": AX[a] }, h("div.ct-ax.off", [h("div.ct-ax-top", h("span.ct-tchip.tc-nm", "Not measured")), h("span.ct-cap", "no deck of the searches holds it")]));
  const iv = v.ci_low == null ? "no interval" : `${sgn(v.ci_low)} to ${sgn(v.ci_high)}`;
  const facts = [v.confidence == null ? null : `${Math.round(v.confidence * 100)}% sure`, v.games == null ? null : `${fmtInt(v.games)} games`].filter(Boolean).join(", ");
  return h("td.ct-c-" + a, { "data-label": AX[a] }, h("div.ct-ax" + (a === S.axis ? "" : ".off"), [
    h("div.ct-ax-top", [tchip(v.tier), h("span.ct-ax-s", sgn(v.score)), h("span.ct-ax-iv", iv)]), bar(v), h("span.ct-cap", facts),
  ]));
}

function rowCells(x) {
  const a = S.axis, rk = x.ax[a] && x.ax[a].rank ? x.ax[a].rank : "—";
  const c = x.c, p = presOf(x);
  const kv = (v, k) => h("span.ct-kv", [h("b", v), " " + k]);
  const pr = [kv(`${p.t10}/${N.top10}`, "top 10"), kv(`${p.t30}/${N.top30}`, "top 30"), h("span.ct-cap", `${fmtInt(p.all)} listed`)];
  const wr = !p.t30 ? h("span.ct-cap", "in no top-30 deck") : [kv(pc1(p.vg), "vs good"), kv(pc1(p.vt), "vs top 10"), h("span.ct-cap", `mean of ${plural(p.t30, "deck")}`)];
  const best = p.bt ? [h("span.ct-fig", `#${p.bt}`), h("span.ct-cap", "Deck tier list")]
    : p.br ? [h("span.ct-fig", `#${fmtInt(p.br)}`), h("span.ct-cap", `listed, ${LEVEL[p.bl] || p.bl}`)] : h("span.ct-cap", "none");
  return [
    h("td.ct-c-rank", h("span.ct-rk", String(rk))),
    h("td.ct-c-card", h("button.ct-cardc", { type: "button", "data-card": c.key, title: `${cardName(c)}: show the card details` }, [
      h("img", { class: "ct-th", loading: "lazy", decoding: "async", alt: "", width: 36, height: 51, src: thumb(c) }),
      h("span", [h("span.ct-nm", { translate: "no" }, [h("span.ct-rkm", `#${rk} `), cardName(c)]), h("span.ct-nm-sub", `${RARITY_NAME[c.rarity]}, ${ELEMENT_NAME[c.element]}`)]),
    ])),
    axCell(x, "c"), axCell(x, "r"),
    h("td.ct-c-ag", { "data-label": "Agreement" }, x.ag ? h("span.ct-ag." + x.ag, AG[x.ag]) : h("span.ct-cap", "no comparison")),
    h("td.ct-c-pr", { "data-label": "In top decks" }, pr),
    h("td.ct-c-wr", { "data-label": "Their win rate" }, wr),
    h("td.ct-c-best", { "data-label": "Best deck" }, best),
  ];
}

function tableRows() { for (const x of rows) { x.tr = h("tr"); ui.tbody.append(x.tr); } }

function sortKey(x) {
  const a = S.axis, v = x.ax[a], p = presOf(x);
  switch (S.sort) {
    case "score": return v ? -v.score : 99;
    case "score-asc": return v ? v.score : 99;
    case "gap": return x.ax.c && x.ax.r && x.ax.c.z != null && x.ax.r.z != null ? -Math.abs(x.ax.c.z - x.ax.r.z) : 99;
    case "presence": return -(p.t30 * 1e6 + p.t10 * 1e3 + p.all / 10);
    case "winrate": return p.vg != null ? -p.vg : 99;
  }
  return 0;
}

function renderTable() {
  const sc = (x) => (x.ax[S.axis] ? x.ax[S.axis].score : -9);
  const list = rows.slice().sort((p, q) => sortKey(p) - sortKey(q) || sc(q) - sc(p));
  for (const x of list) { x.tr.replaceChildren(...rowCells(x)); ui.tbody.append(x.tr); }
}

// ---------------------------------------------------------------- views
function setView(v, focus, init) {
  if (v === S.view) return;
  hidePop(true);
  S.view = v;
  root.classList.toggle("ct-v-details", v === "details");
  ui.tabs.forEach((t) => {
    const on_ = t.id === "ct-tab-" + v;
    t.setAttribute("aria-selected", String(on_));
    t.tabIndex = on_ ? 0 : -1;
    if (on_ && focus) t.focus();
  });
  const show = $("#ct-view-" + v, root);
  $("#ct-view-list", root).hidden = v !== "list";
  $("#ct-view-details", root).hidden = v !== "details";
  if (!reducedMotion() && !init) show.animate([{ opacity: 0, transform: "translateY(24px)" }, { opacity: 1, transform: "none" }], { duration: 280, easing: "cubic-bezier(.4, 0, .2, 1)" });
  if (v === "list") sizeRows();
  applyFilters();
  if (init) return;
  say(v === "list" ? "Tiers view." : "Details view: every card on both measurements.");
  saveState();
}

// ---------------------------------------------------------------- card-name language
function relabel() {
  for (const x of rows) x.ic.setAttribute("aria-label", label(x, S.axis));
  const ex = T.facts.examples;
  ui.exSpans.forEach((s, k) => { const e = ex[k]; s.replaceChildren(chip(DB.byId.get(e.id)), ` is ${ordinal(e.competitive_rank)} there, ${ordinal(e.random_rank)} in random decks`); });
  renderTable();
  applyFilters();
  if (cur) showPop(cur, pinned);
}
