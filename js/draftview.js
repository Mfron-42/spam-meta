// Draft tab (#draft, the tournament helper; the owner, 2026-10-27: the Deck builder stays simple, the draft is a mode of its own):
// one format at a time, chosen in a tablist of two groups, Tournament (Conquest, Fearless draft) and In game (Fearless, Draft).
// The visitor enters what they know (their cards or their collection, the talents they lack, the cards they can no longer play,
// the opponent's decks, picks or played cards) and gets the call (the pick, the ban, the deck to play), its win chance and the
// talents behind it. Every number comes from the lab's matchup model (tools/export_matchup.py; the lab's contract,
// docs/matchup_model.md section 4) run in a Web Worker (site/js/matchup/worker.js), so nothing freezes the page; the model loads
// the first time the tab is seen, never at the idle mount.
// Honesty (the lead, 2026-10-28): a deck's evidence is a quiet mark with its tooltip, measured (the exact talents were played),
// composed (these cards, never with these talents) or estimate (these four cards never played together), and a talent the data
// never saw on that card is marked guessed; a win chance within 5 points of even reads "Toss-up", the call becoming its lean.
// The likely opponents are named by their count only (the owner retired the players' meta from the site): no deck of them is
// ever drawn. The state is kept while the tab lives (sessionStorage, so a phone tab dropped mid-match comes back), the
// format in the address (#draft/<format>).

import { h, icon, fmtInt, pct } from "./util.js?v=aa3c01bc6a";
import { DB, loadMatchup } from "./data.js?v=aa3c01bc6a";
import { on, ownedKeys, getLang } from "./store.js?v=aa3c01bc6a";
import { cardName, chip, L } from "./cards.js?v=aa3c01bc6a";
import { t, tx } from "./i18n.js?v=aa3c01bc6a";
import { searchField, announcer, terms, namedCards, outRow } from "./search.js?v=aa3c01bc6a";
import { deckSlot } from "./decklist.js?v=aa3c01bc6a";
import { tipButton } from "./cardtext.js?v=aa3c01bc6a";
import { methodSection, methodLink } from "./patch.js?v=aa3c01bc6a";
import { disclosure } from "./ui.js?v=aa3c01bc6a";
import { toast } from "./dialogs.js?v=aa3c01bc6a";
import { versioned } from "./version.js?v=aa3c01bc6a";

// the formats, in the tablist's order, with their group and their address
const FMTS = [["conquest", "tour", "conquest"], ["fearless-draft", "tour", "fdraft"], ["fearless", "game", "fearless"], ["draft", "game", "draft"]];
const KEY = Object.fromEntries(FMTS.map(([f, , k]) => [f, k]));
const TOSS = 0.05;              // a win chance within this of even is a toss-up (the lead's rule)
// cards offered under a field: four, two on a phone (one row of two, so the line's reserved room is one row, not a hole)
const SEARCH = () => (matchMedia("(max-width: 640px)").matches ? 2 : 4);
const thumb = (c, w = 24, hh = 34) => h("img", { class: "dr-art", loading: "lazy", decoding: "async", alt: "", width: w, height: hh, src: `assets/thumbs/s/${c.key}.webp` });
const card = (id) => DB.byId.get(id);
const ids = (cs) => cs.map((c) => c.id);
const fig = (p) => pct(p, 0);
// read on the printed figure, so a "55%" reads the same on every answer
const toss = (p) => Math.abs(Math.round(p * 100) - 50) < Math.round(TOSS * 100);
const STORE = "spam-meta:draft:v1";   // while the tab lives: what the visitor entered, dropped when the tab closes

let root = null;
let ui = {};
let started = false;            // a call was asked once: every redraw (a format, a language) asks again
const S = {
  fmt: "conquest",
  mine: false,                  // only the visitor's collection
  locked: new Map(),            // card -> Set of the talent levels (1..n) the visitor does not have
  ig: { out: [] },              // Draft in game: the cards left out
  fe: { mine: [], opp: [] },    // Fearless in game: the cards each side already played
  cq: { me: [[], [], []], opp: [[], [], []], prep: null, myBan: null, theirBan: null, games: [] },
  fd: { first: "me", used: [], steps: [] },
};

export async function mount(el) {
  root = el;
  restore();
  if (/^#draft\/[\w-]+/.test(location.hash)) S.fmt = fromHash();
  render();
  // kept when the tab is hidden or left (a phone switching apps may drop it), read back at the next mount
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") save(); });
  window.addEventListener("pagehide", save);
  on("lang", () => render());
  on("owned", () => { if (S.mine) compute(); else paintYours(); });
  // an address that names a format (a link, Back) shows it, the view mounted or not
  window.addEventListener("hashchange", () => { if (/^#draft\/[\w-]+/.test(location.hash)) setFormat(fromHash()); });
  // the model (1.1 MB) loads the first time the tab is seen: the idle mount only draws the page
  const seen = new IntersectionObserver((es) => {
    if (!es.some((e) => e.isIntersecting)) return;
    seen.disconnect();
    boot().catch(() => {});        // a format with nothing to ask yet still loads it (its errors are drawn by the next call)
    compute();
  });
  seen.observe(root);
}

// ---------------------------------------------------------------- the worker
// One module worker for the tab's life; requests carry an id, and only the latest answer of a panel is drawn (runner()).
let worker = null, ready = null, seq = 0, live = false;   // live: the worker holds the model
let M = null;                   // what the Method quotes once the model is in: {games, field}
const waiting = new Map();

function boot() {
  if (ready) return ready;
  ready = (async () => {
    if (typeof Worker === "undefined") throw Object.assign(new Error("no worker"), { code: "noWorker" });
    const [weights, field] = await loadMatchup();
    M = { games: (weights.data && weights.data.games && weights.data.games.full) || 0, field: field.decks.length };
    worker = new Worker(versioned(new URL("./matchup/worker.js", import.meta.url).href), { type: "module" });
    worker.onmessage = (e) => { const w = waiting.get(e.data.id); if (w) { waiting.delete(e.data.id); w.ok(e.data); } };
    worker.onerror = (e) => {
      e.preventDefault();
      for (const w of waiting.values()) w.fail(Object.assign(new Error("worker"), { code: "noWorker" }));
      waiting.clear();
      worker = null; ready = null; live = false;
    };
    const r = await post({ init: { weights, field } }, 30000);
    if (!r.ok) throw new Error("init");
    live = true;
    method();
  })();
  ready.catch(() => { ready = null; live = false; if (worker) { worker.terminate(); worker = null; } });
  return ready;
}

function post(msg, ms = 60000) {
  return new Promise((ok, fail) => {
    const id = ++seq;
    const timer = setTimeout(() => { if (waiting.delete(id)) fail(new Error("timeout")); }, ms);
    waiting.set(id, { ok: (v) => { clearTimeout(timer); ok(v); }, fail: (e) => { clearTimeout(timer); fail(e); } });
    worker.postMessage({ id, ...msg });
  });
}

async function ask(request) {
  await boot();
  const { response } = await post({ request });
  if (!response || !response.ok) throw Object.assign(new Error(response ? response.error : "no answer"), { code: "call" });
  return response;
}

// ---------------------------------------------------------------- what the visitor knows, shared by the formats
/** The talent levels my side may use: {cardId: [levels]} for the cards whose talents the visitor does not all have, else null. */
function myTalents() {
  const out = {};
  for (const [c, lacks] of S.locked) {
    const levels = c.talents.map((_, i) => i + 1).filter((l) => !lacks.has(l));
    if (levels.length && levels.length < c.talents.length) out[c.id] = levels;
  }
  return Object.keys(out).length ? out : null;
}

/** The cards my side may play: every card, or the collection. */
function myCards() {
  if (!S.mine) return DB.cards.slice();
  const owned = ownedKeys();
  return DB.cards.filter((c) => owned.has(c.key));
}

// ---------------------------------------------------------------- page
function fromHash() {
  const m = /^#draft\/([\w-]+)/.exec(location.hash);
  return m && KEY[m[1]] ? m[1] : "conquest";
}

function render() {
  ui = {};
  ui.panel = h("div.dr-panel#dr-panel", { role: "tabpanel", "aria-labelledby": "dr-tab-" + S.fmt });
  root.replaceChildren(...[
    // where the numbers come from lives in the footer (the house rule: no prose above the view), one link away
    h("div.vhead", [h("h1", t("dr.h1")), h("p.vsub", methodLink("draft"))]),
    // a browser that cannot run the model says so at once, not after the first press
    typeof Worker === "undefined" ? h("p.dr-off", { role: "note" }, [icon("info", 24), h("span", t("dr.noWorker"))]) : null,
    formats(),
    ui.panel,
  ].filter(Boolean));
  method();
  paintPanel();
}

/** The formats: one tablist, two captioned groups on the .seg track (the active segment raised in cyan: the one choice). */
function formats() {
  const gName = (g) => t(g === "tour" ? "dr.gTour" : "dr.gGame");
  // each tab names its group too ("Fearless, In game"): the captions are drawn for the eye only
  const tab = (f, g) => h("button", { type: "button", role: "tab", id: "dr-tab-" + f, "aria-selected": String(f === S.fmt), "aria-controls": "dr-panel",
    "aria-label": t("dr.fTab", { fmt: t("dr.f." + KEY[f]), group: gName(g) }),
    tabindex: f === S.fmt ? "0" : "-1", title: t("dr.fn." + KEY[f]), onclick: () => setFormat(f) }, t("dr.f." + KEY[f]));
  const group = (g) => h("div.dr-grp", { role: "presentation" }, [
    h("span.dr-grp-l", { "aria-hidden": "true" }, gName(g)),
    h("div.seg.dr-seg", { role: "presentation" }, FMTS.filter(([, gg]) => gg === g).map(([f]) => tab(f, g))),
  ]);
  return h("div.dr-fmts", { role: "tablist", "aria-label": t("dr.formats"), onkeydown: roveFormats }, [group("tour"), group("game")]);
}

function roveFormats(e) {
  const list = FMTS.map(([f]) => f), i = list.indexOf(S.fmt);
  const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: list.length - 1 }[e.key];
  if (to == null || to < 0 || to >= list.length) return;
  e.preventDefault();
  setFormat(list[to]);
  root.querySelector("#dr-tab-" + list[to]).focus();
}

function setFormat(f) {
  if (f === S.fmt) return;
  S.fmt = f;
  try { history.replaceState(history.state, "", "#draft/" + f); } catch (err) { /* a sandboxed page keeps its address */ }
  for (const [g] of FMTS) {
    const b = root.querySelector("#dr-tab-" + g);
    b.setAttribute("aria-selected", String(g === f));
    b.tabIndex = g === f ? 0 : -1;
  }
  ui.panel.setAttribute("aria-labelledby", "dr-tab-" + f);
  paintPanel();
  // the new format fades in (opacity, 200ms, the one curve), as the Deck tier list's list switch does; still under reduced motion
  if (ui.panel.animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    ui.panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "cubic-bezier(.4, 0, .2, 1)" });
  }
}

function paintPanel() {
  const build = { conquest: conquestPanel, "fearless-draft": draftPanel, fearless: () => ingamePanel("fearless"), draft: () => ingamePanel("draft") }[S.fmt];
  ui.panel.replaceChildren(h("h2.sr", t("dr.fn." + KEY[S.fmt])), ...build());
  if (started) compute();
}

/** Recomputes the shown format's answer (the first call also loads the model). */
function compute() {
  started = true;
  if (ui.compute) ui.compute();
}

/** Replaces a row of controls and keeps the keyboard where it was: the button at the same place in the new row. */
function swap(old, next) {
  const had = old && old.contains(document.activeElement) ? [...old.querySelectorAll("button")].indexOf(document.activeElement) : -1;
  old.replaceWith(next);
  if (had >= 0) {
    const b = next.querySelectorAll("button")[had];
    if (b && !b.disabled) b.focus();
  }
  return next;
}

/** A figure that is not the head's: its basis as its title for the pointer and as words for a screen reader. */
const figTip = (p, desc) => [h("span.dr-alt-p", { title: desc }, fig(p)), h("span.sr", desc)];

/** An offers line said aloud once it settles (the "Without these cards" row's grammar). */
const sayOffers = (voice, label, cards) => voice.say(label.replace(/\s*:\s*$/, "") + ": " + cards.map(cardName).join(", "));

// ---------------------------------------------------------------- the answer box
/**
 * Where a call's answer is drawn (DESIGN.md "Draft tab", the answer): its states are drawn, never a hole. Loading the model (the
 * clock and its line), a call running (the last answer stays at .45, so nothing collapses), the answer, a waiting state (one line:
 * what to enter first), an error with "Try again". One polite live region says the answer's head once it lands.
 */
function answerBox(cls = "") {
  const inner = h("div.dr-ans-in");
  const status = h("p.sr", { role: "status" });
  const el = h("section.dr-ans" + cls, { "aria-busy": "false", tabindex: "-1" }, [inner, status]);
  const set = (state) => { el.dataset.state = state; el.setAttribute("aria-busy", String(state === "busy" || state === "loading")); };
  const note = (glyph, text, more = []) => h("div.dr-note", [icon(glyph, 24), h("p", text), ...more]);
  return {
    el,
    loading() { set("loading"); inner.replaceChildren(note("clock", t("dr.loading"))); status.textContent = t("dr.loading"); },
    // a call: the last answer stays at .45 under the bar; with no answer yet, one bright line says what is happening
    busy() {
      if (["done", "busy"].includes(el.dataset.state)) { set("busy"); status.textContent = t("dr.busy"); return; }
      if (!live) { this.loading(); return; }
      set("loading"); inner.replaceChildren(note("clock", t("dr.busy"))); status.textContent = t("dr.busy");
    },
    wait(text) { set("wait"); inner.replaceChildren(note("info", text)); status.textContent = ""; },
    error(text, retry) {
      set("error");
      inner.replaceChildren(note("info", text, retry ? [h("button.btn", { type: "button", onclick: retry }, t("err.retry"))] : []));
      status.textContent = text;
    },
    show(nodes, said) { set("done"); inner.replaceChildren(...[].concat(nodes).filter(Boolean)); status.textContent = said || ""; },
  };
}

/** Runs one panel's calls: only the latest answer is drawn; a failed model load or call draws its error with "Try again". */
function runner(box, paint) {
  let n = 0;
  return async (requests, ctx) => {
    const my = ++n;
    box.busy();
    try {
      const out = [];
      for (const r of [].concat(requests)) out.push(await ask(r));
      if (my !== n || !box.el.isConnected) return;
      paint(Array.isArray(requests) ? out : out[0], ctx);
    } catch (e) {
      if (my !== n || !box.el.isConnected) return;
      if (e.code !== "noWorker") console.error(e);
      const retry = () => compute();
      if (e.code === "noWorker") box.error(t("dr.noWorker"));
      else if (e.code === "call") box.error(t("dr.callErr"), retry);
      else box.error(t("dr.loadErr"), retry);
    }
  };
}

/** The head of an answer: the call (an imperative, Headline 28), its win chance big with its basis beside it, then the deck's
 * evidence (`ev`). A win chance within 5 points of even reads "Toss-up" (a word that explains itself; the lead's rule: a close
 * call reads as a toss-up, not a pick) and the call becomes its lean, one step smaller. */
function verdict(call, p, basis, { imperative = true, ev = null, level = 3 } = {}) {
  const close = toss(p);
  const [tb, td] = close ? tipButton("button.dr-toss" + (imperative ? "" : ".dr-toss-s"), t("dr.toss"), t("dr.toss"), t("dr.tossTip")) : [null, null];
  return h("div.dr-vh", [
    h(`h${level}.dr-call`, close && imperative ? [tb, td, h("span.sr", ". " + t("dr.lean", { what: call }))] : call),
    close && imperative ? h("p.dr-lean", { "aria-hidden": "true" }, t("dr.lean", { what: call })) : null,
    h("div.dr-fig", [h("b.dr-p", fig(p)), close && !imperative ? h("span.dr-tossw", [tb, td]) : null, h("p.dr-basis", basis)]),
    ev ? h("p.dr-evl", ev) : null,
  ]);
}

// ---------------------------------------------------------------- evidence marks
/** A deck's evidence (the lead's three states): estimate when the four cards were never played together, measured when the
 * exact talents were, composed otherwise; a quiet word with its glyph that explains itself. `full` the card set's full-AI games
 * (null when the answer does not say), `variant` the exact talents' games. */
function evidence(full, variant, their = false) {
  if (full !== 0 && variant == null) return null;
  const state = full === 0 ? "estimate" : variant > 0 ? "measured" : "composed";
  const word = t("dr.ev." + state);
  const desc = state === "measured" ? t("dr.ev.measuredTip", { n: variant })
    : state === "estimate" ? t("dr.ev.estimateTip")
      : full ? t("dr.ev.composedTip", { n: full }) : t("dr.ev.composedTip0");
  const [b, d] = tipButton("button.dr-ev.ev-" + state, their ? t("dr.ev.their", { what: word }) : word,
    [h("i.ev-g", { "aria-hidden": "true" }), h("span", their ? t("dr.ev.their", { what: word }) : word)], desc);
  return h("span.dr-evw", [b, d]);
}

/** A talent the data never saw on that card: the dashed mark after its name, its tooltip the reason. */
function guessed(c, level) {
  const tl = c.talents[level - 1];
  const [b, d] = tipButton("button.dr-gm", t("dr.ev.guessed"), [h("i.ev-g", { "aria-hidden": "true" }), h("span.sr", t("dr.ev.guessed"))],
    t("dr.ev.guessedTip", { card: cardName(c), talent: tl ? L(tl, "name") : "—" }));
  return [b, d];
}

const talentName = (c, level) => (level > 0 && c.talents[level - 1] ? L(c.talents[level - 1], "name") : "—");

/** "Your talents: Brut, Focus, …" for a tooltip. */
const talentLine = (who, cs, levels) => t("dr.tlLine", { who: t(who), list: cs.map((c, q) => `${cardName(c)} (${talentName(c, levels[q])})`).join(t("ui.comma")) });

/** My deck to play, drawn as its four game cards with the talent under each (the Deck tier list's slot), a guessed talent marked. */
function deckCards(cs, levels, mo = []) {
  return h("div.deck-cards.dr-cards", cs.map((c, q) => {
    const s = deckSlot(c, levels[q] - 1);
    const line = s.querySelector(".slot-tl");
    if (line && mo[q]) line.append(...guessed(c, levels[q]));
    return s;
  }));
}

/** A compact deck: four cells, the card's small art, its name and the talent it plays, a guessed talent marked; `levels` null for
 * a deck whose talents are not settled. */
function deckLine(cs, levels = null, mo = [], cls = "") {
  return h("ul.dr-line" + cls, cs.map((c, q) => h("li.dr-cell", [
    h("button.dr-cc", { type: "button", "data-card": c.key, ...(levels ? { "data-talent": String(levels[q] - 1) } : {}), title: t("card.show", { name: cardName(c) }) }, [
      thumb(c), h("span.dr-cn", [h("span.dr-name", { translate: "no" }, cardName(c)),
        levels ? h("span.dr-tl", { lang: getLang() }, talentName(c, levels[q])) : null]),
    ]),
    levels && mo[q] ? h("span.dr-gmw", guessed(c, levels[q])) : null,
  ])));
}

// ---------------------------------------------------------------- your cards and the talents you lack
/** "Your cards": every card or only the collection (disabled, saying why, under `min` cards). */
function yours(min) {
  const n = ownedKeys().size;
  const few = n < min;
  if (few && S.mine) S.mine = false;
  const b = (on_, label, extra = {}) => h("button", { type: "button", "aria-pressed": String(S.mine === on_), onclick: () => { if (S.mine !== on_) { S.mine = on_; paintYours(); compute(); } }, ...extra }, label);
  ui.yours = h("div.dr-row", [
    h("span.dr-l", { id: "dr-yours-l" }, t("dr.yours")),
    h("div.seg", { role: "group", "aria-labelledby": "dr-yours-l" }, [
      b(false, t("dr.all")),
      b(true, [t("dr.mine"), h("span.dr-n", fmtInt(n))], { disabled: few, title: !n ? t("dr.mineOff") : few ? t("dr.mineFew", { n, min }) : t("dr.mineOn", { n }) }),
    ]),
  ]);
  ui.yoursMin = min;
  return ui.yours;
}

function paintYours() {
  if (ui.yours && ui.yours.isConnected) swap(ui.yours, yours(ui.yoursMin));
}

/** "Talents you don't have": a text disclosure holding a card field and, per card added, its talents as toggles (pressed: you
 * have it; one at least stays). The advice keeps my side to the talents left (`myTalents` of every request). */
function talents() {
  const btn = h("button.tdisc.dr-tdisc", { type: "button", "aria-controls": "dr-tl-r" }, [h("span", t("dr.tl.label")), h("span.dr-n"), icon("chevron")]);
  const rows = h("ul.dr-tl-rows", { "aria-label": t("dr.tl.list") });
  const line = h("p.fd-sug.dr-sug");
  const voice = announcer();
  let q = "";
  const field = searchField({ id: "dr-tl-q", name: "talent-card", placeholder: t("dr.tl.ph"), label: t("dr.tl.label"), clearLabel: t("cx.clearSearch"),
    onChange: (v) => { q = v; paintLine(); }, onEnter: () => { const f = line.querySelector("button:not(:disabled)"); if (f && q.trim()) f.click(); } });
  // the offers line says what the block does while nothing is typed (the Conquest field's grammar): no hole under the field
  const region = h("div#dr-tl-r", h("div.collapse-in", h("div.dr-tlb", [h("div.dr-field", field.el), line, rows])));
  disclosure(btn, region, { open: ui.tlOpen || false, onToggle: (v) => { ui.tlOpen = v; } });

  function paintLine() {
    const ts = terms(q);
    if (!ts.length) { line.replaceChildren(h("span.fd-sug-l", t("dr.tl.hint"))); return; }
    const found = namedCards(ts).filter((c) => c.talents.length > 1);
    if (!found.length) { line.replaceChildren(h("span", t("find.noCard", { q: q.trim() }))); voice.say(t("find.noCard", { q: q.trim() })); return; }
    sayOffers(voice, t("dr.tl.offer"), found.slice(0, SEARCH()));
    line.replaceChildren(h("span.fd-sug-l", t("dr.tl.offer")), ...found.slice(0, SEARCH()).map((c) => {
      const done = S.locked.has(c), say = done ? t("dr.tl.already", { name: cardName(c) }) : t("dr.tl.add", { name: cardName(c) });
      return h("button.chip.fd-add", { type: "button", disabled: done, title: say, "aria-label": say, onclick: () => {
        S.locked.set(c, new Set());
        q = ""; field.set(""); paintLine(); paintRows(); field.input.focus();
      } }, [h("img", { class: "cc-art", loading: "lazy", decoding: "async", alt: "", width: 18, height: 24, src: `assets/thumbs/s/${c.key}.webp` }),
        h("span.chip-l", { translate: "no" }, cardName(c)), icon("plus")]);
    }));
  }

  function paintRows() {
    const n = [...S.locked.values()].filter((s) => s.size).length;
    btn.querySelector(".dr-n").textContent = n ? fmtInt(n) : "";
    rows.replaceChildren(...[...S.locked].map(([c, lacks]) => h("li.dr-tl-row", [
      chip(c),
      h("div.dr-tl-tg", { role: "group", "aria-label": cardName(c) }, c.talents.map((tl, i) => {
        const level = i + 1, has = !lacks.has(level), last = has && c.talents.length - lacks.size === 1;
        const name = L(tl, "name");
        return h("button.chip.dr-tg", { type: "button", "aria-pressed": String(has), "aria-disabled": last ? "true" : null,
          title: last ? t("dr.tl.last", { talent: name }) : t(has ? "dr.tl.has" : "dr.tl.hasNot", { talent: name }), onclick: () => {
            if (last) return;
            if (has) lacks.add(level); else lacks.delete(level);
            paintRows();
            rows.querySelector(`[data-tg="${c.key}:${level}"]`)?.focus();
            compute();
          }, "data-tg": `${c.key}:${level}` }, [icon("check", 14), h("span.chip-l", { lang: getLang() }, name)]);
      })),
      h("button.fd-x", { type: "button", title: t("dr.tl.remove", { name: cardName(c) }), "aria-label": t("dr.tl.remove", { name: cardName(c) }),
        onclick: () => { S.locked.delete(c); paintRows(); field.input.focus(); compute(); } }, icon("close")),
    ])));
    rows.hidden = !S.locked.size;
  }
  paintRows();
  paintLine();
  return h("div.dr-tlw", [btn, region, voice.el]);
}

/** A list of cards in the dress of "Without these cards" (search.js outRow), with its own words. */
function cardList(id, list, set, words) {
  const w = words ? { label: words + ".label", ph: words + ".ph", hint: words + ".hint", list: words + ".list", offer: "dr.l.offer", add: "dr.l.add",
    already: "dr.l.already", del: "dr.l.del" } : {};
  return outRow({ id, out: list, words: w, onOut: (next) => { set(next); compute(); } }).el;
}

// ---------------------------------------------------------------- in game: Draft and Fearless
function ingamePanel(mode) {
  const box = answerBox();
  const run = runner(box, (r) => paintIngame(box, r));
  const inputs = mode === "fearless"
    ? [cardList("dr-mp", S.fe.mine, (l) => { S.fe.mine = l; }, "dr.mp"), cardList("dr-op", S.fe.opp, (l) => { S.fe.opp = l; }, "dr.op")]
    : [cardList("dr-out", S.ig.out, (l) => { S.ig.out = l; }, "dr.cp")];
  ui.compute = () => {
    const out = mode === "fearless" ? S.fe.mine : S.ig.out;
    const avail = myCards().filter((c) => !out.includes(c));
    if (avail.length < 4) { box.wait(t("dr.ig.few", { n: avail.length })); return; }
    run({ kind: "ingame." + mode, available: ids(avail), myBanned: [], oppBanned: mode === "fearless" ? ids(S.fe.opp) : [], myTalents: myTalents(), top: 3 });
  };
  box.loading();
  return [h("div.dr-in", [yours(4), talents(), ...inputs]), box.el];
}

function paintIngame(box, r) {
  const best = r.decks[0];
  if (!best) { box.wait(t("dr.ig.few", { n: 0 })); return; }
  const syn = r.oppField.synthetic, n = r.oppField.decks - syn;
  const basis = syn ? t("dr.ig.basisSyn", { n, m: syn }) : t("dr.ig.basis", { n });
  const cs = best.cards.map(card);
  const others = r.decks.slice(1).map((d) => h("li.dr-alt", [
    deckLine(d.cards.map(card), d.talents, d.talents_model_only),
    ...figTip(d.win, t("dr.ig.altTip", { p: fig(d.win) })), evidence(d.full_games, d.variant_full_games),
  ]));
  const head = t(S.mine ? "dr.ig.head" : "dr.ig.headAll");      // "Your best deck" only from the visitor's own cards
  box.show([
    verdict(head, best.win, basis, { imperative: false, ev: evidence(best.full_games, best.variant_full_games) }),
    deckCards(cs, best.talents, best.talents_model_only),
    others.length ? h("div.dr-alts", [h("h4.dr-sub", t("dr.ig.next")), h("ul.dr-alt-list", others)]) : null,
  ], `${head}: ${fig(best.win)}`);
}

// ---------------------------------------------------------------- Conquest
function conquestPanel() {
  const prepBox = answerBox(".dr-ans-s");
  const banBox = answerBox();
  const playBox = answerBox();
  const mine = deckSet("me", t("dr.ph"));
  const theirs = deckSet("opp", t("dr.phTheirs"));
  const runPrep = runner(prepBox, (r) => {
    const best = r.results && r.results[0];
    if (!best) { prepBox.wait(t("dr.ig.few", { n: myCards().length })); return; }
    const snap = ui.prepSnap;
    S.cq.me = best.decks.map((d) => d.cards.map(card));
    S.cq.prep = best;
    mine.paint();
    paintPrep(prepBox);
    ui.compute();
    // the decks the visitor had entered (and the match on them) come back in one press
    if (snap && snap.me.some((d) => d.length)) toast(t("dr.cq.replaced"), { label: t("ui.undo"), run: () => restoreMatch(snap) });
  });
  const runBan = runner(banBox, (rs) => paintBan(banBox, rs));
  const runPlay = runner(playBox, (r) => paintPlay(playBox, r));
  ui.playBox = playBox;
  const suggest = h("button.btn.primary.dr-suggest", { type: "button", onclick: () => {
    prepBox.el.hidden = false;                // its loading, its answer or its error
    const avail = myCards();
    if (avail.length < 12) { prepBox.wait(t("dr.mineFew", { n: avail.length, min: 12 })); return; }
    ui.prepSnap = matchSnap();
    S.cq.myBan = S.cq.theirBan = null; S.cq.games = [];
    runPrep({ kind: "conquest.prep", cards: ids(avail), myTalents: myTalents(), top: 1 });
  } }, t("dr.cq.suggest"));
  ui.compute = () => {
    const full = (side) => S.cq[side].every((d) => d.length === 4);
    // the suggestion's box: its answer, or its own loading, running call or error until they resolve
    if (S.cq.prep) paintPrep(prepBox);
    else if (!["loading", "busy", "error"].includes(prepBox.el.dataset.state)) prepBox.el.hidden = true;
    if (!full("me") || !full("opp")) {
      banBox.wait(t("dr.cq.wait"));
      playBox.wait(t("dr.cq.waitAll"));
      if (ui.bans) ui.bans.replaceWith(bansRow());
      return;
    }
    if (ui.bans && ui.bans.hidden) ui.bans.replaceWith(bansRow());
    const mineD = S.cq.me.map((d) => ({ cards: ids(d) })), theirsD = S.cq.opp.map((d) => ({ cards: ids(d) }));
    // the ban, then each of my decks against their first for its card set's games (the contract's winprob describes it); asked
    // again only when a deck or a talent changed, not for a game recorded
    const sig = JSON.stringify([mineD, theirsD, myTalents()]);
    if (sig !== ui.banSig || banBox.el.dataset.state !== "done") {
      ui.banSig = sig;
      runBan([{ kind: "conquest.ban", mine: mineD, theirs: theirsD, myTalents: myTalents() },
        ...mineD.map((a) => ({ kind: "winprob", a, b: theirsD[0], myTalents: myTalents() }))]);
    }
    const myBan = S.cq.myBan, theirBan = S.cq.theirBan;
    if (myBan == null || theirBan == null) { playBox.wait(t("dr.cq.waitBans")); return; }
    const left = (n, banned, beaten) => [0, 1, 2].filter((i) => i !== banned && !beaten.includes(i));
    const mineLeft = left(3, theirBan, S.cq.games.filter((g) => g.won).map((g) => g.a));
    const theirsLeft = left(3, myBan, S.cq.games.filter((g) => !g.won).map((g) => g.b));
    runPlay({ kind: "conquest.order", mine: mineD, theirs: theirsD, mineLeft, theirsLeft, myTalents: myTalents() });
  };
  banBox.wait(t("dr.cq.wait"));
  playBox.wait(t("dr.cq.waitAll"));
  prepBox.el.hidden = true;
  return [
    h("div.dr-in", [yours(12), talents()]),
    step(1, t("dr.cq.s1"), [h("div.dr-step-act", suggest), mine.el, prepBox.el]),
    step(2, t("dr.cq.s2"), [theirs.el]),
    step(3, t("dr.cq.s3"), [banBox.el]),
    step(4, t("dr.cq.s4"), [bansRow(), playBox.el, gamesLog()]),
  ];
}

/** A numbered step of a sequence (Conquest: decks, theirs, ban, games): the number is the order the match follows. */
function step(n, title, kids) {
  return h("section.dr-step", { "aria-labelledby": "dr-step-" + n }, [
    h("h3.dr-step-h#dr-step-" + n, [h("span.dr-step-n", { "aria-hidden": "true" }, String(n)), title]), ...kids,
  ]);
}

/**
 * One side's three decks (Conquest): one card field for the side, its offers under it, then three rows of four slots; a card
 * goes to the first empty slot, a slot's cross frees it, and a card already in a deck of this side is offered disabled with
 * where it is. 12 different cards a side (the format's rule).
 */
function deckSet(side, ph) {
  let q = "";
  const field = searchField({ id: "dr-q-" + side, name: "deck-card", placeholder: ph, label: t(side === "me" ? "dr.cq.s1" : "dr.cq.s2"), clearLabel: t("cx.clearSearch"),
    onChange: (v) => { q = v; paintLine(); }, onEnter: () => { const f = line.querySelector("button:not(:disabled)"); if (f && q.trim()) f.click(); } });
  const line = h("p.fd-sug.dr-sug");
  const rows = h("ol.dr-decks", { "aria-label": t(side === "me" ? "dr.cq.s1" : "dr.cq.s2") });
  const voice = announcer();
  const clear = h("button.btn.ghost.dr-clear", { type: "button", title: t(side === "me" ? "dr.cq.clearMine" : "dr.cq.clearTheirs"), onclick: () => {
    const snap = matchSnap();
    S.cq[side] = [[], [], []]; if (side === "me") S.cq.prep = null; resetMatch(); paint(); field.input.focus(); ui.compute();
    toast(t(side === "me" ? "dr.cq.clearedMine" : "dr.cq.clearedTheirs"), { label: t("ui.undo"), run: () => restoreMatch(snap) });
  } }, t("dr.cq.clear"));
  const D = () => S.cq[side];
  const where = (c) => D().findIndex((d) => d.includes(c));
  const firstFree = () => D().findIndex((d) => d.length < 4);

  function add(c) {
    const k = firstFree();
    if (k < 0 || where(c) >= 0) return;
    const snap = matchSnap();
    D()[k] = [...D()[k], c];
    if (side === "me") S.cq.prep = null;
    resetMatch();
    q = ""; field.set("");
    paint();
    voice.say(t("dr.added", { name: cardName(c), n: k + 1 }));
    if (firstFree() >= 0) field.input.focus();
    ui.compute();
    gamesBack(snap);
  }

  function paintLine() {
    const ts = terms(q), k = firstFree();
    line.classList.toggle("full", k < 0);
    if (k < 0) { line.replaceChildren(); return; }
    if (!ts.length) { line.replaceChildren(h("span.fd-sug-l", t("dr.cq.hint"))); return; }
    const found = namedCards(ts);
    if (!found.length) { line.replaceChildren(h("span", t("find.noCard", { q: q.trim() }))); voice.say(t("find.noCard", { q: q.trim() })); return; }
    sayOffers(voice, t("dr.deckTo", { n: k + 1 }), found.slice(0, SEARCH()));
    line.replaceChildren(h("span.fd-sug-l", t("dr.deckTo", { n: k + 1 })), ...found.slice(0, SEARCH()).map((c) => {
      const w = where(c), say = w >= 0 ? t("dr.inDeck", { name: cardName(c), n: w + 1 }) : t("dr.addTo", { name: cardName(c), n: k + 1 });
      return h("button.chip.fd-add", { type: "button", disabled: w >= 0, title: say, "aria-label": say, onclick: () => add(c) },
        [h("img", { class: "cc-art", loading: "lazy", decoding: "async", alt: "", width: 18, height: 24, src: `assets/thumbs/s/${c.key}.webp` }),
          h("span.chip-l", { translate: "no" }, cardName(c)), icon("plus")]);
    }));
  }

  function paint() {
    const full = firstFree() < 0;
    field.input.disabled = full;
    field.input.placeholder = full ? t("dr.phFull") : ph;
    field.el.classList.toggle("off", full);
    field.el.title = full ? t("dr.fullTitle") : "";
    const free = firstFree();
    rows.replaceChildren(...D().map((d, k) => h("li.dr-deck", [
      h("span.dr-deck-n", t("dr.deckN", { n: k + 1 })),
      h("ul.fd-slots.dr-slots", Array.from({ length: 4 }, (_, i) => slot(d[i], k === free && i === d.length))),
      h("span.dr-deck-ev", { "data-k": String(k) }),
    ])));
    clear.disabled = !D().some((d) => d.length);
    clear.title = t(clear.disabled ? "dr.cq.clearNone" : side === "me" ? "dr.cq.clearMine" : "dr.cq.clearTheirs");
    paintLine();
  }

  function slot(c, firstEmpty) {
    if (!c) {
      return firstEmpty
        ? h("li.fd-slot", h("button.fd-empty", { type: "button", onclick: () => field.input.focus() }, [icon("plus"), h("span", t("dr.slotEmpty"))]))
        : h("li.fd-slot.idle", icon("plus"));
    }
    const name = cardName(c);
    return h("li.fd-slot.on", [
      h("button.fd-card", { type: "button", "data-card": c.key, title: t("card.show", { name }) }, [
        h("img", { class: "fd-art", loading: "lazy", decoding: "async", alt: "", width: 24, height: 34, src: `assets/thumbs/s/${c.key}.webp` }),
        h("span.fd-name", { translate: "no" }, name),
      ]),
      h("button.fd-x", { type: "button", "aria-label": t("dr.remove", { name }), title: t("dr.remove", { name }), onclick: () => {
        const k = where(c), snap = matchSnap();
        D()[k] = D()[k].filter((x) => x !== c);
        if (side === "me") S.cq.prep = null;
        resetMatch(); paint(); field.input.focus(); ui.compute();
        gamesBack(snap);
      } }, icon("close")),
    ]);
  }

  paint();
  return { el: h("div.dr-set", { "data-side": side }, [h("div.dr-set-f", [h("div.dr-field", field.el), clear]), line, rows, voice.el]), paint };
}

/** The match as it stands (decks, suggestion, bans, games), for an undo. */
function matchSnap() {
  return { me: S.cq.me.map((d) => d.slice()), opp: S.cq.opp.map((d) => d.slice()), prep: S.cq.prep, myBan: S.cq.myBan, theirBan: S.cq.theirBan,
    games: S.cq.games.slice(), guess: ui.banGuess };
}

function restoreMatch(s) {
  Object.assign(S.cq, { me: s.me, opp: s.opp, prep: s.prep, myBan: s.myBan, theirBan: s.theirBan, games: s.games });
  ui.banGuess = s.guess; ui.banSig = null;
  if (S.fmt === "conquest") paintPanel();
}

/** A change that dropped recorded games says so, with Undo. */
function gamesBack(snap) {
  if (snap && snap.games.length) toast(t("dr.cq.restarted", { n: snap.games.length }), { label: t("ui.undo"), run: () => restoreMatch(snap) });
}

/** A change of either side's decks restarts the match: the bans and the games recorded go. */
function resetMatch() {
  S.cq.myBan = S.cq.theirBan = null;
  S.cq.games = [];
  if (ui.bans) ui.bans.replaceWith(bansRow());
  if (ui.log) ui.log.replaceWith(gamesLog());
}

function paintPrep(box) {
  const r = S.cq.prep;
  if (!r) { box.el.hidden = true; return; }
  box.el.hidden = false;
  box.show([
    verdict(t("dr.cq.suggestHead"), r.value, t("dr.cq.suggestBasis"), { imperative: false, level: 4 }),
    h("ol.dr-prep", r.decks.map((d, k) => h("li", [
      h("span.dr-deck-n", t("dr.deckN", { n: k + 1 })),
      deckLine(d.cards.map(card), d.talents),
      ...figTip(d.fieldWin, t("dr.cq.fieldWin", { p: fig(d.fieldWin) })),
      evidence(d.full_games, null),
    ]))),
  ], `${t("dr.cq.suggestHead")}: ${fig(r.value)}`);
  // the prep's decks carry their card set's games: an "estimate" mark when they were never played together
  for (const [k, d] of r.decks.entries()) {
    const el = root.querySelector(`.dr-set[data-side="me"] .dr-deck-ev[data-k="${k}"]`);
    if (el) el.replaceChildren(d.full_games === 0 ? evidence(0, 0) : "");
  }
}

/** The 3 x 3 matrix's cell: my win chance, a word that explains itself (both sides' talents and the evidence in its tooltip). */
function cell(p, tp, mineCs, theirCs) {
  const ev = (n) => t(n > 0 ? "dr.ev.measured" : "dr.ev.composed");
  const mo = (tp.our_talents_model_only || []).some(Boolean) || (tp.their_best_response_model_only || []).some(Boolean);
  const desc = [t("dr.winTip", { p: fig(p) }), talentLine("dr.yourTl", mineCs, tp.our_talents), talentLine("dr.theirTl", theirCs, tp.their_best_response),
    t("dr.ev.pair", { ours: ev(tp.our_variant_full_games), theirs: ev(tp.their_variant_full_games) }), mo ? t("dr.ev.someGuessed") : ""].filter(Boolean).join(" ");
  const [b, d] = tipButton("button.dr-mxc" + (toss(p) ? ".dr-even" : ""), fig(p), [h("span", fig(p)), mo ? h("i.ev-g.gm", { "aria-hidden": "true" }) : null], desc);
  return h("td", [b, d]);
}

function paintBan(box, rs) {
  const [r, ...wp] = rs;
  const opp = S.cq.opp, me = S.cq.me;
  // each of my decks: its card set's games (an estimate mark when never played together)
  wp.forEach((w, k) => {
    const el = root.querySelector(`.dr-set[data-side="me"] .dr-deck-ev[data-k="${k}"]`);
    if (el) el.replaceChildren(w.a.full_games === 0 ? evidence(0, 0) : "");
  });
  r.options.forEach((o) => {
    const el = root.querySelector(`.dr-set[data-side="opp"] .dr-deck-ev[data-k="${o.ban}"]`);
    if (el) el.replaceChildren(o.deck.full_games === 0 ? evidence(0, 0, true) : "");
  });
  const b = r.recommend.ban;
  const opts = r.options.slice().sort((x, y) => y.worstCase - x.worstCase).map((o) => h("li.dr-opt" + (o.ban === b ? ".best" : ""), [
    h("span.dr-opt-l", t("dr.cq.banOpt", { n: o.ban + 1 })), deckLine(opp[o.ban], null, [], ".mini"),
    ...figTip(o.worstCase, t("dr.cq.banOptTip", { n: o.ban + 1, p: fig(o.worstCase) })),
  ]));
  const eq = r.equilibrium;
  const mixed = eq && eq.value - r.recommend.worstCase > 0.01 && eq.myBan && eq.myBan.filter((x) => x > 0.01).length > 1
    ? h("p.dr-note-s", t("dr.cq.mixed", { list: eq.myBan.map((x, i) => (x > 0.01 ? t("dr.cq.mixPart", { n: i + 1, p: fig(x) }) : null)).filter(Boolean).join(t("ui.comma")) }))
    : null;
  const mxBtn = h("button.tdisc", { type: "button", "aria-controls": "dr-mx" }, [h("span", t("dr.cq.every")), icon("chevron")]);
  const mx = h("div#dr-mx", h("div.collapse-in", h("div.dr-mxw", h("table.dr-mx", [
    h("caption.dr-mx-c", t("dr.cq.mx")),
    h("thead", h("tr", [h("td"), ...opp.map((d, j) => h("th", { scope: "col" }, [h("span.dr-mx-h", t("dr.cq.mxTheirs", { n: j + 1 })), h("span.dr-mx-t", d.map((c) => thumb(c, 18, 24)))]))])),
    h("tbody", me.map((d, i) => h("tr", [h("th", { scope: "row" }, [h("span.dr-mx-h", t("dr.cq.mxYours", { n: i + 1 })), h("span.dr-mx-t", d.map((c) => thumb(c, 18, 24)))]),
      ...opp.map((o, j) => cell(r.P[i][j], r.talents[i][j], d, o))]))),
  ]))));
  disclosure(mxBtn, mx, { open: ui.mxOpen || false, onToggle: (v) => { ui.mxOpen = v; } });
  box.show([
    verdict(t("dr.cq.ban", { n: b + 1 }), r.recommend.worstCase, t("dr.cq.banBasis"), { level: 4 }),
    h("ol.dr-opts", opts),
    mixed,
    h("div.dr-mxd", [mxBtn, mx]),
  ], `${t("dr.cq.ban", { n: b + 1 })}: ${fig(r.recommend.worstCase)}`);
  // the recommended ban fills "You banned" until the visitor says otherwise
  if (S.cq.myBan == null && ui.bans) { ui.banGuess = b; ui.bans.replaceWith(bansRow()); }
}

/** "You banned their deck [1 2 3]" and "They banned your deck [1 2 3 | Not yet]": the two bans the games start from. */
function bansRow() {
  const ready = ["me", "opp"].every((side) => S.cq[side].every((d) => d.length === 4));
  const seg = (label, val, pick, options) => h("div.dr-row", [
    h("span.dr-l", label),
    h("div.seg", { role: "group", "aria-label": label }, options.map(([v, text, title]) => h("button", { type: "button", "aria-pressed": String(val === v), title,
      onclick: () => {
        const snap = matchSnap();
        pick(v); S.cq.games = []; swap(ui.bans, bansRow()); if (ui.log) ui.log.replaceWith(gamesLog()); ui.compute();
        gamesBack(snap);
      } }, text))),
  ]);
  // my ban starts at the call (my own move); theirs is "Not yet" until the visitor says it
  const mine = S.cq.myBan ?? ui.banGuess ?? null;
  ui.bans = h("div.dr-bans", { hidden: !ready }, ready ? [
    seg(t("dr.cq.youBanned"), mine, (v) => { S.cq.myBan = v; }, [0, 1, 2].map((i) => [i, t("dr.cq.theirN", { n: i + 1 }), names(S.cq.opp[i])])),
    seg(t("dr.cq.theyBanned"), S.cq.theirBan, (v) => { S.cq.theirBan = v; if (S.cq.myBan == null) S.cq.myBan = mine; },
      [[null, t("dr.cq.notYet")], ...[0, 1, 2].map((i) => [i, t("dr.cq.yourN", { n: i + 1 }), names(S.cq.me[i])])]),
  ] : []);
  return ui.bans;
}

/** A deck's four card names, for the title of a button that names it by its number. */
const names = (cs) => cs.map(cardName).join(t("ui.comma"));

function paintPlay(box, r) {
  const me = S.cq.me, opp = S.cq.opp;
  if (r.done) {
    box.show(h("div.dr-vh", h("h4.dr-call", t(r.value >= 0.5 ? "dr.cq.matchWon" : "dr.cq.matchLost"))), t(r.value >= 0.5 ? "dr.cq.matchWon" : "dr.cq.matchLost"));
    paintRecord(null, r);
    return;
  }
  const k = r.recommend.deck;
  const theirsLeft = r.theirPlay.map((x) => x.deck);
  const vs = theirsLeft.map((j) => {
    const p = r.P[k][j], tp = r.talents[k][j];
    const [b, d] = tipButton("button.dr-vsb", t("dr.cq.vs", { n: j + 1 }), [h("span", t("dr.cq.vs", { n: j + 1 })), h("b", fig(p))],
      [t("dr.winTip", { p: fig(p) }), talentLine("dr.yourTl", me[k], tp.our_talents), talentLine("dr.theirTl", opp[j], tp.their_best_response)].join(" "));
    return h("li", [b, d]);
  });
  const mix = r.play.filter((x) => x.prob > 0.01);
  box.show([
    verdict(t("dr.cq.play", { n: k + 1 }), r.value, t("dr.cq.playBasis"), { level: 4 }),
    mix.length > 1 ? h("p.dr-note-s", t("dr.cq.mixPlay", { list: mix.map((x) => t("dr.cq.mixPart", { n: x.deck + 1, p: fig(x.prob) })).join(t("ui.comma")) })) : null,
    deckLine(me[k]),
    h("ul.dr-vs", vs),
  ], `${t("dr.cq.play", { n: k + 1 })}: ${fig(r.value)}`);
  paintRecord(k, r);
}

/** The games played so far, the result of the next one to record ("You played [deck]", "They played [deck]", I won / I lost),
 * and Undo. */
function gamesLog() {
  ui.log = h("div.dr-log", [h("ol.dr-games"), h("div.dr-rec")]);
  paintGames();
  return ui.log;
}

function paintGames() {
  if (!ui.log) return;
  const list = ui.log.querySelector(".dr-games");
  list.replaceChildren(...S.cq.games.map((g, i) => h("li", t(g.won ? "dr.cq.wonLine" : "dr.cq.lostLine", { n: i + 1, a: g.a + 1, b: g.b + 1 }))));
  list.hidden = !S.cq.games.length;
}

function paintRecord(k, r) {
  const me = S.cq.me, opp = S.cq.opp;
  paintGames();
  const rec = ui.log && ui.log.querySelector(".dr-rec");
  if (!rec) return;
  const undo = S.cq.games.length ? h("button.btn.ghost", { type: "button", onclick: () => { S.cq.games.pop(); paintGames(); ui.compute(); } }, t("dr.cq.undo")) : null;
  if (k == null) { rec.replaceChildren(...[undo, h("button.btn", { type: "button", onclick: () => { S.cq.games = []; S.cq.myBan = S.cq.theirBan = null; ui.banGuess = null; ui.bans.replaceWith(bansRow()); paintGames(); ui.compute(); } }, t("dr.cq.again"))].filter(Boolean)); return; }
  const mineLeft = r.play.map((x) => x.deck), theirsLeft = r.theirPlay.map((x) => x.deck);
  // my deck starts at the call (my own move); theirs is set by the visitor, unless only one is left
  let a = k, b = theirsLeft.length === 1 ? theirsLeft[0] : null;
  const seg = (label, val, options, decks, set) => h("div.dr-row", [h("span.dr-l", label), options.length === 1
    ? h("span.dr-v", { title: names(decks[options[0]]) }, t("dr.deckN", { n: options[0] + 1 }))      // the one deck left: a fact, not a choice
    : h("div.seg", { role: "group", "aria-label": label }, options.map((v) => h("button", { type: "button", "aria-pressed": String(v === val), title: names(decks[v]), onclick: (e) => {
      set(v); e.currentTarget.parentNode.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === e.currentTarget)));
    } }, t("dr.deckN", { n: v + 1 }))))]);
  const result = (won) => h("button.btn", { type: "button", disabled: b == null, title: b == null ? t("dr.cq.pickTheirs") : null,
    onclick: () => { S.cq.games.push({ a, b, won }); ui.compute(); if (ui.playBox) ui.playBox.el.focus({ preventScroll: true }); } }, t(won ? "dr.cq.won" : "dr.cq.lost"));
  const results = [result(true), result(false)];
  const n = S.cq.games.length + 1;
  rec.replaceChildren(
    h("h4.dr-sub", t("dr.cq.game", { n })),
    seg(t("dr.cq.youPlayed"), a, mineLeft, me, (v) => { a = v; }),
    seg(t("dr.cq.theyPlayed"), b, theirsLeft, opp, (v) => { b = v; results.forEach((x) => { x.disabled = false; x.title = ""; }); }),
    h("div.dr-acts", [...results, undo]),
  );
}

// ---------------------------------------------------------------- Fearless draft
// Per game (draft.js SEQUENCE), F the side picking first: F pick, S pick, F pick, S pick, F ban, S ban, S pick, F pick, S pick, F
// pick. A card picked in an earlier game is gone for both (`used`); a ban lasts one game.
const ORDER = [["F", "pick"], ["S", "pick"], ["F", "pick"], ["S", "pick"], ["F", "ban"], ["S", "ban"], ["S", "pick"], ["F", "pick"], ["S", "pick"], ["F", "pick"]];
const actorAt = (s) => (ORDER[s][0] === "F" ? S.fd.first : S.fd.first === "me" ? "opp" : "me");

function draftPanel() {
  const box = answerBox();
  ui.box = box;
  const run = runner(box, (r, ctx) => (ctx === "final" ? paintFinal(box, r) : paintNext(box, r)));
  ui.board = h("div.dr-board");
  ui.track = h("ol.dr-track", { "aria-label": t("dr.fd.steps") });
  ui.lanes = h("div.dr-lanes", [h("div.dr-lane-l", { "aria-hidden": "true" }, [h("span", t("dr.fd.me")), h("span", t("dr.fd.opp"))]), ui.track]);
  ui.fdIn = h("div.dr-in");
  paintFdIn();
  ui.compute = () => {
    paintBoard();
    const st = S.fd.steps, s = st.length;
    if (s >= ORDER.length) {
      run({ kind: "winprob", a: { cards: ids(st.filter((x) => x.actor === "me" && x.action === "pick").map((x) => x.card)) },
        b: { cards: ids(st.filter((x) => x.actor === "opp" && x.action === "pick").map((x) => x.card)) }, myTalents: myTalents() }, "final");
      return;
    }
    run({ kind: "fearless_draft.next", first: S.fd.first, used: ids(S.fd.used),
      picks: { me: st.filter((x) => x.actor === "me" && x.action === "pick").map((x) => ({ card: x.card.id })),
        opp: st.filter((x) => x.actor === "opp" && x.action === "pick").map((x) => ({ card: x.card.id })) },
      bans: st.filter((x) => x.action === "ban").map((x) => ({ by: x.actor, card: x.card.id })), myTalents: myTalents() }, "next");
  };
  box.loading();
  paintBoard();
  return [ui.fdIn, ui.lanes, box.el, ui.board];
}

/** What the visitor knows in a Fearless draft: who picks first (set before the first step), the cards gone, the talents. */
function paintFdIn() {
  ui.fdIn.replaceChildren(firstSeg(), cardList("dr-used", S.fd.used, (l) => { S.fd.used = l; }, "dr.us"), talents());
}

function firstSeg() {
  const locked = S.fd.steps.length > 0;
  ui.first = h("div.dr-row", [h("span.dr-l", { id: "dr-first-l" }, t("dr.fd.first")),
    h("div.seg", { role: "group", "aria-labelledby": "dr-first-l" }, [["me", t("dr.fd.me")], ["opp", t("dr.fd.opp")]].map(([v, label]) =>
      h("button", { type: "button", "aria-pressed": String(S.fd.first === v), disabled: locked, title: locked ? t("dr.fd.firstLocked") : null, onclick: () => {
        if (S.fd.first === v || S.fd.steps.length) return;
        S.fd.first = v; paintFirst(); compute();
      } }, label)))]);
  return ui.first;
}

function paintFirst() {
  if (ui.first && ui.first.isConnected) swap(ui.first, firstSeg());
}

/** A new step or an undo: the inputs and the answer stay where they are (the last answer at .45 while the next is worked out),
 * so the call and its button never leave the screen. */
function stepped() {
  paintFirst();
  compute();
  const box = ui.box && ui.box.el;
  if (!box) return;
  const top = box.getBoundingClientRect().top, chrome = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--chrome-h")) || 0;
  if (top < chrome) box.scrollIntoView({ block: "start" });
  box.focus({ preventScroll: true });
}

/** Cards no longer in this game's pool: gone from earlier games, picked or banned in this one. */
const taken = () => new Set([...S.fd.used, ...S.fd.steps.map((x) => x.card)]);

function paintBoard() {
  const st = S.fd.steps;
  ui.track.replaceChildren(...ORDER.map((_, s) => {
    const who = actorAt(s), what = ORDER[s][1], label = t(`dr.fd.s.${who}.${what}`);
    const done = s < st.length, now = s === st.length;
    return h("li.dr-tk" + (done ? ".done" : "") + (now ? ".now" : "") + (who === "me" ? ".me" : ".opp") + (what === "ban" ? ".ban" : ""),
      { "aria-current": now ? "step" : null, title: done ? t("dr.fd.said", { what: label, name: cardName(st[s].card) }) : label, style: { "--col": String(s + 1) } }, [
        h("span.dr-tk-n", { "aria-hidden": "true" }, String(s + 1)), h("span.sr", t("dr.fd.stepN", { n: s + 1, what: label }) + (done ? ", " + cardName(st[s].card) : "")),
      ]);
  }));
  const side = (who) => {
    const picks = st.filter((x) => x.actor === who && x.action === "pick").map((x) => x.card);
    const ban = st.find((x) => x.actor === who && x.action === "ban");
    return h("div.dr-bside", [
      h("h4.dr-sub", t(who === "me" ? "dr.fd.me" : "dr.fd.opp")),
      h("ul.fd-slots.dr-bslots", [...Array.from({ length: 4 }, (_, i) => boardSlot(picks[i])), boardSlot(ban && ban.card, true)]),
    ]);
  };
  ui.board.replaceChildren(h("h3.dr-sub3", t("dr.fd.board")), side("me"), side("opp"),
    h("div.dr-acts", [
      h("button.btn.ghost", { type: "button", disabled: !st.length, title: st.length ? null : t("dr.fd.nothing"), onclick: () => { S.fd.steps.pop(); stepped(); } }, t("dr.fd.undo")),
      h("button.btn.ghost", { type: "button", disabled: !st.length && !S.fd.used.length, title: st.length || S.fd.used.length ? null : t("dr.fd.nothing"), onclick: () => {
        const before = { steps: S.fd.steps.slice(), used: S.fd.used.slice(), first: S.fd.first };
        S.fd.steps = []; S.fd.used = []; paintFdIn(); compute();
        toast(t("dr.fd.restarted"), { label: t("ui.undo"), run: () => { Object.assign(S.fd, before); paintFdIn(); compute(); } });
      } }, t("dr.fd.restart")),
    ]));
}

function boardSlot(c, ban = false) {
  if (!c) return h("li.fd-slot.idle" + (ban ? ".dr-ban" : ""), ban ? h("span.dr-ban-l", t("dr.fd.banSlot")) : icon("plus"));
  // a banned card leads with the minus and reads quieter: it is out of the game, not a fifth card
  const name = cardName(c);
  return h("li.fd-slot.on" + (ban ? ".dr-ban" : ""), h("button.fd-card", { type: "button", "data-card": c.key, title: ban ? t("dr.fd.banned", { name }) : t("card.show", { name }) }, [
    ban ? icon("minus") : null,
    h("img", { class: "fd-art", loading: "lazy", decoding: "async", alt: "", width: 24, height: 34, src: `assets/thumbs/s/${c.key}.webp` }),
    h("span.fd-name", { translate: "no" }, name),
  ]));
}

/** Records a step and asks for the next. */
function take(c) {
  const s = S.fd.steps.length;
  S.fd.steps.push({ actor: actorAt(s), action: ORDER[s][1], card: c });
  stepped();
}

function paintNext(box, r) {
  const me = r.actor === "me", ban = r.action === "ban";
  const c = card(r.recommend.card);
  const call = me ? t(ban ? "dr.fd.ban" : "dr.fd.pick", { name: cardName(c) }) : t(ban ? "dr.fd.theyBan" : "dr.fd.theyPick", { name: cardName(c) });
  const gone = taken();
  const altKey = `dr.fd.alt.${r.actor}.${r.action}`;
  const alts = r.alternatives.slice(0, 3).filter((a) => !gone.has(card(a.card)))
    .map((a) => h("li", [takeChip(card(a.card), r), ...figTip(a.win, t(altKey, { name: cardName(card(a.card)), p: fig(a.win) }))]));
  const f = r.recommend.final;
  const expect = f ? h("div.dr-exp", [
    h("h4.dr-sub", t("dr.fd.expect")),
    h("div.dr-exp-r", [h("span.dr-l", t("dr.fd.yourDeck")), deckLine(f.me.cards.map(card), f.me.our_talents, f.me.our_talents_model_only),
      evidence(null, f.me.our_variant_full_games)]),
    h("div.dr-exp-r", [h("span.dr-l", t("dr.fd.theirDeck")), deckLine(f.opp.cards.map(card), f.opp.their_best_response, f.opp.their_best_response_model_only),
      evidence(null, f.opp.their_variant_full_games, true)]),
  ]) : null;
  const [main, other] = act(r, c);
  box.show([
    h("p.dr-stepl", t("dr.fd.stepN", { n: r.step + 1, what: t(`dr.fd.s.${r.actor}.${r.action}`) })),
    verdict(call, r.win, t("dr.fd.basis")),
    h("div.dr-act", [main, alts.length ? h("div.dr-altl", [h("span.fd-sug-l", t(me ? "dr.fd.alts" : "dr.fd.altsOpp")), h("ul.dr-chips", alts)]) : null, other]),
    expect,
  ], `${call}: ${fig(r.win)}`);
}

/** A card of the pool taken in one press (the offers' chip: its art, its name, plus to pick, minus to ban). */
function takeChip(x, r) {
  const me = r.actor === "me", ban = r.action === "ban";
  const say = t(me ? (ban ? "dr.fd.doBan" : "dr.fd.doPick") : (ban ? "dr.fd.didBan" : "dr.fd.didPick"), { name: cardName(x) });
  return h("button.chip.fd-add", { type: "button", title: say, "aria-label": say, onclick: () => take(x) },
    [h("img", { class: "cc-art", loading: "lazy", decoding: "async", alt: "", width: 18, height: 24, src: `assets/thumbs/s/${x.key}.webp` }),
      h("span.chip-l", { translate: "no" }, cardName(x)), icon(ban ? "minus" : "plus")]);
}

/** The step's actions: the recommended card in one press, or another card of the pool by its name. */
function act(r, c) {
  const me = r.actor === "me", ban = r.action === "ban";
  let q = "";
  const field = searchField({ id: "dr-fd-q", name: "draft-card", placeholder: t(me ? (ban ? "dr.fd.phMeBan" : "dr.fd.phMe") : (ban ? "dr.fd.phOppBan" : "dr.fd.phOpp")),
    label: t(me ? "dr.fd.otherMe" : "dr.fd.otherOpp"), clearLabel: t("cx.clearSearch"),
    onChange: (v) => { q = v; paintLine(); }, onEnter: () => { const b = line.querySelector("button:not(:disabled)"); if (b && q.trim()) b.click(); } });
  const line = h("p.fd-sug.dr-sug");
  const voice = announcer();
  const gone = taken();
  function paintLine() {
    const ts = terms(q);
    if (!ts.length) { line.replaceChildren(); return; }
    const found = namedCards(ts);
    if (!found.length) { line.replaceChildren(h("span", t("find.noCard", { q: q.trim() }))); voice.say(t("find.noCard", { q: q.trim() })); return; }
    sayOffers(voice, t(me ? "dr.fd.otherMe" : "dr.fd.otherOpp"), found.slice(0, SEARCH()));
    line.replaceChildren(...found.slice(0, SEARCH()).map((x) => {
      const out = gone.has(x), say = out ? t("dr.fd.gone", { name: cardName(x) }) : t(me ? (ban ? "dr.fd.doBan" : "dr.fd.doPick") : (ban ? "dr.fd.didBan" : "dr.fd.didPick"), { name: cardName(x) });
      return h("button.chip.fd-add", { type: "button", disabled: out, title: say, "aria-label": say, onclick: () => take(x) },
        [h("img", { class: "cc-art", loading: "lazy", decoding: "async", alt: "", width: 18, height: 24, src: `assets/thumbs/s/${x.key}.webp` }),
          h("span.chip-l", { translate: "no" }, cardName(x)), icon(ban ? "minus" : "plus")]);
    }));
  }
  const main = me ? t(ban ? "dr.fd.doBan" : "dr.fd.doPick", { name: cardName(c) }) : t(ban ? "dr.fd.didBan" : "dr.fd.didPick", { name: cardName(c) });
  return [
    h("button.btn.primary.dr-take", { type: "button", onclick: () => take(c) }, main),
    h("div.dr-other", [h("label.dr-l", { for: "dr-fd-q" }, t(me ? "dr.fd.otherMe" : "dr.fd.otherOpp")), h("div.dr-field", field.el), line, voice.el]),
  ];
}

function paintFinal(box, r) {
  const st = S.fd.steps;
  const mine = st.filter((x) => x.actor === "me" && x.action === "pick").map((x) => x.card);
  const theirs = st.filter((x) => x.actor === "opp" && x.action === "pick").map((x) => x.card);
  const next = h("button.btn.primary.dr-take", { type: "button", onclick: () => {
    S.fd.used = [...S.fd.used, ...mine, ...theirs];
    S.fd.steps = [];
    S.fd.first = S.fd.first === "me" ? "opp" : "me";       // the first pick alternates over the match
    paintFdIn();
    stepped();
  } }, t("dr.fd.next"));
  box.show([
    verdict(t("dr.fd.done"), r.p, t("dr.fd.doneBasis"), { imperative: false }),
    h("div.dr-act", next),
    h("h4.dr-sub", t("dr.fd.yourDeck")),
    deckCards(mine, r.our_talents, r.our_talents_model_only),
    h("p.dr-evl", evidence(r.a.full_games, r.our_variant_full_games)),
    h("h4.dr-sub", t("dr.fd.theirDeck")),
    deckLine(theirs, r.their_best_response, r.their_best_response_model_only),
    h("p.dr-evl", evidence(r.b.full_games, r.their_variant_full_games, true)),
  ], `${t("dr.fd.done")}: ${fig(r.p)}`);
}

// ---------------------------------------------------------------- the footer's Method sub-section
// drawn at once; the lines that count from the model's files (its games, its likely opponents) once it is in
function method() {
  const ai = DB.lists && DB.lists.pilots ? DB.lists.pilots.full : "";
  methodSection("draft", [
    h("ul.vinfo-l", [
      M ? h("li", tx("dr.m.model", { games: fmtInt(M.games), ai: h("span", { translate: "no" }, ai) })) : null,
      h("li", tx("dr.m.talents")),
      h("li", tx("dr.m.marks")),
      h("li", tx("dr.m.toss")),
      M ? h("li", tx("dr.m.field", { n: M.field })) : null,
      h("li", tx("dr.m.conquest")),
      h("li", tx("dr.m.fdraft")),
      h("li", tx("dr.m.ingame")),
      h("li", t("rk.limit.plan_decks")),
    ]),
  ]);
}

// ---------------------------------------------------------------- while the tab lives
// What the visitor entered, kept in sessionStorage (this tab only, dropped when it closes): a phone that drops the tab while the
// visitor checks a chat comes back to the same match. Cards by key; a card the data no longer has drops the part that held it.
function save() {
  const k = (cs) => cs.map((c) => c.key);
  try {
    sessionStorage.setItem(STORE, JSON.stringify({
      fmt: S.fmt, mine: S.mine, locked: [...S.locked].map(([c, lacks]) => [c.key, [...lacks]]),
      ig: { out: k(S.ig.out) }, fe: { mine: k(S.fe.mine), opp: k(S.fe.opp) },
      cq: { me: S.cq.me.map(k), opp: S.cq.opp.map(k), myBan: S.cq.myBan, theirBan: S.cq.theirBan, games: S.cq.games },
      fd: { first: S.fd.first, used: k(S.fd.used), steps: S.fd.steps.map((x) => ({ actor: x.actor, action: x.action, card: x.card.key })) },
    }));
  } catch (e) { /* no storage: the state stays in memory */ }
}

function restore() {
  let o = null;
  try { o = JSON.parse(sessionStorage.getItem(STORE) || "null"); } catch (e) { return; }
  if (!o || typeof o !== "object") return;
  const all = (l) => Array.isArray(l) && l.every((x) => DB.byKey.has(x));
  const cs = (l) => (all(l) ? l.map((x) => DB.byKey.get(x)) : null);
  const deck3 = (l) => Array.isArray(l) && l.length === 3 && l.every((d) => all(d) && d.length <= 4) ? l.map(cs) : null;
  const ban = (v) => (v === null || [0, 1, 2].includes(v) ? v : undefined);
  try {
    if (KEY[o.fmt]) S.fmt = o.fmt;
    S.mine = o.mine === true;
    if (Array.isArray(o.locked)) {
      for (const [key, lacks] of o.locked) {
        const c = DB.byKey.get(key);
        if (c && Array.isArray(lacks)) S.locked.set(c, new Set(lacks.filter((l) => Number.isInteger(l) && l >= 1 && l <= c.talents.length)));
      }
    }
    if (o.ig) S.ig.out = cs(o.ig.out) || [];
    if (o.fe) { S.fe.mine = cs(o.fe.mine) || []; S.fe.opp = cs(o.fe.opp) || []; }
    const cq = o.cq || {}, me = deck3(cq.me), opp = deck3(cq.opp);
    if (me && opp) {
      S.cq.me = me; S.cq.opp = opp;
      if (ban(cq.myBan) !== undefined && ban(cq.theirBan) !== undefined) { S.cq.myBan = cq.myBan; S.cq.theirBan = cq.theirBan; }
      if (Array.isArray(cq.games) && cq.games.every((g) => g && [0, 1, 2].includes(g.a) && [0, 1, 2].includes(g.b) && typeof g.won === "boolean")) S.cq.games = cq.games;
    }
    const fd = o.fd || {};
    if (["me", "opp"].includes(fd.first) && all(fd.used) && Array.isArray(fd.steps) && fd.steps.length <= ORDER.length
      && fd.steps.every((x, i) => x && DB.byKey.has(x.card) && x.action === ORDER[i][1] && ["me", "opp"].includes(x.actor))) {
      S.fd.first = fd.first; S.fd.used = cs(fd.used);
      S.fd.steps = fd.steps.map((x) => ({ actor: x.actor, action: x.action, card: DB.byKey.get(x.card) }));
    }
  } catch (e) { /* a state from another version: the page starts clean */ }
}
