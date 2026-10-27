// The one renderer of card texts (abilities, passives, talents, the hidden-effect lines, the suggested talent, the Codex
// search excerpt): element words become the client's element orb plus the word in its element colour, and the game's
// keywords become chips, with a tooltip holding the client's own definition (data/keywords.json, tools/export_keywords.py).
// DESIGN.md "Card text"; docs/DATA.md "keywords.json".
//
// Matching follows the client's keyword stems (`match_<lang>`): accent- and case-free, from the start of a word to its end
// ("provoc" finds "Provocations"). A passive keyword matches its whole name with its first letter as written (a proper
// noun). A bracket group whose text starts with a keyword ("[Taunt]", "[Cost 10 Fire]") becomes one chip without its
// brackets; a bracket of numbers ("[30 to 50]") stays text. Card names are never touched. Tokens are cached per text.

import { h } from "./util.js?v=57c092aad8";
import { DB } from "./data.js?v=57c092aad8";
import { getLang } from "./store.js?v=57c092aad8";
import { chromeBottom } from "./ui.js?v=57c092aad8";

// element words of the card texts, accent-free and lower case, singular and plural
const EL_WORDS = {
  fr: { fire: ["feu", "feux"], water: ["eau", "eaux"], earth: ["terre", "terres"], nature: ["nature", "natures"], light: ["lumiere", "lumieres"], shadow: ["ombre", "ombres"] },
  en: { fire: ["fire", "fires"], water: ["water", "waters"], earth: ["earth", "earths"], nature: ["nature", "natures"], light: ["light", "lights"], shadow: ["shadow", "shadows"] },
};
const WORD = "[\\p{L}\\p{N}]";
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Lower case and accent-free, one character for one, so indices into the folded text are indices into the text. */
function fold(s) {
  let out = "";
  for (const ch of s) {
    const f = ch.normalize("NFD")[0].toLowerCase();
    out += f.length === ch.length ? f : ch;
  }
  return out;
}

// ---- per-language matchers, built once from keywords.json
const matchers = {};
function matcher(lang) {
  if (matchers[lang]) return matchers[lang];
  const kws = (DB.keywords && DB.keywords.keywords) || [];
  const alts = [];            // {src, kw, exact, first}
  const brackets = [];        // stems a bracket group may start with
  for (const kw of kws) {
    for (const m of kw["match_" + lang] || []) {
      if (kw.kind === "passive") alts.push({ stem: fold(m), kw, exact: true, first: m[0] });
      else if (m.startsWith("[")) brackets.push({ stem: fold(m.slice(1).replace(/\]$/, "")), kw });
      else { alts.push({ stem: fold(m), kw, exact: false }); brackets.push({ stem: fold(m), kw }); }
    }
  }
  alts.sort((a, b) => b.stem.length - a.stem.length);
  brackets.sort((a, b) => b.stem.length - a.stem.length);
  const kwRx = alts.length ? new RegExp(alts.map((a) => `(${a.stem.match(/^[\p{L}\p{N}]/u) ? `(?<!${WORD})` : ""}${reEsc(a.stem)}${a.exact ? `(?!${WORD})` : `${WORD}*`})`).join("|"), "gu") : null;
  const els = Object.entries(EL_WORDS[lang] || EL_WORDS.en).flatMap(([id, ws]) => ws.map((w) => [w, id]));
  els.sort((a, b) => b[0].length - a[0].length);
  const elRx = new RegExp(`(?<!${WORD})(${els.map(([w]) => reEsc(w)).join("|")})(?!${WORD})`, "gu");
  const names = DB.cards.flatMap((c) => [c.name_fr, c.name_en]).filter(Boolean).sort((a, b) => b.length - a.length);
  const nameRx = names.length ? new RegExp(`(?<!${WORD})(${names.map(reEsc).join("|")})(?!${WORD})`, "gu") : null;
  matchers[lang] = { alts, brackets, kwRx, elRx, elOf: new Map(els), nameRx, byId: new Map(kws.map((k) => [k.id, k])) };
  return matchers[lang];
}

// ---- tokens: [{s, e, k: "el" | "kw", id, inner?: [s, e]}], sorted, never overlapping
const cache = new Map();
function tokens(text, lang) {
  const key = lang + "\u0000" + text;
  if (cache.has(key)) return cache.get(key);
  const M = matcher(lang), f = fold(text), toks = [];
  const used = new Uint8Array(text.length);
  const free = (s, e) => { for (let i = s; i < e; i++) if (used[i]) return false; return true; };
  const take = (t) => { toks.push(t); used.fill(1, t.s, t.e); };
  // card names are left as they are written
  if (M.nameRx) for (const m of text.matchAll(M.nameRx)) used.fill(1, m.index, m.index + m[0].length);
  // a bracket group led by a keyword: one chip, its brackets dropped
  for (const m of f.matchAll(/\[([^\]\n]{1,48})\]/g)) {
    const inner = m[1];
    const b = M.brackets.find((x) => (x.kw.kind === "passive" ? inner === x.stem : inner.startsWith(x.stem)));
    if (b && free(m.index, m.index + m[0].length)) take({ s: m.index, e: m.index + m[0].length, k: "kw", id: b.kw.id, inner: [m.index + 1, m.index + m[0].length - 1] });
  }
  if (M.kwRx) {
    for (const m of f.matchAll(M.kwRx)) {
      const i = m.slice(1).findIndex((g) => g !== undefined);
      const a = M.alts[i], s = m.index, e = s + m[0].length;
      if (!free(s, e)) continue;
      if (a.exact && text[s] !== a.first) continue;     // a passive's name keeps its capital ("et inversement" is no passive)
      take({ s, e, k: "kw", id: a.kw.id });
    }
  }
  // element words: in the text, and inside a bracket chip ("[Cost 10 Fire]")
  const inBracket = (s, e) => toks.some((t) => t.inner && s >= t.inner[0] && e <= t.inner[1]);
  const els = [];
  for (const m of f.matchAll(M.elRx)) {
    const s = m.index, e = s + m[0].length;
    if (free(s, e) || inBracket(s, e)) els.push({ s, e, k: "el", id: M.elOf.get(m[0]) });
  }
  for (const t of toks) if (t.inner) t.els = els.filter((x) => x.s >= t.inner[0] && x.e <= t.inner[1]);
  const out = [...toks, ...els.filter((x) => !inBracket(x.s, x.e))].sort((a, b) => a.s - b.s);
  if (cache.size > 4000) cache.clear();
  cache.set(key, out);
  return out;
}

// ---- nodes
/** Text with search marks: `marks` (one boolean per character) wraps the marked runs in <mark>. */
function plain(text, s, e, marks) {
  if (!marks) return text.slice(s, e);
  const out = [];
  for (let i = s; i < e;) {
    let j = i;
    while (j < e && marks[j] === marks[i]) j++;
    out.push(marks[i] ? h("mark", text.slice(i, j)) : text.slice(i, j));
    i = j;
  }
  return out;
}

/** An element word: the client's orb, then the word as written in its element colour. */
export function elementNode(id, word) {
  return h(`span.el.el-${id}.sp-el-${id}`, word);
}

function elementsIn(text, s, e, els, marks) {
  const out = [];
  let at = s;
  for (const x of els) {
    out.push(plain(text, at, x.s, marks), elementNode(x.id, plain(text, x.s, x.e, marks)));
    at = x.e;
  }
  out.push(plain(text, at, e, marks));
  return out;
}

// every chip has its own hidden description (the definition a screen reader reads with it); the tooltip is visual only
let descN = 0;
function keywordNode(kw, label, tips) {
  const lang = getLang();
  const desc = kw && kw["desc_" + lang];
  if (!desc || !tips) return h("span.kw", label);
  const id = "kwd-" + ++descN;
  return [h("button.kw.has-tip", { type: "button", "data-kw": kw.id, "aria-describedby": id }, label), h("span", { id, hidden: true }, desc)];
}

/**
 * A card text as nodes for a parent with `white-space: pre-line`. Options: `tips` (false: chips without tooltips, for the
 * Codex search excerpt), `marks` (search marks, one boolean per character), `from` / `to` (a window of the text; a token
 * cut by its edge is kept whole).
 */
export function cardText(text, { tips = true, marks = null, from = 0, to = null } = {}) {
  text = text || "";
  const lang = getLang();
  const M = matcher(lang);
  let end = to == null ? text.length : to;
  const toks = tokens(text, lang);
  for (const t of toks) {
    if (t.s < from && t.e > from) from = t.s;
    if (t.s < end && t.e > end) end = t.e;
  }
  const out = [];
  let at = from;
  for (const t of toks) {
    if (t.e <= from || t.s >= end) continue;
    out.push(plain(text, at, t.s, marks));
    if (t.k === "el") out.push(elementNode(t.id, plain(text, t.s, t.e, marks)));
    else {
      const label = t.inner ? elementsIn(text, t.inner[0], t.inner[1], t.els || [], marks) : plain(text, t.s, t.e, marks);
      out.push(keywordNode(M.byId.get(t.id), label, tips));
    }
    at = t.e;
  }
  out.push(plain(text, at, end, marks));
  return { nodes: out, from, to: end };
}

/** cardText's nodes only (the common case). */
export const textNodes = (text, opts) => cardText(text, opts).nodes;

/**
 * A button that explains itself with the page's tooltip, as a keyword chip does (the Deck tier list's figures, DESIGN.md "Deck
 * figures"): `head` titles the tooltip, `desc` is its text and the button's description for a screen reader. `tag` is the
 * button's h() tag ("button.rf"). Returns the button and its hidden description, to place side by side.
 */
export function tipButton(tag, head, kids, desc) {
  const id = "tipd-" + ++descN;
  return [h(tag + ".has-tip", { type: "button", "data-tip": head, "aria-describedby": id }, kids), h("span", { id, hidden: true }, desc)];
}

// ---------------------------------------------------------------- the page's tooltip
// One tooltip for the page, for the keyword chips and the other self-explaining buttons (tipButton), moved into the open
// <dialog> when the chip sits in one (a modal dialog is the top layer, and the rest of the page is inert), placed above the
// chip (below when there is no room), kept inside the viewport, under the sticky header and toolbar (ui.js chromeBottom), and
// inside the chip's dialog. Hover opens it on a mouse (and it stays while the pointer moves onto it); a tap or a click pins it
// until the next tap elsewhere; keyboard focus opens it; Escape closes it (before the dialog); it goes when its chip scrolls
// under the chrome or out of the view.
// The tooltip is visual (aria-hidden): each chip carries its own hidden description, read with it by a screen reader.

let tip = null, cur = null, pinned = false, raf = 0;

function tipEl() {
  if (!tip) tip = h("div.kw-tip#kw-tip", { "aria-hidden": "true" }, [h("b.kw-tip-h"), h("span.kw-tip-d")]);
  return tip;
}

function place() {
  if (!cur || !cur.isConnected) { hideTip(); return; }
  const r = cur.getBoundingClientRect();
  const box = cur.closest("dialog, [role='dialog']");
  // in the page, the room starts under the sticky header and toolbar; a modal dialog covers them
  const vb = { l: 0, t: cur.closest("dialog") ? 0 : chromeBottom(), r: document.documentElement.clientWidth, b: innerHeight };
  if (box) {
    const d = box.getBoundingClientRect();
    vb.l = Math.max(vb.l, d.left); vb.t = Math.max(vb.t, d.top); vb.r = Math.min(vb.r, d.right); vb.b = Math.min(vb.b, d.bottom);
  }
  // the chip scrolled out of its box: nothing to point at
  if (r.bottom < vb.t || r.top > vb.b) { hideTip(); return; }
  const m = 8;
  tip.style.maxWidth = Math.max(160, Math.min(320, vb.r - vb.l - 2 * m)) + "px";
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let top = r.top - th - m, below = false;
  if (top < vb.t + m) { top = r.bottom + m; below = true; }
  const left = Math.min(Math.max(r.left + r.width / 2 - tw / 2, vb.l + m), vb.r - m - tw);
  tip.classList.toggle("below", below);
  tip.style.left = Math.round(left) + "px";
  tip.style.top = Math.round(top) + "px";
}

/** What a chip's tooltip says: a keyword's name and definition (keywords.json), or a tipButton's head and description. */
function tipText(btn) {
  if (btn.dataset.kw) {
    const kw = matcher(getLang()).byId.get(btn.dataset.kw);
    const desc = kw && kw["desc_" + getLang()];
    return desc ? { head: kw["name_" + getLang()] || btn.textContent, desc } : null;
  }
  const d = document.getElementById(btn.getAttribute("aria-describedby"));
  return d && d.textContent ? { head: btn.dataset.tip || "", desc: d.textContent } : null;
}

function showTip(btn, pin) {
  const x = tipText(btn);
  if (!x) return;
  const t = tipEl();
  const host = btn.closest("dialog") || document.body;
  if (t.parentNode !== host) host.append(t);
  if (cur && cur !== btn) cur.classList.remove("on");
  cur = btn;
  pinned = pin;
  btn.classList.add("on");
  t.firstChild.textContent = x.head;
  t.firstChild.hidden = !x.head;
  t.lastChild.textContent = x.desc;
  t.lang = getLang();
  place();
  if (cur) t.classList.add("on");
}

/** Closes the tooltip; true when one was open (the dialogs' Escape closes it first). */
export function hideTip() {
  clearTimeout(leaveT);
  if (!tip || !tip.classList.contains("on")) { cur = null; pinned = false; return false; }
  tip.classList.remove("on");
  if (cur) cur.classList.remove("on");
  cur = null;
  pinned = false;
  return true;
}

const chipOf = (e) => (e.target instanceof Element ? e.target.closest(".has-tip") : null);
const inTip = (n) => !!(tip && n instanceof Node && tip.contains(n));

// a mouse leaving the chip has 120ms to reach the tooltip (it can be hovered and its text selected, WCAG 1.4.13)
let leaveT = 0;
const leaveSoon = () => { clearTimeout(leaveT); leaveT = setTimeout(() => { if (!pinned) hideTip(); }, 120); };

function initTips() {
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
    const b = chipOf(e);
    if (b || inTip(e.target)) clearTimeout(leaveT);
    if (b && b !== cur && !pinned) showTip(b, false);
  });
  document.addEventListener("pointerout", (e) => {
    if (!cur || pinned || document.activeElement === cur) return;
    const to = e.relatedTarget;
    const from = chipOf(e) === cur || inTip(e.target);
    if (from && !(to instanceof Node && (cur.contains(to) || inTip(to)))) leaveSoon();
  });
  document.addEventListener("click", (e) => {
    const b = chipOf(e);
    if (b) {
      e.stopPropagation();
      if (b === cur && pinned) hideTip(); else showTip(b, true);
    } else if (pinned && !inTip(e.target)) hideTip();
  }, true);
  document.addEventListener("focusin", (e) => { const b = chipOf(e); if (b && b !== cur) showTip(b, false); });
  document.addEventListener("focusout", (e) => { const b = chipOf(e); if (b && b === cur && !pinned) hideTip(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && hideTip()) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  const follow = () => { if (cur && !raf) raf = requestAnimationFrame(() => { raf = 0; place(); }); };
  document.addEventListener("scroll", follow, { capture: true, passive: true });
  // a resize (a phone's address bar folding away) moves the tooltip with its chip; it never closes a pinned one
  addEventListener("resize", follow);
}

initTips();
