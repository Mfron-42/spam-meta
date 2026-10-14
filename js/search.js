// The one card search of the site: the search field (Codex, Deck tier list, Card tier list) and its matching.
// Matching is accent- and case-insensitive and every word must match ("chouette", "leviathan", "lames en"); a phrase in
// double quotes must match as written. The field clears with its clear button or Escape.

import { h, icon, norm, debounce } from "./util.js";

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
