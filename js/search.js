// The one card search of the site: the search field (Codex, Deck tier list, Card tier list, My decks, Deck builder), its
// matching, and the search row of the two deck lists (Deck tier list, My decks): the field and its one live result line.
// Matching is accent- and case-insensitive and every word must match ("chouette", "leviathan", "lames en"); a phrase in
// double quotes must match as written. The field clears with its clear button or Escape.

import { h, icon, norm, debounce } from "./util.js?v=f04c2f75e4";
import { DB } from "./data.js?v=f04c2f75e4";
import { chip } from "./cards.js?v=f04c2f75e4";
import { t, tx } from "./i18n.js?v=f04c2f75e4";
import { DECK_TABLE_SHOWN } from "./patch.js?v=f04c2f75e4";

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
