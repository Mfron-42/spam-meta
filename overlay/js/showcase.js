// The overlay page (site/overlay/index.html): SPAM Overlay first, then the companion SPAM Meta site. It runs on the site's
// own modules (store, i18n, data, cards), so it draws the same game cards from the same data, speaks the same two languages
// and shares the visitor's language choice with SPAM Meta. Its strings are the "ov." keys of js/i18n.js.

import { setLang, langChosen, on, getLang } from "../../js/store.js?v=40095474d7";
import { t, applyStatic } from "../../js/i18n.js?v=40095474d7";
import { h, pct, pct1, icon } from "../../js/util.js?v=40095474d7";
import { DB, loadCore, loadTier, loadCardTiers } from "../../js/data.js?v=40095474d7";
import { gameCard, cardName } from "../../js/cards.js?v=40095474d7";
import { ambient } from "../../js/ambient.js?v=40095474d7";
import { copyText, disclosure } from "../../js/ui.js?v=40095474d7";
import { createStage } from "./stage.js?v=40095474d7";
import { loadRelease, formatSize, formatDay, recommended, alternative } from "./release.js?v=40095474d7";

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

const FAQ = [1, 2, 3, 4, 5, 6, 7, 8];
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
  const ans = h("div.collapse.faq-a", { id, role: "region", "aria-labelledby": `faq-q${n}` }, h("div.collapse-in", h("p", { "data-i18n": `ov.faq.a${n}${n === 5 ? ".soon" : ""}` })));
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

// ---- the SPAM Meta previews: the first visible decks of the Deck tier list, the top of the Card tier list, the Codex
let tier = null, cardTiers = null;
const visible = (d) => Array.isArray(d.cards) && !d.withheld && !d.secret;

function drawMeta() {
  if (!tier) return;
  document.getElementById("mp-decks-t").textContent = t("ov.meta.decksT", { patch: tier.patch });
  const decks = tier.decks.filter(visible).slice(0, 3);
  // ranks above the first one shown are withheld or secret on SPAM Meta: say so, never leave "#2" unexplained
  const hiddenAbove = decks.length ? tier.decks.filter((d) => d.rank < decks[0].rank).length : 0;
  const note = document.getElementById("mp-decks-hidden");
  note.hidden = !hiddenAbove;
  note.textContent = hiddenAbove ? t("ov.meta.hidden", { n: hiddenAbove }) : "";
  document.getElementById("mp-decks").replaceChildren(...decks.map((d) => {
    const m = d.vs_top || { win_rate: d.win_rate, games: d.games };
    const cards = d.cards.map((id) => DB.byId.get(id)).filter(Boolean);
    return h("div.mp-deck", [
      h("span.mp-rank", t("ov.meta.rank", { n: d.rank })),
      h("div.mp-cards", cards.map((c) => gameCard(c, { size: "list", interactive: false }))),
      h("div.mp-stat", [h("b", pct1(m.win_rate)), h("span", t("ov.meta.vsTop", { games: m.games }))]),
    ]);
  }));
  document.getElementById("mp-codex-t").textContent = t("ov.meta.codexT", { n: DB.cards.length });
  if (cardTiers) {
    document.getElementById("mp-cards-t").textContent = t("ov.meta.cardsT", { patch: cardTiers.patch });
    const rows = [["S+", "t-sp"], ["S", "t-s"]].map(([tierName, cls]) => {
      const cards = cardTiers.cards.filter((r) => r.competitive && r.competitive.tier === tierName)
        .sort((a, b) => a.competitive.rank - b.competitive.rank).map((r) => r.card);
      return h("div.mp-tier", [
        h("span", { class: "mp-tier-l " + cls }, tierName),
        h("div.mp-tier-c", cards.map((c) => h("span.mp-mini", { title: cardName(c) }, [
          h("img", { loading: "lazy", decoding: "async", alt: cardName(c), width: 48, height: 69, src: thumb(c.key) }),
          h("i", { class: "mc-orb sp-el-" + c.element }),
        ]))),
      ]);
    });
    document.getElementById("mp-cards").replaceChildren(...rows);
  }
}

// ---- every text of the page, in the current language
let stage = null;
function paint() {
  document.title = t("ov.docTitle");
  document.querySelector('meta[name="description"]').setAttribute("content", t("ov.docDesc"));
  for (const b of seg.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.v === getLang()));
  applyStatic();
  for (const el of document.querySelectorAll("[data-num]")) el.textContent = pct(Number(el.dataset.num), 0);
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
    tier = await loadTier();
    const decks = tier.decks.filter(visible).slice(0, 2).map((d) => d.cards.map((id) => DB.byId.get(id)));
    if (decks.length === 2 && decks.every((d) => d.length === 4 && d.every(Boolean))) stage.fill(decks[0], decks[1]);
    else stage.fail();
    cardTiers = await loadCardTiers().catch(() => null);
    paint();
  } catch (e) {
    console.error(e);
    stage.fail();
    document.getElementById("mp-err").hidden = false;
    document.getElementById("mp-decks").replaceChildren();
  }
})();
