// The one card search of the site: the search field (Codex, Deck tier list, Card tier list, My decks, Deck builder), its
// matching, the search row of the two deck lists (Deck tier list, My decks): the field and its one live result line, and the
// "Without these cards" row of the two deck table views (Deck builder, My decks): the cards a visitor leaves out.
// Matching is accent- and case-insensitive and every word must match ("chouette", "leviathan", "lames en"); a phrase in
// double quotes must match as written. The field clears with its clear button or Escape.

import { h, icon, norm, debounce } from "./util.js?v=e6624c9207";
import { DB } from "./data.js?v=e6624c9207";
import { chip, cardName } from "./cards.js?v=e6624c9207";
import { t, tx } from "./i18n.js?v=e6624c9207";
import { DECK_TABLE_SHOWN } from "./patch.js?v=e6624c9207";

/** The words of a query, normalised: `polychrome "en peine"` -> ["polychrome", "en peine"]. */
export function terms(q) {
  const out = [];
  norm(q || "").replace(/"([^"]+)"|(\S+)/g, (_, phrase, word) => { const w = (phrase || word).trim(); if (w) out.push(w); });
  return out;
}

/** True when every word is in the (normalised) text. No words matches everything. */
export const hasAll = (hay, ts) => ts.every((w) => hay.includes(w));

/** A card's two names, normalised, so a search in either language finds it. */
const names = new Map();
export function nameHay(c) {
  if (!names.has(c.key)) names.set(c.key, norm(`${c.name_fr}\n${c.name_en}`));
  return names.get(c.key);
}

/** The cards whose French or English name holds every word. */
export const namedCards = (ts) => DB.cards.filter((c) => hasAll(nameHay(c), ts));

/**
 * A visually hidden polite live region for a search result, in plain text. It speaks once the typing has paused, so a screen
 * reader is not interrupted on every key, and it never holds buttons (the visible result line does). Returns { el, say(text) }.
 */
export function announcer(delay = 600) {
  const el = h("p.sr", { "aria-live": "polite" });
  const say = debounce((text) => { if (el.textContent !== text) el.textContent = text; }, delay);
  return { el, say };
}

/**
 * The search field: a 44px sunken socket with a magnifier, the input and a clear button that shows with text.
 * onChange(value) runs `delay` ms after typing, and at once on clear; onEnter(value) runs on Enter, right after onChange.
 * Returns { el, input, set(value) } (set() does not call onChange).
 */
export function searchField({ id, name = "q", placeholder, label, clearLabel, value = "", onChange, onEnter, delay = 90, cls = "" }) {
  const input = h("input", { id, type: "search", name, autocomplete: "off", spellcheck: "false", enterkeyhint: "search", placeholder, "aria-label": label });
  input.value = value;
  const sync = () => { clear.hidden = !input.value; };
  const run = debounce(() => onChange(input.value), delay);
  const reset = () => { input.value = ""; sync(); onChange(""); };
  const clear = h("button.field-clear", { type: "button", "aria-label": clearLabel, title: clearLabel, onclick: () => { reset(); input.focus(); } }, icon("close"));
  input.addEventListener("input", () => { sync(); run(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && input.value) { e.preventDefault(); e.stopPropagation(); reset(); }
    else if (e.key === "Enter" && onEnter) { e.preventDefault(); onChange(input.value); onEnter(input.value); }   // no waiting on the typing pause
  });
  sync();
  const el = h("div.field.search" + cls, { onpointerdown: (e) => { if (e.target === el) { e.preventDefault(); input.focus(); } } }, [icon("search"), input, clear]);
  return { el, input, set(v) { input.value = v; sync(); } };
}

/**
 * The card search row of a deck list (Deck tier list, My decks): the field, then one live line beside it that names what was
 * found ("3 decks with <chip>") or says nothing matched, with a Clear button. When the query names exactly one card that a deck
 * holds and the Deck builder is shown (patch.js DECK_TABLE_SHOWN), the line ends with "Decks with this card", which opens the Deck
 * builder with that card picked (every measured deck, not only the ones of this list). The caller filters its decks in onChange and
 * then calls paint(ts, hits, inDecks, shown): the query's words, the cards it names, those of them some deck of the list
 * holds, and how many decks are shown. Returns { el, field, paint }.
 */
export function findRow({ id, name, placeholder, label, clearLabel, value = "", onChange, onEnter }) {
  const field = searchField({ id, name, placeholder, label, clearLabel, value, onChange, onEnter });
  const status = h("p.find-say");
  const voice = announcer();
  function paint(ts, hits, inDecks, shown) {
    if (!ts.length) { status.replaceChildren(); voice.say(""); return; }
    const q = field.input.value.trim();
    const clear = h("button.btn.ghost.find-clear", { type: "button", onclick: () => { field.set(""); onChange(""); field.input.focus(); } }, t("find.clear"));
    const named = (list) => list.flatMap((c, i) => (i ? [t("find.or"), chip(c)] : [chip(c)]));
    let say;
    if (!hits.length) say = [t("find.noCard", { q }), clear];
    else if (!shown) say = [...(hits.length <= 2 ? tx("find.noDeck", { cards: h("span.find-cards", named(hits)) }) : [t("find.noDeckN", { m: hits.length })]), clear];
    else if (inDecks.length <= 2) say = tx("find.decks", { n: shown, cards: h("span.find-cards", named(inDecks)) });
    else say = [t("find.decksN", { n: shown, m: inDecks.length })];
    if (hits.length === 1 && shown && DECK_TABLE_SHOWN) {
      say.push(h("a.btn.ghost.find-more", { href: "#builder", "data-goto": "builder", "data-pick": hits[0].key, title: t("card.findDecksTitle") }, [icon("search"), t("card.findDecks")]));
    }
    status.replaceChildren(...say);
    // the screen reader hears the sentence without the Clear button
    voice.say([...status.childNodes].filter((n) => n !== clear && !n.classList?.contains("find-more")).map((n) => n.textContent).join(""));
  }
  return { el: h("div.find", [field.el, status, voice.el]), field, paint };
}

// ---------------------------------------------------------------- without these cards
// cards offered while typing: four, two on a phone (where they share the one reserved row); the hidden region says as many
const outSuggest = () => (window.matchMedia && window.matchMedia("(max-width: 640px)").matches ? 2 : 4);

/** A card's small art, as in a card chip (18 x 24). */
const thumb = (c) => h("img", { class: "cc-art", loading: "lazy", decoding: "async", alt: "", width: 18, height: 24, src: `assets/thumbs/s/${c.key}.webp` });

/**
 * The "Without these cards" row of the Deck builder and My decks (owner, 2026-10-27: "a deck that does NOT contain card X, for the
 * ban mode"; DESIGN.md "Without these cards"): its label, the card search field, one reserved line under it (the hint at rest;
 * while typing, "Leave out:" and the matching cards, Enter taking the first, a card already left out drawn disabled), then the
 * cards left out as removable chips, in the builder's order (field, offers, what was taken). The view filters its decks and keeps
 * the state, so it survives a redraw: `out` (card objects) and `value` (the query) start the row; onOut(list, change) runs on every
 * change of the list ({ left } or { back }: the card), onQuery(value) on every change of the query; `note(c)`, when given, is a
 * word on what leaving `c` out also does (the builder: it is one of your cards). Returns { el, field, set(list) } (set() does not
 * call onOut).
 */
export function outRow({ id, out = [], value = "", onOut, onQuery = () => {}, note = () => null }) {
  let list = out.slice(), q = value;
  const hintId = id + "-hint";
  const field = searchField({ id, name: "out-card", placeholder: t("out.ph"), label: t("out.label"), clearLabel: t("cx.clearSearch"), value,
    onChange: (v) => { q = v; onQuery(v); paintLine(); },
    onEnter: () => { const first = line.querySelector(".out-add:not(:disabled)"); if (first && q.trim()) first.click(); } });
  field.input.setAttribute("aria-describedby", hintId);
  const voice = announcer();
  const label = h("label.out-l", { for: id }, t("out.label"));
  const chips = h("ul.out-list", { "aria-label": t("out.list") });
  const hint = h("span.out-hint", { id: hintId }, t("out.hint"));
  const matches = h("span.out-m");
  const line = h("p.out-sug", [hint, matches]);

  /** Every change of the list: the chips, the line (a card left out leaves the offer), then the view. */
  function commit(next, change, focusAt = null) {
    list = next;
    paintChips(focusAt);
    paintLine();
    onOut(list.slice(), change);
  }

  function leave(c) {
    if (list.includes(c)) return;
    q = "";
    field.set("");
    onQuery("");
    commit([...list, c], { left: c });
    field.input.focus();
  }

  /** The cards left out, each a chip that brings it back (ban mode leaves out one or two: no "Clear all"). Focus stays in the
   * row after a removal: on the chip now in its place, else the one before, else the field. */
  function paintChips(focusAt) {
    chips.replaceChildren(...list.map((c, i) => h("li", h("button.qchip.out-chip", { type: "button", title: t("out.del", { name: cardName(c) }),
      "aria-label": t("out.del", { name: cardName(c) }), onclick: () => commit(list.filter((x) => x !== c), { back: c }, i) },
    [thumb(c), h("span", { translate: "no" }, cardName(c)), icon("close", 14)]))));
    chips.hidden = !list.length;
    if (focusAt == null) return;
    const bs = chips.querySelectorAll(".out-chip");
    const to = focusAt >= 0 && bs.length ? bs[Math.min(focusAt, bs.length - 1)] : field.input;
    to.focus();
  }

  /**
   * The line under the field: the hint at rest; while typing, "Leave out:" and the matching cards (the verb said on the line and
   * in each card's name, so it never reads as the picks' line above), a card already left out disabled with its reason.
   */
  function paintLine() {
    const ts = terms(q);
    hint.hidden = ts.length > 0;
    matches.hidden = !ts.length;
    if (!ts.length) { matches.replaceChildren(); voice.say(""); return; }
    const found = namedCards(ts);
    if (!found.length) {
      const none = t("find.noCard", { q: q.trim() });
      matches.replaceChildren(h("span.out-no", none));
      voice.say(none);
      return;
    }
    const shown = found.slice(0, outSuggest());
    matches.replaceChildren(h("span.fd-sug-l", t("out.offer")), ...shown.map((c) => {
      const name = cardName(c), done = list.includes(c), more = done ? null : note(c);
      const say = done ? t("out.already", { name }) : t("out.add", { name }) + (more ? " " + more : "");
      return h("button.chip.out-add", { type: "button", disabled: done, title: say, "aria-label": say, onclick: () => leave(c) },
        [thumb(c), h("span.chip-l", { translate: "no" }, name), icon("minus")]);
    }));
    voice.say(t("out.offer").replace(/\s*:\s*$/, "") + ": " + shown.map((c) => (list.includes(c) ? t("out.already", { name: cardName(c) }) : cardName(c))).join(", "));
  }

  paintChips(null);
  paintLine();
  // the label names the field (its accessible name is the same words); the chips are a list named "Cards left out"
  const el = h("div.out", [label, field.el, line, chips, voice.el]);
  return { el, field, set(next) { list = next.slice(); paintChips(null); paintLine(); } };
}

/**
 * What to say when the cards left out leave no deck (the Deck builder, My decks): up to three cards that, brought back alone,
 * show decks again, the most first, each a button with its verb and count ("Bring back Keria: 12 decks", the name cut before the
 * count on a narrow screen); else one line saying no single card would. `count(c)` is how many decks the view would show with `c`
 * brought back; `back(c)` brings it back.
 */
export function bringBack(out, count, back) {
  const best = out.map((c) => ({ c, n: count(c) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 3);
  if (!best.length) return h("p.out-back.muted", t("out.hintNone"));
  return h("div.out-back", best.map(({ c, n }) => h("button.btn", { type: "button", onclick: () => back(c) },
    [thumb(c), h("span.ob-t", tx("out.back", { name: h("span.ob-n", { translate: "no" }, cardName(c)), decks: h("span.ob-d", t("fd.resH", { n })) }))])));
}
