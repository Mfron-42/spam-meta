// Deck builder (#builder, its own tab next to My decks): the visitor picks 1 to 4 cards they want to play and the
// page lists the measured decks (the current ranking's deck table, deck-table.json) that hold all of them: the decks of the full
// AI's scale first, by their rating, then, apart, the decks only the fast AI looked at (decklist.js scaleGroups: the two scales
// are never sorted together). When no measured deck holds every pick, one line says so and the decks holding the most of them
// follow, most first inside each scale, each with a "Without:" line. Only the table's rows are read: the decks the privacy rules
// keep off the site have none, so they can never be proposed, and a pick that matches nothing gets the same generic line.
// "Without these cards" (owner, 2026-10-27, for the game's ban mode; search.js outRow) leaves out every deck holding one of the
// cards the visitor names, the order unchanged; with no pick it lists the whole table without them. A card is a pick or left
// out, never both: the last choice wins.
// The picks and the cards left out live in memory only (the address holds a tab and, while a card dialog is open, a card key;
// SPEC.md); the card dialog's "Decks with this card" sets the picks through pick().

import { h, icon, fmtInt } from "./util.js?v=49a344f7c9";
import { DB, loadDecks } from "./data.js?v=49a344f7c9";
import { on, isOwned, ownedCount } from "./store.js?v=49a344f7c9";
import { cardName, chip } from "./cards.js?v=49a344f7c9";
import { t } from "./i18n.js?v=49a344f7c9";
import { searchField, announcer, terms, namedCards, outRow, bringBack } from "./search.js?v=49a344f7c9";
import { deckRow, scaleGroups, paintOwned, tableHead } from "./decklist.js?v=49a344f7c9";

const MAX = 4;           // four picks are a whole deck
const PAGE = 10;         // results shown, then ten more on request
const SUGGEST = 4;       // cards offered under the field (one row on a desktop, two by two on a phone)
const OFTEN_FROM = 40;   // "Often with" counts the cards of the best results only

let root, D, popular = [];
let picks = [], out = [], query = "", outQuery = "", mineOnly = false;
let field, sugEl, slotsEl, resEl, voice, outEl;

export async function mount(el) {
  root = el;
  D = await loadDecks();
  popular = popularCards();
  render();
  on("owned", () => paintResults());
  on("lang", () => render());
}

/** Start over with these cards picked (the card dialog's "Decks with this card"); the cards left out stay, but a pick. */
export function pick(keys) {
  picks = keys.map((k) => DB.byKey.get(k)).filter(Boolean).slice(0, MAX);
  out = out.filter((c) => !picks.includes(c));
  query = "";
  if (root) render();
}

// ---------------------------------------------------------------- which cards to offer
/** The cards the decks of the Deck tier list play most (then by their best rating). */
function popularCards() {
  const count = new Map();
  D.rows.filter((r) => r.listed).forEach((r) => r.cards.forEach((c) => count.set(c, (count.get(c) || 0) + 1)));
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);   // stable: ties keep their first (best) rank
}

/** The cards that most often complete the best decks holding every pick. */
function oftenWith(rows) {
  const count = new Map();
  rows.slice(0, OFTEN_FROM).forEach((r) => r.cards.forEach((c) => { if (!picks.includes(c)) count.set(c, (count.get(c) || 0) + 1); }));
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

// ---------------------------------------------------------------- matching
/** Whether a row holds none of the cards left out (`skip`: the list to test, the visitor's by default). */
const allowed = (r, skip = out) => !skip.some((c) => r.cards.includes(c));
const holdsPicks = (r) => picks.every((p) => r.cards.includes(p));

/**
 * The rows holding every pick and none of the cards left out (`full`), else the rows holding the most picks, most first
 * (`near`). With no pick but cards left out, every row without them (`full`); with neither, nothing.
 */
function match() {
  if (!picks.length && !out.length) return null;
  const rows = out.length ? D.rows.filter((r) => allowed(r)) : D.rows;
  if (!picks.length) return { full: rows, near: [] };
  const full = rows.filter(holdsPicks);
  if (full.length || picks.length === 1) return { full, near: [] };
  const near = [];
  for (const r of rows) {
    const k = picks.filter((p) => r.cards.includes(p)).length;
    if (k) near.push({ r, k });
  }
  near.sort((a, b) => b.k - a.k);          // stable: inside one count the table's order stays (scaleGroups then splits the scales)
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
  // the cards left out: a card left out stops being a pick (the last choice wins, said on the offer and announced)
  outEl = outRow({ id: "fd-out", out, value: outQuery, onQuery: (v) => { outQuery = v; },
    note: (c) => (picks.includes(c) ? t("out.notePick") : null),
    onOut: (list, change) => {
      out = list;
      const dropped = change && change.left && picks.includes(change.left);
      picks = picks.filter((p) => !out.includes(p));
      paintPicks();
      if (dropped) say(t("out.saidPick", { name: cardName(change.left) }));
    } });
  root.replaceChildren(
    tableHead("builder", t("fd.h1"), t("fd.lede")),
    h("div.fd-pick", [h("div.fd-field", field.el), sugEl, slotsEl, voice.el]),
    outEl.el,
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
  const back = out.includes(c);
  if (back) { out = out.filter((x) => x !== c); outEl.set(out); }     // a pick is never left out
  query = "";
  field.set("");
  paintPicks();
  if (back) say(t("out.saidBack", { name: cardName(c) }));
  if (picks.length < MAX) field.input.focus();
  else { const hd = resEl.querySelector("h2"); if (hd) hd.focus(); }     // a whole deck: the results come into view
}

/** Says a side effect of a choice, then the results' heading, in one polite announcement (the last one said wins). */
function say(text) {
  const hd = resEl.querySelector("h2");
  voice.say(text + (hd ? " " + hd.textContent + "." : ""));
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
    // "Often with" needs a pick; a card left out is never offered (no deck shown holds it)
    const m = picks.length ? match() : null;
    const often = m && m.full.length ? oftenWith(m.full) : [];
    label = t(often.length ? "fd.often" : "fd.popular");
    list = (often.length ? often : popular).filter((c) => !picks.includes(c) && !out.includes(c));
  }
  const shown = list.slice(0, SUGGEST);     // the label counts the matches; typing more letters narrows them
  sugEl.replaceChildren(...[
    h("span.fd-sug-l", label),
    ...shown.map((c) => {
      // the verb in its name, so it never reads as the "Leave out" offers; a card left out says it comes back
      const s = t(out.includes(c) ? "fd.addBack" : "fd.add", { name: cardName(c) });
      return h("button.chip.fd-add", { type: "button", title: s, "aria-label": s, onclick: () => add(c) }, [
        h("img", { class: "cc-art", loading: "lazy", decoding: "async", alt: "", width: 18, height: 24, src: `assets/thumbs/s/${c.key}.webp` }),
        h("span.chip-l", { translate: "no" }, cardName(c)),
        icon("plus"),
      ]);
    }),
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
  let items, mk, head, none = null;
  if (m.full.length) {
    items = m.full.filter((r) => !mineOnly || mine(r));
    head = t("fd.resH", { n: items.length });
    mk = (r, i) => deckRow(r, String(i + 1), { cards: order(r), badge: badge(r) });
  } else {
    // the cards left out empty the list when some deck holds every pick without that rule: say so, and offer to bring one back
    const blocked = out.length > 0 && D.rows.some(holdsPicks);
    none = !picks.length ? t("out.none") : t(blocked ? "fd.noneOut" : "fd.none", { n: picks.length });
    parts.push(h("p.fd-none", none));
    if (blocked) {
      // each count is what the list would show with that card back, "Ready to play" included
      parts.push(bringBack(out, (c) => D.rows.filter((r) => holdsPicks(r) && allowed(r, out.filter((x) => x !== c)) && (!mineOnly || mine(r))).length, (c) => {
        out = out.filter((x) => x !== c);
        outEl.set(out);
        paintPicks();
        const hd = resEl.querySelector("h2");
        (hd || outEl.field.input).focus();
      }));
    }
    items = m.near.filter((x) => !mineOnly || mine(x.r));
    head = m.near.length ? t("fd.closeH") : null;
    mk = (x, i) => deckRow(x.r, String(i + 1), {
      cards: order(x.r),
      // "Missing: <chips>" says which picks it lacks (the old "3 of your 4 cards" tag said it twice; "Without:" until 2026-10-27,
      // when "Without these cards" came to mean the cards left out)
      note: h("p.dr-miss", [h("span.muted", t("md.missing") + " "), ...picks.filter((p) => !x.r.cards.includes(p)).map(chip)]),
      badge: badge(x.r),
    });
  }
  if (head) {
    parts.push(h("div.fd-head", [h("h2#fd-res-h", { tabindex: "-1" }, head), mineBtn]));
    parts.push(...(items.length ? scaleGroups(items, m.full.length ? (r) => r : (x) => x.r, mk, PAGE) : [h("p.fd-none", t("fd.mineNone"))]));
  }
  resEl.replaceChildren(...parts);
  voice.say(m.full.length ? head : none);
}

function badge(r) {
  if (!ownedCount()) return null;
  const el = h("div.obadge");
  paintOwned(el, r.cards);
  return el;
}
