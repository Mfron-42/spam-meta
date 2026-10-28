// Entry point: loads the core data, wires the header, the tabs and the delegated clicks, and mounts the views. The switches of
// patch.js decide what shows: the Deck tier list draws the deck lists of the game patch (DECK_RANKING_SHOWN, tiers.js) and is
// the landing view, else the "being computed" placeholder (pending.js) and the Codex lands; My decks and the Deck builder read
// the stage ranking's deck table (DECK_TABLE_SHOWN), else they have no tab; the Card tier list reads the same run's card tiers
// (CARD_TIERS_SHOWN), else it draws the placeholder.

import { h, $, $$, icon, fmtInt, fmtDate } from "./util.js?v=813db21b65";
import { t, applyStatic, millions } from "./i18n.js?v=813db21b65";
import { copyText } from "./ui.js?v=813db21b65";
import { DB, loadCore, loadLists } from "./data.js?v=813db21b65";
import { patchLine, dataDate, deckRanking, openMethod, CARD_RANKINGS_SHOWN, CARD_TIERS_SHOWN, DECK_RANKING_SHOWN, DECK_TABLE_SHOWN, DRAFT_SHOWN } from "./patch.js?v=813db21b65";
import { on, ownedCount, setKnown, getLang, setLang } from "./store.js?v=813db21b65";
import { versioned, withQuery } from "./version.js?v=813db21b65";
import { initDialogs, openCard, openAbout, refreshDialogs, syncDialogOwned, leaveCard } from "./dialogs.js?v=813db21b65";
import { holdTiles } from "./cardtilt.js?v=813db21b65";
import { ambient } from "./ambient.js?v=813db21b65";

// Six tabs, one view each; the Deck builder (#builder) sits next to My decks, the Draft tab (#draft, the tournament helper) last.
// TABS are the ones shown.
const ALL_TABS = ["tiers", "card-tiers", "codex", "decks", "builder", "draft"];
const TABS = CARD_RANKINGS_SHOWN || DECK_TABLE_SHOWN ? ALL_TABS.filter((v) => v !== "draft" || DRAFT_SHOWN) : ["tiers", "card-tiers", "codex"];
const HOME = CARD_RANKINGS_SHOWN || DECK_RANKING_SHOWN ? "tiers" : "codex";    // the landing view (no hash, an unknown one, or a tab not shown)
const TITLE_KEYS = { tiers: "tab.tiers", "card-tiers": "tab.cardTiers", codex: "tab.codex", decks: "tab.decks", builder: "fd.title", draft: "dr.title" };
const tabName = (tab) => t(TITLE_KEYS[tab]);
let firstTab = true;         // the landing page keeps the site title until the visitor moves
const mounted = {};
const mods = {};             // the view modules once mounted
const scrolls = {};          // where each tab was scrolled to, so coming back does not lose the place
let freshNav = false;        // a button that sends you to a tab starts it at the top
const MODULES = {
  tiers: DECK_RANKING_SHOWN ? "./tiers.js" : "./pending.js",
  "card-tiers": CARD_RANKINGS_SHOWN || CARD_TIERS_SHOWN ? "./cardtiers.js" : "./pending.js",
  codex: "./codex.js",
  decks: "./mydecks.js",
  builder: "./finder.js",
  draft: "./draftview.js",
};
const RETRY_MS = 1200;       // a view module that fails to load gets one more try after this pause
let current = null;

// ---- images that fail to load must never leave a hole
document.addEventListener("error", (e) => {
  const t = e.target;
  if (t && t.tagName === "IMG") {
    t.classList.add("broken");
    const face = t.closest(".gc-face");
    if (face) face.classList.add("noart");
    const cc = t.closest(".cc, .mc");
    if (cc) cc.classList.add("noart");
  }
}, true);

// ---- delegated clicks: card chips and cards open the dialog (a deck's card on its talent, [data-talent]); [data-goto] jumps
// to a view ([data-pick]: the Deck builder with that card picked, [data-find]: the Deck tier list searched for that card, both
// from the card dialog)
const plain = (e) => e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;   // let "open in a new tab" work on links
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-goto]");
  if (g) {
    if (!plain(e)) return;
    e.preventDefault();
    freshNav = true;
    if (g.dataset.pick) pickCard(g.dataset.pick);
    else if (g.dataset.find) findCard(g.dataset.find);
    else go(g.dataset.goto);
    return;
  }
  const c = e.target.closest("[data-card]");
  if (c) { e.preventDefault(); openCard(c.dataset.card, null, c, c.dataset.talent); }
});

/** The Deck builder with one card picked: the card dialog closes in place (its address becomes #builder), then the view opens. */
function pickCard(key) {
  leaveCard("builder");
  go("builder");
  ensure("builder").then(() => { if (mods.builder) mods.builder.pick([key]); });
}

/** The Deck tier list searched for one card: the card dialog closes in place (its address becomes #tiers), then the view opens. */
function findCard(key) {
  leaveCard("tiers");
  go("tiers");
  ensure("tiers").then(() => { if (mods.tiers && mods.tiers.findCard) mods.tiers.findCard(key); });
}

// ---- tabs
// #tiers, #card-tiers, #codex, #decks, #builder (the Deck builder), #draft (#draft/<format>: the format shown), or #<view>/<card
// key> which also opens that card. A natural
// spelling of My decks (#my-decks, #mes-decks, #mydecks) or of the Deck builder (#finder, #deck-finder, #trouver, #deck-builder) opens it too
// and is replaced in place by the canonical hash. A tab that is not shown opens the landing view, its hash replaced in place.
const ALIASES = { "my-decks": "decks", "mes-decks": "decks", mydecks: "decks", finder: "builder", "deck-finder": "builder", trouver: "builder", "deck-builder": "builder" };
function parseHash() {
  let [raw, ...rest] = location.hash.replace(/^#/, "").split("/");
  // "#method-<tab>": that tab, with its footer Method sub-section opened (patch.js methodLink, openMethod)
  // (the address becomes the tab's own, so the view's later changes, such as a sort, write theirs)
  if (/^method-/.test(raw) && ALL_TABS.includes(raw.slice(7))) {
    pendingMethod = raw.slice(7); raw = pendingMethod; rest = [];
    history.replaceState(history.state, "", "#" + raw);
  }
  let t = ALIASES[raw.toLowerCase()] || raw;
  if (ALL_TABS.includes(t) && !TABS.includes(t)) t = HOME;
  if (t !== raw) history.replaceState(history.state, "", "#" + [t, ...rest].join("/"));
  const key = rest[0];
  return { tab: TABS.includes(t) ? t : HOME, key: key && DB.byKey.has(key) ? key : null };
}
const tabFromHash = () => parseHash().tab;
let pendingMethod = null;
/** Opens the footer Method sub-section a #method-<tab> address asked for, once (its view fills it when it renders). */
function takeMethod() {
  if (!pendingMethod) return;
  const key = pendingMethod;
  pendingMethod = null;
  openMethod(key);
}

function go(tab) {
  if (location.hash !== "#" + tab) location.hash = tab;   // hashchange does the rest
  else show(tab, true);
}

function show(tab, force) {
  if (!TABS.includes(tab)) tab = HOME;
  if (tab === current && !force) return;
  const first = current === null;
  if (current) scrolls[current] = window.scrollY;
  current = tab;
  for (const t of TABS) {
    const on_ = t === tab;
    const btn = $("#tab-" + t);
    btn.setAttribute("aria-selected", String(on_));
    btn.tabIndex = on_ ? 0 : -1;
  }
  revealTab(tab);
  for (const v of ALL_TABS) {
    const view = $("#view-" + v);
    view.hidden = v !== tab;
    view.classList.remove("enter");
  }
  const view = $("#view-" + tab);
  if (!first) {
    void view.offsetWidth;
    view.classList.add("enter");
    window.scrollTo(0, freshNav ? 0 : scrolls[tab] || 0);
    freshNav = false;
  }
  if (!first) firstTab = false;
  paintTitle();
  ensure(tab);
}

// views are mounted when first needed (the shown one first, the others when the browser is idle)
async function ensure(tab) {
  if (mounted[tab] || !DB.cards.length) return mounted[tab];
  const view = $("#view-" + tab);
  if (!view.childElementCount) view.replaceChildren(skeleton());
  view.setAttribute("aria-busy", "true");
  mounted[tab] = (async () => {
    let mod;
    try {
      mod = await loadView(tab);
    } catch (err) {
      console.error(err);
      mounted[tab] = null;          // showing the tab again tries once more; the Reload button starts afresh
      view.replaceChildren(errorPanel(t("err.viewTitle", { tab: tabName(tab) }), t("err.viewText"), t("err.reload"), () => location.reload()));
      view.removeAttribute("aria-busy");
      return;
    }
    try {
      await mod.mount(view);
      mods[tab] = mod;
      if (tab === "decks") mod.onCount(updateTabCount);
    } catch (err) {
      console.error(err);
      mounted[tab] = null;
      view.replaceChildren(errorPanel(t("err.title"), t("err.dataText"), t("err.retry"), () => ensure(tab)));
    }
    view.removeAttribute("aria-busy");
  })();
  return mounted[tab];
}

// A view's module, retried once after a short pause when the request fails (a server refusing connections under a burst
// of image requests, a dropped connection). The retry adds a query so the browser does not hand back the failed fetch.
async function loadView(tab) {
  try {
    return await import(versioned(MODULES[tab]));
  } catch (err) {
    console.warn(`${MODULES[tab]} did not load; trying once more`, err);
    await new Promise((r) => setTimeout(r, RETRY_MS));
    return import(withQuery(versioned(MODULES[tab]), "retry=" + Date.now()));
  }
}

const skeleton = () => h("div.panel.skel", { "aria-hidden": "true" }, [h("i"), h("i"), h("i")]);

function errorPanel(title, text, label, action) {
  return h("div.panel.error", { role: "alert" }, [
    h("h2", title),
    h("p", text),
    h("button.btn.primary", { type: "button", onclick: () => action() }, label),
  ]);
}

function onKeyTabs(e) {
  const i = TABS.indexOf(e.target.dataset.tab);
  if (i < 0) return;
  let n = null;
  if (e.key === "ArrowRight") n = (i + 1) % TABS.length;
  else if (e.key === "ArrowLeft") n = (i - 1 + TABS.length) % TABS.length;
  else if (e.key === "Home") n = 0;
  else if (e.key === "End") n = TABS.length - 1;
  if (n === null) return;
  e.preventDefault();
  $("#tab-" + TABS[n]).focus();
  go(TABS[n]);
}

// The tab strip scrolls sideways when the five tabs do not fit (a narrow phone, a large text setting): the edge that hides
// a tab fades, and the current tab is kept in view.
const strip = () => $(".tabs");
function paintStrip() {
  const s = strip();
  const more = s.scrollWidth - s.clientWidth > 1;
  s.classList.toggle("more-l", more && s.scrollLeft > 1);
  s.classList.toggle("more-r", more && s.scrollLeft < s.scrollWidth - s.clientWidth - 1);
}
function revealTab(tab) {
  const s = strip(), b = $("#tab-" + tab);
  if (s.scrollWidth - s.clientWidth > 1) {
    const l = b.offsetLeft - s.offsetLeft, r = l + b.offsetWidth;
    if (l < s.scrollLeft + 24) s.scrollLeft = Math.max(0, l - 24);
    else if (r > s.scrollLeft + s.clientWidth - 24) s.scrollLeft = r - s.clientWidth + 24;
  }
  paintStrip();
}

// ---- header
function updatePill() {
  const n = ownedCount();
  $("#own-pill-n").textContent = fmtInt(n);
  $(".own-pill-t").textContent = ` / ${DB.cards.length}`;
  $("#own-pill").classList.toggle("has", n > 0);
  $("#own-pill").setAttribute("aria-label", t("head.ownAria", { n, total: DB.cards.length }));
}

let lastCount = 0;
function updateTabCount(n) {
  lastCount = n;
  const el = $("#tab-decks-n");
  el.classList.toggle("off", !(ownedCount() > 0 && n > 0));   // out of the flow (base.css): showing it moves no tab
  el.textContent = fmtInt(n);
  el.title = t("tab.decksCount", { n });
}

function paintLang() {
  for (const b of $$("#names-seg button")) b.setAttribute("aria-pressed", String(b.dataset.v === getLang()));
}

function paintTitle() {
  document.title = firstTab && current === HOME && HOME === "tiers" ? t("doc.title") : t("doc.tabTitle", { tab: tabName(current) });
}

// Every figure comes from meta.json: the games behind this patch (with the games of each stage) and, apart, all patches.
const STAGES = ["screen", "halving", "round_robin", "finals"];
function gamesLine(m) {
  const tot = m.totals, b = tot.patch_games_breakdown || {};
  if (typeof tot.patch_games !== "number") return "";
  const parts = STAGES.filter((k) => typeof b[k] === "number").map((k) => `${t("stage." + k)} ${fmtInt(b[k])}`).join(", ");
  return t("foot.games", { patch: m.patch, games: tot.patch_games, parts, all: tot.simulated_games ?? "—" });
}

// The Discord name is plain selectable text; the button copies it, or selects it when the browser refuses to copy.
let copyPaint = () => {};
function copyHandle() {
  const handle = $("#foot-handle"), btn = $("#foot-copy"), label = $(".copy-l", btn), ico = $(".copy-ico", btn), note = $("#foot-copy-note");
  const paint = (done) => { btn.classList.toggle("done", done); label.textContent = t(done ? "ui.copied" : "ui.copy"); ico.replaceChildren(icon(done ? "check" : "copy", 14)); };
  let timer, done = false;
  copyPaint = () => paint(done);
  paint(false);
  btn.addEventListener("click", async () => {
    const ok = await copyText(handle.textContent.trim(), handle);
    clearTimeout(timer);
    done = ok;
    paint(ok);
    note.className = ok ? "copy-note sr" : "copy-note";
    note.textContent = t(ok ? "foot.copiedNote" : "foot.selectedNote");
    timer = setTimeout(() => { done = false; paint(false); note.textContent = ""; }, 2400);
  });
}

function paintFooter() {
  const m = DB.meta, R = deckRanking();
  // the method and the games describe the rankings shown: the deck ranking's while it is the only one, nothing with none
  $("#foot-rk").textContent = CARD_RANKINGS_SHOWN ? t("foot.method", { patch: m.patch, games: millions(m.totals.patch_games) })
    : R ? t(R.final ? "foot.methodRk" : "foot.methodRkProv", { patch: R.patch, rated: fmtInt(R.elo.rated), ai: R.pilots.full }) : "";
  $("#foot-games").textContent = CARD_RANKINGS_SHOWN ? gamesLine(m) : "";
  $("#foot-games").hidden = !CARD_RANKINGS_SHOWN;
  $("#foot-patch").textContent = t("foot.patch", { line: patchLine(), date: fmtDate(dataDate()) });
  $("#foot-about").textContent = t(CARD_RANKINGS_SHOWN || R ? "foot.how" : "head.about");     // nothing computed is shown: plain "About"
  copyPaint();
}

/** Everything outside the views that carries text: index.html, the title, the header counters, the footer. */
function paintChrome() {
  applyStatic();
  paintLang();
  if (!DB.meta) return;
  paintFooter();
  updatePill();
  updateTabCount(lastCount);
  if (current) { paintTitle(); revealTab(current); }    // the labels changed width
}

// ---- boot
/** Before the data: only the tabs shown are in the header, the brand leads to the landing view, and the view the address
 * asks for holds the skeleton (no motion: the real show() after the data counts as the first). */
function preShow() {
  for (const v of ALL_TABS) $("#tab-" + v).hidden = !TABS.includes(v);
  $(".brand").setAttribute("href", "#" + HOME);
  const tab = tabFromHash();
  for (const v of ALL_TABS) $("#view-" + v).hidden = v !== tab;
  const view = $("#view-" + tab);
  if (!view.childElementCount) view.replaceChildren(skeleton());
  return tab;
}

async function boot() {
  const first = preShow();
  try {
    await loadCore();
    // the deck lists are quoted by the footer, About and the card view: they come with the core (their view still retries on its own)
    if (DECK_RANKING_SHOWN) await loadLists().catch((err) => console.error(err));
  } catch (err) {
    console.error(err);
    $("#view-" + first).replaceChildren(errorPanel(t("err.title"), t("err.dataText"), t("err.reload"), () => location.reload()));
    return;
  }
  setKnown(DB.cards.map((c) => c.key));
  initDialogs();
  holdTiles();     // every card tile tilts in 3D under a hovering mouse (cardtilt.js)
  $("#foot-about").addEventListener("click", openAbout);
  copyHandle();
  paintChrome();

  on("owned", () => { updatePill(); syncDialogOwned(); });
  on("lang", () => { paintChrome(); refreshDialogs(); });

  $("#names-seg").addEventListener("click", (e) => { const b = e.target.closest("button[data-v]"); if (b) setLang(b.dataset.v); });
  $("#about-btn").addEventListener("click", openAbout);
  $(".tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b && plain(e)) { e.preventDefault(); go(b.dataset.tab); } });
  $(".tabs").addEventListener("keydown", onKeyTabs);
  $(".tabs").addEventListener("scroll", paintStrip, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(() => revealTab(current || HOME)).observe($(".tabs"));
  if (document.fonts) document.fonts.ready.then(() => revealTab(current || HOME));
  $(".brand").addEventListener("click", (e) => { if (plain(e)) { e.preventDefault(); go(HOME); } });
  window.addEventListener("hashchange", () => { const { tab, key } = parseHash(); show(tab); if (key) openCard(key, "url"); takeMethod(); });

  show(tabFromHash(), true);
  if (parseHash().key) openCard(parseHash().key, "url");
  takeMethod();
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 300));
  idle(() => { for (const v of TABS) ensure(v); });
}

applyStatic();               // the static markup in the page language before the data arrives
ambient();                   // the night table's slow depth field behind every view (ambient.js, DESIGN.md "Ambient field")
boot();
