// The overlay page (site/overlay/index.html): SPAM Overlay first, then the companion SPAM Meta site. It runs on the site's
// own modules (store, i18n, data, cards), so it draws the same game cards from the same data, speaks the same two languages
// and shares the visitor's language choice with SPAM Meta. Its strings are the "ov." keys of js/i18n.js.

import { setLang, langChosen, on, getLang } from "../../js/store.js?v=06961c2c19";
import { t, tx, applyStatic } from "../../js/i18n.js?v=06961c2c19";
import { h, pct, pct1, dec, icon } from "../../js/util.js?v=06961c2c19";
import { DB, loadCore, loadRanking, loadCardTiers } from "../../js/data.js?v=06961c2c19";
import { gameCard, cardName } from "../../js/cards.js?v=06961c2c19";
import { GAME_PATCH, DECK_RANKING_SHOWN, CARD_TIERS_SHOWN } from "../../js/patch.js?v=06961c2c19";
import { ambient } from "../../js/ambient.js?v=06961c2c19";
import { copyText, disclosure } from "../../js/ui.js?v=06961c2c19";
import { createStage } from "./stage.js?v=06961c2c19";
import { loadRelease, formatSize, formatDay, recommended, alternative } from "./release.js?v=06961c2c19";

// The overlay's own display: four crops of the real renderer's output over a stand-in board with made-up figures (tools/overlay_media/:
// shoot.js drives the overlay build's UX harness, crop.py writes these files), so every one is a composite and carries
// "Illustration, made-up numbers". Pixels only (WebP). One file per language. `w`/`h`: the largest file's own size (set on the img
// so nothing jumps); the frame opens the largest. `src` null: not in yet, the frame shows its empty state.
const MEDIA = {
  dmg: { composite: true, w: 1600, h: 1200, src: { fr: "dmg-fr", en: "dmg-en" }, sizes: [800, 1600] },
  death: { composite: true, w: 1280, h: 960, src: { fr: "death-fr", en: "death-en" }, sizes: [640, 1280] },
  odds: { composite: true, w: 792, h: 594, src: { fr: "odds-fr", en: "odds-en" }, sizes: [396, 792] },
  win: { composite: true, w: 1600, h: 1200, src: { fr: "win-fr", en: "win-en" }, sizes: [800, 1600] },
};
const mediaUrl = (name, w) => new URL(`../media/${name}-${w}.webp`, import.meta.url).href;

// The AI the published overlay plays with, and its measured figures: the one place the page names them (step 3 and the facts of
// "How it works", two FAQ answers). Sources, to re-read at every overlay release that changes the AI or its search:
// spam-overlay SPEC.md 6.33 and its release notes (overlay 0.1.19: the default stack v3s9, `ai_pick` full by default);
// spam-lab ai/weights/BEST_AI.md (v3s9 is the lab's current best AI; the full search against the fast one, m=8 n=64 against m=4
// n=16, read 0.541 head to head on an earlier generation, v3s5 against v3s4); spam-lab overlay/contract.md 4.1 (first move with
// v3s9 full, 186 decisions of the owner's 1.26 matches on his PC under a lab ranking holding every thread: p50 259 ms, p90 477 ms;
// `fast` about 0.15 s sooner). No gain of v3s9 over v3s8 is quoted: BEST_AI.md's +0.038 was read against an exact champion that
// aimed its own cards (the AI PC's CHANGELOG entry of 2026-10-24 15:03: fair yardstick 0.607 instead of 0.784); quote one only
// once the lab publishes the fair re-read. The game patch is the site's (patch.js).
const AI = { name: "v3s9", firstS: 0.26, p90S: 0.48, fastSoonerS: 0.15, fullShare: 54 };
const secs = (s) => `${dec(s, 2)}\u00a0s`;
const aiParams = () => ({ ai: AI.name, first: secs(AI.firstS), p90: secs(AI.p90S), sooner: secs(AI.fastSoonerS),
  share: AI.fullShare });

const FAQ = [1, 2, 3, 4, 5, 6, 7, 8];
const FAQ_P = new Set([2, 4]);     // the answers that quote the AI (aiParams; data-i18n-p, as step 3 of "How it works")
const ROOT = new URL("../../", import.meta.url);
const thumb = (key) => new URL(`assets/thumbs/s/${key}.webp`, ROOT).href;

// ---- language: a ?lang= link wins for this visit, then the visitor's saved choice, else French (the players' language)
const asked = new URLSearchParams(location.search).get("lang");
if (asked === "fr" || asked === "en") setLang(asked, { keep: false });
else if (!langChosen()) setLang("fr", { keep: false });

const seg = document.getElementById("lang-seg");
seg.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-v]");
  if (b) setLang(b.dataset.v);
});

// ---- the download: data/overlay-release.json puts the page in one of four states (js/release.js), written on body[data-dl]:
// loading (a still skeleton, same footprint as the strip), soon (no public release: the strip and a note, no link anywhere),
// ready (the button with the version and size, then the check-the-file details) or error (the file could not be read: the
// strip's shape with a retry, still no link). Every panel stays in the page; `hidden` only swaps which one shows.
const dl = { state: "loading", release: null };
const $ = (id) => document.getElementById(id);
const dlPanels = { loading: $("dl-loading"), soon: $("dl-soon"), error: $("dl-error"), ready: $("dl-ready") };
disclosure($("dl-more"), $("dl-detail"));

/** One package's check block: its name, the PowerShell line, the fingerprint and its copy button (the button flips to "Copied" for 2.4 s). */
function fileBlock(a) {
  const code = h("code", { translate: "no" }, a.sha256);
  const ico = h("span.copy-ico", { "aria-hidden": "true" }, icon("copy", 14));
  const btn = h("button.copy", { type: "button", "aria-label": t("ov.dl.copyFor", { name: a.name }) }, [
    ico, h("span.copy-ls", [h("span.copy-l.l-rest", t("ui.copy")), h("span.copy-l.l-done", { "aria-hidden": "true" }, t("ui.copied"))]),
  ]);
  let timer = 0;
  btn.addEventListener("click", async () => {
    if (!(await copyText(a.sha256, code))) return; // the text is selected instead (copyText): the visitor finishes with Ctrl+C
    btn.classList.add("done");
    ico.replaceChildren(icon("check", 14));
    clearTimeout(timer);
    timer = setTimeout(() => { btn.classList.remove("done"); ico.replaceChildren(icon("copy", 14)); }, 2400);
  });
  return h("div.dl-file", [
    h("p.dl-file-n", { translate: "no" }, a.name),
    h("div.dl-how", h("code", { translate: "no" }, `Get-FileHash ".\\${a.name}" -Algorithm SHA256`)),
    h("div.dl-hash", [code, btn]),
  ]);
}

let checking = false;
async function loadDownload() {
  const retry = $("dl-retry");
  checking = true;
  retry.disabled = true;
  paintRetry();
  const res = await loadRelease();
  checking = false;
  retry.disabled = false;
  dl.state = res.state;
  dl.release = res.release || null;
  drawDownload();
}
$("dl-retry").addEventListener("click", () => { if (!checking) loadDownload(); });
function paintRetry() {
  $("dl-retry").textContent = t(checking ? "ov.dl.checking" : "ov.dl.retry");
}

/** Sets a step or answer to one of its keyed variants (the keys are "<base>.<variant>"). */
function variant(el, base, name) {
  el.dataset.i18n = `${base}.${name}`;
  el.textContent = t(el.dataset.i18n);
}

function drawDownload() {
  const { state, release: r } = dl;
  const lang = getLang();
  document.body.dataset.dl = state;
  for (const [name, el] of Object.entries(dlPanels)) el.hidden = name !== state;
  const ready = state === "ready";
  const see = $("cta-see");
  see.classList.toggle("primary", !ready);
  see.classList.toggle("ghost", ready);

  // the hero: the note says what is true in each state; the button is only there for a valid, available release
  $("cta-dl").hidden = !ready;
  variant($("cta-note-t"), "ov", state === "ready" ? "dl.noteReady" : state === "error" ? "dl.noteErr" : "ctaNote");
  $("cta-note-link").hidden = !(ready || state === "error");

  // the install steps and the FAQ answer follow the state (and the packages the release has)
  const main = ready ? recommended(r) : null, alt = ready ? alternative(r) : null;
  const kind = !ready ? "soon" : alt ? "both" : main.kind;
  variant($("inst-1t"), "ov.inst.1t", kind);
  variant($("inst-2t"), "ov.inst.2t", kind === "both" ? "setup" : kind);
  const a5 = document.querySelector("#faq-a5 p");
  if (a5) variant(a5, "ov.faq.a5", ready ? "ready" : "soon");

  paintRetry();

  if (!ready) {
    for (const a of [$("cta-dl"), $("dl-btn"), $("dl-alt"), $("dl-release"), $("dl-notes")]) a.removeAttribute("href");
    $("dl-alt").hidden = true;
    $("dl-files").replaceChildren();
    return;
  }
  const ver = `v${r.version}`;
  for (const a of [$("cta-dl"), $("dl-btn")]) {
    a.href = main.url;
    a.title = t(main.kind === "zip" ? "ov.dl.titleZip" : "ov.dl.titleSetup");
    a.querySelector(".dl-ver").textContent = ver;
    a.querySelector(".dl-size").textContent = formatSize(main.size_bytes, lang);
  }
  const altEl = $("dl-alt");
  altEl.hidden = !alt;
  if (alt) {
    altEl.href = alt.url;
    altEl.querySelector(".dl-alt-t").textContent = t(alt.kind === "zip" ? "ov.dl.altZip" : "ov.dl.altSetup");
    altEl.querySelector(".dl-alt-size").textContent = formatSize(alt.size_bytes, lang);
  } else altEl.removeAttribute("href");
  $("dl-release").href = r.release_url;
  $("dl-notes").href = r.notes_url;
  $("dl-facts").textContent = `${t("ov.dl.factsDate", { date: formatDay(r.released, lang) })}. ${t(main.kind === "zip" ? "ov.dl.kindZip" : "ov.dl.kindSetup")}`;
  $("dl-files").replaceChildren(...r.assets.slice().sort((x, y) => (x === main ? -1 : y === main ? 1 : 0)).map(fileBlock));
  const sm = main.kind === "zip" ? "Zip" : "Setup";
  $("dl-smart-1").textContent = t(`ov.dl.smart${sm}1`);
  $("dl-smart-2").textContent = t(`ov.dl.smart${sm}2`);
  $("dl-smart-3").hidden = !alt;
  $("dl-smart-3").textContent = alt ? t("ov.dl.smartZip3") : "";
}

// ---- FAQ: one disclosure per question (DESIGN.md "Disclosure"): the answer stays mounted and opens by grid rows. The
// questions after FAQ_FIRST go into #faq-more, open from 760px, folded behind its button on a phone.
const FAQ_FIRST = 4;
const faqMore = document.getElementById("faq-more"), faqMoreBtn = document.getElementById("faq-morebtn");
for (const n of FAQ) {
  const faq = document.getElementById(n <= FAQ_FIRST ? "faq-list" : "faq-more-in");
  const id = `faq-a${n}`;
  const btn = h("button.faq-q", { type: "button", "aria-expanded": "false", "aria-controls": id },
    [h("span", { "data-i18n": `ov.faq.q${n}` }), icon("chevron", 16)]);
  const ans = h("div.collapse.faq-a", { id, role: "region", "aria-labelledby": `faq-q${n}` },
    h("div.collapse-in", h("p", FAQ_P.has(n) ? { "data-i18n-p": `ov.faq.a${n}` } : { "data-i18n": `ov.faq.a${n}${n === 5 ? ".soon" : ""}` })));
  btn.id = `faq-q${n}`;
  btn.addEventListener("click", () => {
    const open = btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", String(open));
    ans.classList.toggle("open", open);
  });
  faq.append(h("div.faq-item", [h("h3", btn), ans]));
}
function faqMoreLabel() {
  const open = faqMoreBtn.getAttribute("aria-expanded") === "true";
  faqMoreBtn.firstChild.textContent = open ? t("ov.faq.less") : t("ov.faq.more", { n: FAQ.length - FAQ_FIRST });
}
faqMoreBtn.addEventListener("click", () => {
  const open = faqMoreBtn.getAttribute("aria-expanded") !== "true";
  faqMoreBtn.setAttribute("aria-expanded", String(open));
  faqMore.classList.toggle("open", open);
  faqMoreLabel();
});

// ---- the shortcuts: open from 760px, a disclosure on a phone
const keysBtn = document.getElementById("keys-btn");
keysBtn.addEventListener("click", () => {
  const open = keysBtn.getAttribute("aria-expanded") !== "true";
  keysBtn.setAttribute("aria-expanded", String(open));
  document.getElementById("keys-list").classList.toggle("open", open);
});

// ---- the section the visitor is reading, marked in both section navs (aria-current), and kept in view in the phone row
const subnav = document.getElementById("ov-subnav");
const SECTIONS = ["top", "what", "how", "trust", "install", "faq", "meta"];
function markSection(id) {
  for (const a of document.querySelectorAll(".ov-nav a, .ov-subnav a")) {
    if (a.getAttribute("href") === "#" + id) a.setAttribute("aria-current", "location");
    else a.removeAttribute("aria-current");
  }
  const cur = subnav.querySelector('[aria-current]');
  if (cur && subnav.scrollWidth > subnav.clientWidth) {
    const left = cur.offsetLeft - (subnav.clientWidth - cur.offsetWidth) / 2;
    subnav.scrollTo({ left, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
}
const spy = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) markSection(e.target.id);
}, { rootMargin: "-45% 0px -54% 0px" });
for (const id of SECTIONS) { const el = document.getElementById(id); if (el) spy.observe(el); }
// the edge of the phone row that hides a link fades (the site's tab-row rule, DESIGN.md Header)
function subnavEdges() {
  const max = subnav.scrollWidth - subnav.clientWidth;
  subnav.classList.toggle("more-l", subnav.scrollLeft > 2);
  subnav.classList.toggle("more-r", subnav.scrollLeft < max - 2);
}
subnav.addEventListener("scroll", subnavEdges, { passive: true });
window.addEventListener("resize", subnavEdges);
subnavEdges();

// ---- the four feature pictures: the real file when it is in, else the frame's empty state
function drawShots() {
  for (const fig of document.querySelectorAll(".shot[data-media]")) {
    const key = fig.dataset.media, media = MEDIA[key], frame = fig.querySelector(".shot-frame");
    if (media && media.src) {
      const name = media.src[getLang()] || media.src.en, big = media.sizes[media.sizes.length - 1];
      // the frame is a link to the larger file (the overlay's figures are small in a thumbnail); built once, then only
      // its sources and words change with the language
      let a = frame.querySelector("a.shot-open"), img = a && a.querySelector("img");
      if (!a) {
        img = h("img", { loading: "lazy", decoding: "async", width: media.w, height: media.h });
        // the zoom cue in the bottom-right corner (empty in every kit picture) says the frame opens, touch included
        a = h("a.shot-open", { target: "_blank", rel: "noopener" }, [img, h("span.shot-zoom", { "aria-hidden": "true" }, icon("search", 16))]);
        frame.replaceChildren(a);
        frame.style.aspectRatio = `${media.w} / ${media.h}`;
        // a composite says so at the head of its caption, never on the picture (it would hide part of the display)
        if (media.composite) fig.querySelector("figcaption").prepend(h("span.tag.soft.shot-tag"), " ");
      }
      img.srcset = media.sizes.map((w) => `${mediaUrl(name, w)} ${w}w`).join(", ");
      img.sizes = "(min-width: 1184px) 536px, (min-width: 760px) calc(50vw - 56px), calc(100vw - 32px)";
      img.src = mediaUrl(name, media.sizes[0]);
      img.alt = t(`ov.alt.${key}`);
      a.href = mediaUrl(name, big);
      a.title = t("ov.shots.open");
      a.setAttribute("aria-label", t("ov.shots.openAria", { alt: img.alt }));
      const tag = fig.querySelector(".shot-tag");
      if (tag) tag.textContent = t("ov.shots.illus");
    } else {
      frame.replaceChildren(h("span.shot-wait", [picture(), h("span", t("ov.shots.wait"))]));
    }
  }
}
// ---- the picture viewer: a plain click on a screenshot shows it larger in the page, over a shade (a native modal dialog:
// focus moves to its close button and goes back to the picture's frame; Escape, the close button and a click outside the
// picture close it). A modified click (Ctrl, Cmd, Shift, middle button) keeps the link's own behaviour: the file in a new tab.
// Motion as every dialog of the site: in with a fade and 24px of travel (280 ms), out with a fade (200 ms); reduced motion:
// the fade only. Nothing is unmounted while it closes: the dialog closes once its fade is over.
let viewer = null, viewerFrom = null, viewerT = 0;
function viewerEl() {
  if (viewer) return viewer;
  const img = h("img.ovv-img", { alt: "", decoding: "async" });
  const close = h("button.close.ovv-close", { type: "button", "data-close": "" },
    icon("close", 16));
  viewer = h("dialog.ov-viewer", [
    h("div.ovv-shade", { "data-close": "" }),
    h("figure.ovv-fig", { "data-close": "" }, [img, h("figcaption.ovv-cap")]),
    close,
  ]);
  viewer.addEventListener("click", (e) => { if (e.target.closest("[data-close]") && !e.target.closest(".ovv-img")) closeViewer(); });
  viewer.addEventListener("cancel", (e) => { e.preventDefault(); closeViewer(); });
  document.body.append(viewer);
  return viewer;
}
function paintViewer() {
  if (!viewer) return;
  const close = viewer.querySelector(".ovv-close");
  close.setAttribute("aria-label", t("ov.viewer.close"));
  close.title = t("ui.close");
}
function openViewer(a) {
  const dlg = viewerEl(), src = a.querySelector("img"), fig = a.closest(".shot");
  const img = dlg.querySelector(".ovv-img");
  img.width = src.width; img.height = src.height;
  img.srcset = src.srcset; img.sizes = "(min-width: 1648px) 1600px, calc(100vw - 48px)";
  img.src = a.href;
  img.alt = src.alt;
  dlg.setAttribute("aria-label", src.alt);
  // the frame's own caption, its "Illustration" tag included
  dlg.querySelector(".ovv-cap").replaceChildren(...(fig ? [...fig.querySelector("figcaption").childNodes].map((n) => n.cloneNode(true)) : []));
  paintViewer();
  viewerFrom = a;
  clearTimeout(viewerT);
  if (!dlg.open) dlg.showModal();
  dlg.querySelector(".ovv-close").focus();
  requestAnimationFrame(() => requestAnimationFrame(() => dlg.classList.add("on")));
}
function closeViewer() {
  if (!viewer || !viewer.open) return;
  viewer.classList.remove("on");
  clearTimeout(viewerT);
  viewerT = setTimeout(() => {
    viewer.close();
    if (viewerFrom && viewerFrom.isConnected) viewerFrom.focus({ preventScroll: true });
  }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 120 : 200);
}
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest("a.shot-open");
  if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  openViewer(a);
});

function picture() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg"), p = document.createElementNS(NS, "path");
  for (const [k, v] of Object.entries({ viewBox: "0 0 16 16", width: 24, height: 24, "aria-hidden": "true", focusable: "false", class: "ico" })) svg.setAttribute(k, v);
  p.setAttribute("d", "M2.5 3.5h11v9h-11zM2.5 10.5l3-3 3 3 2-2 3 3M10.5 6.2v.1");
  svg.append(p);
  return svg;
}

// ---- the SPAM Meta previews: the first decks of the Deck tier list (the deck ranking of the game patch, ranking.json), the top
// of the Card tier list (cardtiers.json), the Codex. Each preview follows the site's own switch (patch.js): a ranking the site
// does not show is not previewed here either.
let ranking = null, cardTiers = null;
const visible = (d) => Array.isArray(d.cards) && d.cards.length === 4 && !d.withheld && !d.secret;
// the Card tier list's one view (since 2026-10-24): each card's tier and rank by the best decks it plays in (cardtiers.json rows
// `tier`, `rank`); a tier shows at most CARD_ROW cells, its first cards by rank and a "+N" cell for the rest, so a crowded tier
// keeps the panel short
const CARD_ROW = 4;
/** A deck's headline, as the Deck tier list reads it: its win rate against the rest of the top 30 once the export carries it
 *  (`vs_top30`), else its win rate in the final against the benchmark decks (`score`). */
const headline = (d) => (d.vs_top30
  ? { rate: d.vs_top30.win_rate, games: d.vs_top30.games, key: "ov.meta.vsTop30" }
  : { rate: d.score, games: d.games, key: "ov.meta.final" });

function drawMeta() {
  if (!DB.cards.length) return;      // the skeletons stay until the card data is in
  const off = t("ov.meta.off");
  const decksT = document.getElementById("mp-decks-t");
  if (!DECK_RANKING_SHOWN) {
    decksT.textContent = off;
    document.getElementById("mp-decks").replaceChildren();
  } else if (ranking) {
    decksT.textContent = t(ranking.final ? "ov.meta.decksTf" : "ov.meta.decksT", { patch: ranking.patch });
    const list = ranking.by_score.decks;
    const decks = list.filter(visible).slice(0, 3);
    // ranks above the first one shown are withheld or secret on SPAM Meta: say so, never leave "#2" unexplained
    const hiddenAbove = decks.length ? list.filter((d) => d.rank < decks[0].rank).length : 0;
    const note = document.getElementById("mp-decks-hidden");
    note.hidden = !hiddenAbove;
    note.textContent = hiddenAbove ? t("ov.meta.hidden", { n: hiddenAbove }) : "";
    document.getElementById("mp-decks").replaceChildren(...decks.map((d) => {
      const m = headline(d);
      return h("div.mp-deck", [
        h("span.mp-rank", t("ov.meta.rank", { n: d.rank })),
        h("div.mp-cards", d.cs.filter(Boolean).map((c) => gameCard(c, { size: "list", interactive: false }))),
        h("div.mp-stat", [h("b", pct1(m.rate)), h("span", t(m.key, { games: m.games }))]),
      ]);
    }));
  }
  document.getElementById("mp-codex-t").textContent = t("ov.meta.codexT", { n: DB.cards.length });
  if (!CARD_TIERS_SHOWN) document.getElementById("mp-cards-t").textContent = off;
  else if (cardTiers) {
    document.getElementById("mp-cards-t").textContent = t("ov.meta.cardsT", { patch: cardTiers.patch });
    // a tier with no card draws no row
    const rows = [["S+", "t-sp"], ["S", "t-s"]].map(([tierName, cls]) => {
      const cards = cardTiers.cards.filter((r) => r.tier === tierName).sort((a, b) => a.rank - b.rank).map((r) => r.card);
      const shown = cards.length > CARD_ROW ? cards.slice(0, CARD_ROW - 1) : cards, rest = cards.length - shown.length;
      return cards.length ? h("div.mp-tier", [
        h("span", { class: "mp-tier-l " + cls }, tierName),
        h("div.mp-tier-c", [
          ...shown.map((c) => h("span.mp-mini", { title: cardName(c) }, [
            h("img", { loading: "lazy", decoding: "async", alt: cardName(c), width: 48, height: 69, src: thumb(c.key) }),
            h("i", { class: "mc-orb sp-el-" + c.element }),
          ])),
          rest ? h("span.mp-more", { title: t("ov.meta.more", { n: rest, tier: tierName }) }, [
            h("span", { "aria-hidden": "true" }, "+" + rest), h("span.sr", t("ov.meta.more", { n: rest, tier: tierName }))]) : null,
        ]),
      ]) : null;
    });
    document.getElementById("mp-cards").replaceChildren(...rows.filter(Boolean));
  }
}

// ---- the AI behind the dot, two facts under "How it works", each a measured figure over its line: how soon its move shows, and
// the game patch its engine is built for (the site's game patch: the engine follows the visitor's own copy). Its name is in step 3.
function drawAI(p) {
  document.getElementById("ai-time").textContent = secs(AI.firstS);
  document.getElementById("ai-speed").textContent = t("ov.ai.speed", p);
  document.getElementById("ai-patch").textContent = t("ov.ai.patchV", { patch: GAME_PATCH.patch });
  document.getElementById("ai-patchT").textContent = t("ov.ai.patch", p);
}

// ---- every text of the page, in the current language
let stage = null;
function paint() {
  document.title = t("ov.docTitle");
  document.querySelector('meta[name="description"]').setAttribute("content", t("ov.docDesc"));
  for (const b of seg.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.v === getLang()));
  applyStatic();
  const p = aiParams();
  // the FAQ answers that quote the AI; the config line is code, never translated
  const code = (s) => h("code.ov-code", { translate: "no" }, s);
  for (const el of document.querySelectorAll("[data-i18n-p]")) {
    el.replaceChildren(...tx(el.dataset.i18nP, { ...p, key: code('"ai_pick": "fast"'), file: code("data\\config.local.json") }));
  }
  drawAI(p);
  for (const el of document.querySelectorAll("[data-num]")) el.textContent = (el.dataset.hedge || "") + pct(Number(el.dataset.num), 0);
  for (const el of document.querySelectorAll("[data-dlt]")) { const d = Number(el.dataset.dlt); el.textContent = (d > 0 ? "+" : d < 0 ? "−" : "") + Math.abs(d); }
  faqMoreLabel();
  subnavEdges();
  drawShots();
  paintViewer();
  drawMeta();
  drawDownload();
  if (stage) stage.relabel();
}
on("lang", paint);

// ---- the ambient field (js/ambient.js, the showcase palette in overlay.css). One ambient effect at a time: while the hero
// stage's loop plays, the field holds still; it drifts again once the stage is paused or off screen.
const amb = ambient({ seed: 11 });

// ---- boot: the stage takes its slots at once (no jump while the data loads), the cards when it lands
stage = createStage(document.getElementById("stage"), { onPlaying: (on) => (on ? amb.pause() : amb.resume()) });
paint();
loadDownload();

(async () => {
  try {
    await loadCore();
    // the stage draws the first two decks of the deck ranking (an illustration: any two real decks would do, these are the ones
    // SPAM Meta leads with); the previews below read the same file
    ranking = await loadRanking();
    const decks = ranking.by_score.decks.filter(visible).slice(0, 2).map((d) => d.cs);
    if (decks.length === 2 && decks.every((d) => d.length === 4 && d.every(Boolean))) stage.fill(decks[0], decks[1]);
    else stage.fail();
    cardTiers = CARD_TIERS_SHOWN ? await loadCardTiers().catch(() => null) : null;
    paint();
  } catch (e) {
    console.error(e);
    stage.fail();
    document.getElementById("mp-err").hidden = false;
    document.getElementById("mp-decks").replaceChildren();
  }
})();
