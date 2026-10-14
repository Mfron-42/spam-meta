// Entry point: loads the core data, wires the header, the tabs and the delegated clicks, and mounts the three views.

import { h, $, $$, icon, fmtInt } from "./util.js";
import { copyText } from "./ui.js";
import { DB, loadCore } from "./data.js";
import { on, ownedCount, prune, getLang, setLang } from "./store.js";
import { initDialogs, openCard, openAbout, refreshCardDialog, syncDialogOwned } from "./dialogs.js";

const TABS = ["tiers", "codex", "decks"];
const TITLES = { tiers: "Tier list", codex: "Codex", decks: "My decks" };
const BASE_TITLE = "SPAM Meta: best decks and card codex";
const mounted = {};
const scrolls = {};          // where each tab was scrolled to, so coming back does not lose the place
let freshNav = false;        // a button that sends you to a tab starts it at the top
const LOADERS = { tiers: () => import("./tiers.js"), codex: () => import("./codex.js"), decks: () => import("./mydecks.js") };
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

// ---- delegated clicks: card chips and cards open the dialog; [data-goto] jumps to a tab
const plain = (e) => e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;   // let "open in a new tab" work on links
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-goto]");
  if (g) { if (plain(e)) { e.preventDefault(); freshNav = true; go(g.dataset.goto); } return; }
  const c = e.target.closest("[data-card]");
  if (c) { e.preventDefault(); openCard(c.dataset.card); }
});

// ---- tabs
// #tiers, #codex, #decks, or #<tab>/<card key> which also opens that card
function parseHash() {
  const [t, key] = location.hash.replace(/^#/, "").split("/");
  return { tab: TABS.includes(t) ? t : "tiers", key: key && DB.byKey.has(key) ? key : null };
}
const tabFromHash = () => parseHash().tab;

function go(tab) {
  if (location.hash !== "#" + tab) location.hash = tab;   // hashchange does the rest
  else show(tab, true);
}

function show(tab, force) {
  if (!TABS.includes(tab)) tab = "tiers";
  if (tab === current && !force) return;
  const first = current === null;
  if (current) scrolls[current] = window.scrollY;
  current = tab;
  for (const t of TABS) {
    const on_ = t === tab;
    const btn = $("#tab-" + t);
    btn.setAttribute("aria-selected", String(on_));
    btn.tabIndex = on_ ? 0 : -1;
    const view = $("#view-" + t);
    view.hidden = !on_;
    view.classList.remove("enter");
  }
  const view = $("#view-" + tab);
  if (!first) {
    void view.offsetWidth;
    view.classList.add("enter");
    window.scrollTo(0, freshNav ? 0 : scrolls[tab] || 0);
    freshNav = false;
  }
  document.title = (first && tab === "tiers") ? BASE_TITLE : `${TITLES[tab]} · SPAM Meta`;
  ensure(tab);
}

// views are mounted when first needed (the shown one first, the others when the browser is idle)
async function ensure(tab) {
  if (mounted[tab] || !DB.cards.length) return mounted[tab];
  const view = $("#view-" + tab);
  mounted[tab] = (async () => {
    try {
      const mod = await LOADERS[tab]();
      await mod.mount(view);
      if (tab === "decks") mod.onCount(updateTabCount);
    } catch (err) {
      console.error(err);
      mounted[tab] = null;
      view.replaceChildren(errorPanel(() => ensure(tab), "The data could not be loaded."));
    }
  })();
  return mounted[tab];
}

function errorPanel(retry, text) {
  return h("div.panel.error", { role: "alert" }, [
    h("h2", "Something went wrong"),
    h("p", `${text} Check your connection and try again.`),
    h("button.btn.primary", { type: "button", onclick: () => retry() }, "Try again"),
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

// ---- header
function updatePill() {
  const n = ownedCount();
  $("#own-pill-n").textContent = fmtInt(n);
  $(".own-pill-t").textContent = ` / ${DB.cards.length}`;
  $("#own-pill").classList.toggle("has", n > 0);
  $("#own-pill").setAttribute("aria-label", `${n} of ${DB.cards.length} cards owned. Open the Codex to change them`);
}

function updateTabCount(n) {
  const el = $("#tab-decks-n");
  el.hidden = !(ownedCount() > 0 && n > 0);
  el.textContent = fmtInt(n);
  el.title = `${fmtInt(n)} decks you can build`;
}

function paintLang() {
  for (const b of $$("#names-seg button")) b.setAttribute("aria-pressed", String(b.dataset.v === getLang()));
}

// Every figure comes from meta.json: the games behind this patch (with the games of each stage) and, apart, all patches.
const STAGE_NAMES = [["screen", "quick screen"], ["halving", "halving"], ["round_robin", "round-robin"], ["finals", "finals"]];
function gamesLine(m) {
  const t = m.totals, b = t.patch_games_breakdown || {};
  const parts = STAGE_NAMES.filter(([k]) => typeof b[k] === "number").map(([k, name]) => `${fmtInt(b[k])} ${name}`);
  const patch = typeof t.patch_games === "number" ? `Patch ${m.patch}: ${fmtInt(t.patch_games)} simulated matches${parts.length ? ` (${parts.join(", ")})` : ""}.` : "";
  const all = typeof t.simulated_games === "number" ? ` All patches: ${fmtInt(t.simulated_games)} simulated matches.` : "";
  return (patch + all).trim();
}

// The Discord name is plain selectable text; the button copies it, or selects it when the browser refuses to copy.
function copyHandle() {
  const handle = $("#foot-handle"), btn = $("#foot-copy"), label = $(".copy-l", btn), ico = $(".copy-ico", btn), note = $("#foot-copy-note");
  const paint = (done) => { btn.classList.toggle("done", done); label.textContent = done ? "Copied" : "Copy"; ico.replaceChildren(icon(done ? "check" : "copy", 14)); };
  let timer;
  paint(false);
  btn.addEventListener("click", async () => {
    const ok = await copyText(handle.textContent.trim(), handle);
    clearTimeout(timer);
    paint(ok);
    note.className = ok ? "copy-note sr" : "copy-note";
    note.textContent = ok ? "Copied to the clipboard." : "Selected. Press Ctrl+C to copy it.";
    timer = setTimeout(() => { paint(false); note.textContent = ""; }, 2400);
  });
}

function footer() {
  const m = DB.meta;
  const date = new Date(m.generated + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const headline = m.methodology.headline.replace(/\s*\([^)]*\)\.?$/, ".");
  $("#foot-method").textContent = `${headline} The top decks were cross-checked by an AlphaZero-style AI (neural networks plus tree search, trained by self-play), which found the same winner and top 4.`;
  $("#foot-games").textContent = gamesLine(m);
  $("#foot-patch").textContent = `Patch ${m.patch} · generated ${date}.`;
  $("#foot-legal").textContent = m.legal;
  $("#foot-about").addEventListener("click", openAbout);
  copyHandle();
}

// ---- boot
async function boot() {
  try {
    await loadCore();
  } catch (err) {
    console.error(err);
    $("#view-tiers").replaceChildren(errorPanel(() => location.reload(), "The card data could not be loaded."));
    return;
  }
  prune(new Set(DB.cards.map((c) => c.key)));
  initDialogs();
  footer();
  updatePill();
  paintLang();

  on("owned", () => { updatePill(); syncDialogOwned(); });
  on("lang", () => { paintLang(); refreshCardDialog(); });

  $("#names-seg").addEventListener("click", (e) => { const b = e.target.closest("button[data-v]"); if (b) setLang(b.dataset.v); });
  $("#about-btn").addEventListener("click", openAbout);
  $(".tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b && plain(e)) { e.preventDefault(); go(b.dataset.tab); } });
  $(".tabs").addEventListener("keydown", onKeyTabs);
  $(".brand").addEventListener("click", (e) => { if (plain(e)) { e.preventDefault(); go("tiers"); } });
  window.addEventListener("hashchange", () => { const { tab, key } = parseHash(); show(tab); if (key) openCard(key, "url"); });

  show(tabFromHash(), true);
  if (parseHash().key) openCard(parseHash().key, "url");
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 300));
  idle(() => { for (const t of TABS) ensure(t); });
}

boot();
