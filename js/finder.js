// Deck builder (#builder, its own tab next to My decks): the visitor picks 1 to 4 cards they want to play and the
// page lists the measured decks (decks.json) that hold all of them, best first by the canonical rank (rows are already
// sorted by it). When no measured deck holds every pick, one line says so and the decks holding the most of them follow,
// labelled "3 of your 4 cards". Only decks.json rows are read: the withheld and hidden decks have none, so they can never
// be proposed, and a pick that matches nothing gets the same generic line whatever the reason.
// The picks live in memory only (the address holds a tab and, while a card dialog is open, a card key; SPEC.md); the card
// dialog's "Decks with this card" sets them through pick().

import { h, icon, fmtInt } from "./util.js?v=5a5eaa4fb2";
import { DB, loadDecks, loadTier } from "./data.js?v=5a5eaa4fb2";
import { on, isOwned, ownedCount } from "./store.js?v=5a5eaa4fb2";
import { cardName, chip } from "./cards.js?v=5a5eaa4fb2";
import { t } from "./i18n.js?v=5a5eaa4fb2";
import { introLine } from "./patch.js?v=5a5eaa4fb2";
import { searchField, announcer, terms, namedCards } from "./search.js?v=5a5eaa4fb2";
import { deckRow, paged, legend, paintOwned } from "./decklist.js?v=5a5eaa4fb2";

const MAX = 4;           // four picks are a whole deck
const PAGE = 10;         // results shown, then ten more on request
const SUGGEST = 4;       // cards offered under the field (one row on a desktop, two by two on a phone)
const OFTEN_FROM = 40;   // "Often with" counts the cards of the best results only

let root, D, popular = [];
let picks = [], query = "", mineOnly = false;
const legendState = { open: false };
let field, sugEl, slotsEl, resEl, voice;

export async function mount(el) {
  root = el;
  D = await loadDecks();
  try { await loadTier(); } catch (e) { /* tier tags and the popular cards fall back to decks.json */ }
  popular = popularCards();
  render();
  on("owned", () => paintResults());
  on("lang", () => render());
}

/** Start over with these cards picked (the card dialog's "Decks with this card"). */
export function pick(keys) {
  picks = keys.map((k) => DB.byKey.get(k)).filter(Boolean).slice(0, MAX);
  query = "";
  if (root) render();
}

// ---------------------------------------------------------------- which cards to offer
/** The cards the Deck tier list plays most (then by their best rank); decks.json's best rows if it did not load. */
function popularCards() {
  const count = new Map();
  const decks = DB.tier ? DB.tier.decks.filter((d) => Array.isArray(d.cards)).map((d) => d.cards.map((id) => DB.byId.get(id)))
    : D.rows.slice(0, 30).map((r) => r.cards);
  decks.forEach((cs) => cs.forEach((c) => { if (c) count.set(c, (count.get(c) || 0) + 1); }));
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);   // stable: ties keep their first (best) rank
}

/** The cards that most often complete the best decks holding every pick. */
function oftenWith(rows) {
  const count = new Map();
  rows.slice(0, OFTEN_FROM).forEach((r) => r.cards.forEach((c) => { if (!picks.includes(c)) count.set(c, (count.get(c) || 0) + 1); }));
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

// ---------------------------------------------------------------- matching
/** The rows holding every pick (`full`), else the rows holding the most of them, most first (`near`). */
function match() {
  if (!picks.length) return null;
  const full = D.rows.filter((r) => picks.every((p) => r.cards.includes(p)));
  if (full.length || picks.length === 1) return { full, near: [] };
  const near = [];
  for (const r of D.rows) {
    const k = picks.filter((p) => r.cards.includes(p)).length;
    if (k) near.push({ r, k });
  }
  near.sort((a, b) => b.k - a.k);          // stable: inside one count the rank order stays
  return { full, near };
}

// ---------------------------------------------------------------- page
function render() {
  field = searchField({ id: "fd-q", name: "card", placeholder: t("fd.ph"), label: t("fd.aria"), clearLabel: t("cx.clearSearch"), value: query,
    onChange: (v) => { query = v; paintSuggest(); },
    onEnter: () => { const first = sugEl.querySelector(".fd-add"); if (first && query.trim()) first.click(); } });
  sugEl = h("p.fd-sug");
  slotsEl = h("ul.fd-slots", { "aria-label": t("fd.picks") });
  resEl = h("div.fd-res");
  voice = announcer();
  root.replaceChildren(
    h("div.vhead", [h("h1", t("fd.h1")), ...introLine("builder", h("p.lede", t("fd.lede")))]),
    h("div.fd-pick", [h("div.fd-field", field.el), sugEl, slotsEl, voice.el]),
    resEl,
  );
  paintPicks();
}

/** Everything that follows the picks: the field's state, the four slots, the suggestions, the results. */
function paintPicks() {
  const full = picks.length >= MAX;
  field.input.disabled = full;
  field.input.placeholder = t(full ? "fd.phFull" : "fd.ph");
  field.el.classList.toggle("off", full);
  field.el.title = full ? t("fd.fullTitle") : "";
  slotsEl.replaceChildren(...Array.from({ length: MAX }, (_, i) => slot(picks[i], i === picks.length)));
  paintSuggest();
  paintResults();
}

function add(c) {
  if (picks.length >= MAX || picks.includes(c)) return;
  picks = [...picks, c];
  query = "";
  field.set("");
  paintPicks();
  if (picks.length < MAX) field.input.focus();
  else { const hd = resEl.querySelector("h2"); if (hd) hd.focus(); }     // a whole deck: the results come into view
}

function remove(c) {
  picks = picks.filter((p) => p !== c);
  paintPicks();
  field.input.focus();
}

/**
 * A pick slot: the card (opens its dialog) and a remove button. The first empty slot is a button that focuses the field; the
 * others only show a plus (one tab stop, not three).
 */
function slot(c, firstEmpty) {
  if (!c) {
    return firstEmpty
      ? h("li.fd-slot", h("button.fd-empty", { type: "button", onclick: () => field.input.focus() }, [icon("plus"), h("span", t("fd.slotEmpty"))]))
      : h("li.fd-slot.idle", icon("plus"));
  }
  const name = cardName(c);
  return h("li.fd-slot.on", [
    h("button.fd-card", { type: "button", "data-card": c.key, title: t("card.show", { name }) }, [
      h("img", { class: "fd-art", loading: "lazy", decoding: "async", alt: "", width: 24, height: 34, src: `assets/thumbs/s/${c.key}.webp` }),
      h("span.fd-name", { translate: "no" }, name),
    ]),
    h("button.fd-x", { type: "button", "aria-label": t("fd.remove", { name }), title: t("fd.remove", { name }), onclick: () => remove(c) }, icon("close")),
  ]);
}

/** The line under the field: the cards matching the query, else the cards that go with the picks, else popular cards. */
function paintSuggest() {
  // at four picks no card can be added: the line drops its reserved suggestion rows (a state change, not a jump while typing)
  sugEl.classList.toggle("full", picks.length >= MAX);
  if (picks.length >= MAX) { sugEl.replaceChildren(h("span.muted", t("fd.fullLine"))); return; }
  const ts = terms(query);
  let label, list;
  if (ts.length) {
    list = namedCards(ts).filter((c) => !picks.includes(c));
    if (!list.length) { sugEl.replaceChildren(h("span", t("find.noCard", { q: query.trim() }))); voice.say(t("find.noCard", { q: query.trim() })); return; }
    label = t("fd.matches", { n: list.length });
    voice.say(label.replace(/\s*:\s*$/, "") + ": " + list.slice(0, SUGGEST).map(cardName).join(", "));
  } else {
    const m = match();
    const often = m && m.full.length ? oftenWith(m.full) : [];
    label = t(often.length ? "fd.often" : "fd.popular");
    list = (often.length ? often : popular).filter((c) => !picks.includes(c));
  }
  const shown = list.slice(0, SUGGEST);     // the label counts the matches; typing more letters narrows them
  sugEl.replaceChildren(...[
    h("span.fd-sug-l", label),
    ...shown.map((c) => h("button.chip.fd-add", { type: "button", title: t("fd.add", { name: cardName(c) }), onclick: () => add(c) }, [
      h("img", { class: "cc-art", loading: "lazy", decoding: "async", alt: "", width: 18, height: 24, src: `assets/thumbs/s/${c.key}.webp` }),
      h("span.chip-l", { translate: "no" }, cardName(c)),
      icon("plus"),
    ])),
  ]);
}

// ---------------------------------------------------------------- results
function paintResults() {
  const m = match();
  if (!m) { resEl.replaceChildren(); return; }
  const owned = ownedCount() > 0;
  if (!owned) mineOnly = false;
  const mine = (r) => r.cards.every((c) => isOwned(c.key));
  const rows = m.full.length ? m.full : m.near.map((x) => x.r);
  const ready = owned ? rows.filter(mine).length : 0;
  const order = (r) => [...picks.filter((p) => r.cards.includes(p)), ...r.cards.filter((c) => !picks.includes(c))];   // a deck is a set: the picks first

  const mineBtn = owned ? h("button.chip.ready", { type: "button", "aria-pressed": String(mineOnly), disabled: !ready && !mineOnly,
    title: t(ready ? "tl.readyOn" : "fd.mineOff"), onclick: () => { mineOnly = !mineOnly; paintResults(); } },
  [h("span.chip-l", t("tl.ready")), h("span.n", fmtInt(ready))]) : null;

  const parts = [];
  let items, mk, head;
  if (m.full.length) {
    items = m.full.filter((r) => !mineOnly || mine(r));
    head = t("fd.resH", { n: items.length });
    mk = (r, i) => deckRow(r, `#${i + 1}`, { cards: order(r), badge: badge(r) });
  } else {
    parts.push(h("p.fd-none", t("fd.none", { n: picks.length })));
    items = m.near.filter((x) => !mineOnly || mine(x.r));
    head = m.near.length ? t("fd.closeH") : null;
    mk = (x, i) => deckRow(x.r, `#${i + 1}`, {
      cards: order(x.r),
      tag: h("span.tag", t("fd.has", { k: x.k, n: picks.length })),
      note: h("p.dr-miss", [h("span.muted", t("fd.without") + " "), ...picks.filter((p) => !x.r.cards.includes(p)).map(chip)]),
      badge: badge(x.r),
    });
  }
  if (head) {
    parts.push(h("div.fd-head", [h("h2#fd-res-h", { tabindex: "-1" }, head), mineBtn]));
    parts.push(legend("fd-legend", legendState));
    parts.push(items.length ? paged(items, mk, PAGE) : h("p.fd-none", t("fd.mineNone")));
  }
  resEl.replaceChildren(...parts);
  voice.say(m.full.length ? head : t("fd.none", { n: picks.length }));
}

function badge(r) {
  if (!ownedCount()) return null;
  const el = h("div.obadge");
  paintOwned(el, r.cards);
  return el;
}
