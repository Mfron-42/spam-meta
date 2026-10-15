// Everything that draws a card: the game card (full and list size), the mini card, the card chip, the owned toggle.
// Cards are built like the game client builds them, from its own sprites (CSS classes sp-*), so the page carries no
// per-card sprite <img>; only the art is an <img>, and it is lazy.

import { h, icon, reEscape } from "./util.js?v=e2b18ad8df";
import { DB } from "./data.js?v=e2b18ad8df";
import { getLang, isOwned, setOwned } from "./store.js?v=e2b18ad8df";
import { t } from "./i18n.js?v=e2b18ad8df";

// element and rarity ids in game order; their names are UI strings ("el.fire", "ra.common")
export const ELEMENTS = ["fire", "water", "earth", "nature", "light", "shadow", "divine"];
export const RARITIES = ["common", "rare", "epic", "legendary", "divine"];
export const elName = (id) => t("el." + id);
export const raName = (id) => t("ra." + id);

const ART = (key) => `assets/cards/art/${key}.webp`;
const THUMB = (size, key) => `assets/thumbs/${size}/${key}.webp`;

// ---- language
export const L = (obj, field) => obj[`${field}_${getLang()}`] ?? obj[`${field}_en`] ?? "";
export const cardName = (c) => L(c, "name");
export const otherName = (c) => (getLang() === "fr" ? c.name_en : c.name_fr);

// ---- --u: 1% of the card width, kept by one ResizeObserver (container query units are far too slow on hundreds of labels)
const ro = new ResizeObserver((entries) => {
  for (const e of entries) {
    const w = e.contentRect.width;
    if (w) e.target.style.setProperty("--u", `${w / 100}px`);
  }
});
export const sized = (el) => { ro.observe(el); return el; };
export function unsize(root) {
  if (root.classList && root.classList.contains("gc")) ro.unobserve(root);
  root.querySelectorAll && root.querySelectorAll(".gc").forEach((g) => ro.unobserve(g));
}

const fit = (name, a = 13, b = 18) => (name.length > b ? ".xlong" : name.length > a ? ".long" : "");

function artImg(src, cls, eager) {
  // loading must be set before src, or the browser starts fetching at once and lazy loading is lost
  return h("img", { class: cls, loading: eager ? "eager" : "lazy", decoding: "async", fetchpriority: eager ? "high" : "auto", alt: "", width: 420, height: 601, src });
}

/**
 * The game card. size "full": ability bars, passives, HP n/n. size "list": name on the banner above the HP bar.
 * interactive cards are buttons that open the card dialog (data-card), others are plain boxes.
 */
export function gameCard(c, { size = "full", interactive = true, eager = false } = {}) {
  const lang = getLang();
  const name = cardName(c);
  const compact = size === "list";
  const wing = c.rarity === "divine" ? "legendary" : c.rarity;
  const rows = [];
  if (!compact) {
    for (const a of c.abilities) {
      const n = L(a, "name");
      rows.push(h("span.gc-ab" + fit(n), [
        h("i.sp-el-" + (a.element || c.element)), h("span.gc-abn", n), h("span.gc-cd", String(a.cooldown)),
      ]));
    }
    for (const p of c.passives) {
      const n = L(p, "name");
      rows.push(h("span.gc-pa" + fit(n, 12, 16), [h("i.sp-pl-" + wing + "-l"), h("span.gc-abn", n), h("i.sp-pl-" + wing + "-r")]));
    }
  }
  const art = artImg(compact ? THUMB("m", c.key) : ART(c.key), "gc-art", eager);
  const face = h("span.gc-face", [
    art,
    h("i.gc-front.sp-front-" + c.element),
    h("span.gc-name" + (name.length > 15 ? ".long" : ""), { lang, translate: "no" }, name),
    compact ? null : h("span.gc-abs", { lang }, rows),
    h("span.gc-hp", compact ? String(c.hp) : `${c.hp}/${c.hp}`),
  ]);
  const kids = [
    face,
    h("i.gc-orb.sp-el-" + c.element),
    h("span.gc-gold", h("span", String(c.gold_income))),
    h("i.gc-gem.sp-gem-" + c.rarity),
  ];
  const cls = "gc" + (compact ? " cp" : "");
  // a plain card (the card dialog's) says what its face shows, since nothing else on the page repeats it
  if (!interactive) return sized(h("div", { class: cls, role: "img", "aria-label": t("card.face", { name, element: elName(c.element), rarity: raName(c.rarity), hp: c.hp, gold: c.gold_income }) }, kids));
  const label = t("card.label", { name, element: elName(c.element), rarity: raName(c.rarity), hp: c.hp });
  return sized(h("button", { class: cls, type: "button", "data-card": c.key, "aria-label": label }, kids));
}

/**
 * The card tile, the site's default card component (owner, 2026-10-15: the Codex tile is the card format to keep): the full
 * game card in its cell, with the cell's room for the orb, the gold hexagon and the rarity gem that overhang the frame.
 * `toggle`: the round owned toggle on its corner (the Codex grid), or none. `cap`: a line under the card (the Codex's
 * search excerpt), or none. A plain tile (`interactive` false: the card view's) is not a button and says what its face shows.
 */
export function cardTile(c, { toggle = null, cap = null, interactive = true, eager = false } = {}) {
  return h("div.cell", { "data-key": c.key }, [h("div.cw", [gameCard(c, { size: "full", interactive, eager }), toggle]), cap]);
}

/** A face-down card (only its rarity is known): the withheld deck is drawn with four of them. */
export function cardBack(rarity) {
  const known = RARITIES.includes(rarity) ? rarity : "common";
  const name = raName(known);
  return sized(h("div", { class: "gc cp back r-" + known, role: "img", "aria-label": t("card.hidden", { rarity: name }) }, [
    h("span.gc-face", [h("span.gc-q", "?"), h("span.gc-r", name)]),
    h("i.gc-gem.sp-gem-" + known),
  ]));
}

/** A blank grey card for a secret deck: no rarity, no mark, nothing about the card. Not interactive. */
export function secretCard() {
  return sized(h("div", { class: "gc cp back blank", role: "img", "aria-label": t("card.secret") }, [h("span.gc-face")]));
}

/** Art and orb only: for the rows of a matchup strip. */
export function miniCard(c) {
  return h("button.mc", { type: "button", "data-card": c.key, title: cardName(c), "aria-label": t("card.show", { name: cardName(c) }) }, [
    h("img", { class: "mc-art", loading: "lazy", decoding: "async", alt: "", width: 112, height: 160, src: THUMB("s", c.key) }),
    h("i.mc-orb.sp-el-" + c.element),
  ]);
}

/** A card name as a small chip that opens the card dialog. */
export function chip(c) {
  return h("button.cc", { type: "button", "data-card": c.key, title: t("card.show", { name: cardName(c) }) }, [
    h("img", { class: "cc-art", loading: "lazy", decoding: "async", alt: "", width: 18, height: 24, src: THUMB("s", c.key) }),
    h("span", { lang: getLang(), translate: "no" }, cardName(c)),
  ]);
}

/** Four mini cards of a deck, used for counters. */
export function strip(cards) {
  return h("span.strip", cards.map(miniCard));
}

// ---- running text where full card names become chips
let nameRx = null, nameMap = null;
function buildNameRx() {
  const entries = [];
  for (const c of DB.cards) { entries.push([c.name_fr, c]); if (c.name_en !== c.name_fr) entries.push([c.name_en, c]); }
  entries.sort((a, b) => b[0].length - a[0].length);
  nameMap = new Map(entries);
  nameRx = new RegExp("(?<![\\p{L}\\p{N}])(" + entries.map((e) => reEscape(e[0])).join("|") + ")(?![\\p{L}\\p{N}])", "gu");
}
export function chipify(text) {
  if (!nameRx) buildNameRx();
  const out = [];
  let last = 0;
  nameRx.lastIndex = 0;
  for (let m; (m = nameRx.exec(text)); ) {
    out.push(text.slice(last, m.index), chip(nameMap.get(m[1])));
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

// ---- owned toggle
/** The one-click toggle on a card corner. Sync with setOwnedView. */
export function ownToggle(c) {
  const b = h("button.own", { type: "button", "data-own": c.key }, [icon("plus", 18), icon("check", 18)]);
  setOwnedView(b, c, isOwned(c.key));
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    setOwned(c.key, !isOwned(c.key));
  });
  return b;
}
export function setOwnedView(b, c, on) {
  b.setAttribute("aria-pressed", String(on));
  b.setAttribute("aria-label", t("card.own", { name: cardName(c) }));
  b.title = t(on ? "card.owned" : "card.own", { name: cardName(c) });
}
