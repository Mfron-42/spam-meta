// The card view's open and close motion (DESIGN.md "Card view motion"; SPEC.md section 3.3). Opening from a card on the
// page, the card makes one turn on its own vertical axis, showing the game's card back on the way, while it travels from
// the tile that was pressed to its place in the view; the blurred backdrop fades in behind it and the open layout arrives
// around the card's place, all in one 280 ms move on the site's one curve. Closing plays the same move back to the tile
// when the tile is still on screen, else the layout collapses where it is. A deep link or a direct load opens without the
// travel; reduced motion is a short opacity change (no turn, so no card back).
//
// How: Web Animations on `opacity` and `transform` only (FLIP: the flying card sits at its final place and is transformed
// back to the tile's rect). The flying card is a "ghost" in the top layer (a manual popover shown above the modal dialog,
// so nothing clips it): its front holds the tile as it looks on the page and the card as the view draws it, stacked, and
// they swap while the front is turned away; its back is the card back. The real card in the view and the tile's art stay
// mounted and are only made invisible while the ghost stands in for them. Every run can be reversed (close while opening)
// or settled at once (another card, a language change), so the view is never left half-open or showing the wrong card.

import { reducedMotion } from "./util.js?v=f0b795cc40";
import { still, dropTilt, sway } from "./cardtilt.js?v=f0b795cc40";

const CURVE = "cubic-bezier(.4, 0, .2, 1)";
const SHEET = "(max-width: 760px)";                     // the phone layout of the card dialog (card.css)
const AWAY = "cg-away";                                 // visibility: hidden, while the ghost stands in for an element
// the view's opacity holds at 0 until 60% of its open's progress (about 45% of the time, when the backdrop is 85% in), and
// is gone by 60% of its close: with no panel behind it, its text never shows over the page while the backdrop is light
const SHEET_IN = 0.6, SHEET_OUT = 0.6;

// the closed durations of base.css (--t-state, --t-fade, --t-move), read once
let T = null;
function times() {
  if (T) return T;
  const cs = getComputedStyle(document.documentElement);
  const ms = (v, d) => parseFloat(cs.getPropertyValue(v)) || d;
  T = { state: ms("--t-state", 120), fade: ms("--t-fade", 200), move: ms("--t-move", 280) };
  return T;
}

let run = null;     // the motion in progress: { dir: "in" | "out", anims, fresh, token }
let home = null;    // what the open card flew from (a tile's card or thumbnail), hidden while the card is in the dialog
let token = 0;

// ---- the ghost: one element for the page, shown in the top layer only while a card is flying
let ghost = null;
const canFly = () => typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;
function ghostEl() {
  if (ghost) return ghost;
  ghost = document.createElement("div");
  ghost.id = "card-ghost";
  ghost.setAttribute("popover", "manual");
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  document.body.append(ghost);
  return ghost;
}
function hideGhost() {
  if (!ghost) return;
  try { if (ghost.matches(":popover-open")) ghost.hidePopover(); } catch { /* already hidden */ }
  ghost.replaceChildren();
}

/** The visual of a pressed control: the card itself, or the card art of a chip, mini card or icon. */
function visualOf(el) {
  if (!el || !el.isConnected) return null;
  if (el.matches(".gc")) return el;
  return el.querySelector("img");
}

/** On screen enough to fly to or from: drawn, and its centre inside the window (never a sliver at the edge). */
function onScreen(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  return r.width > 0 && r.height > 0 && x > 0 && y > 0 && x < innerWidth && y < innerHeight;
}

/** One face of the ghost, drawn at the final size (w): a copy of a game card, or the art of a thumbnail on a card frame. */
function faceOf(el, w) {
  let face;
  if (el.matches(".gc")) {
    face = el.cloneNode(true);
    face.removeAttribute("data-card");
    face.removeAttribute("aria-label");
    face.classList.remove(AWAY);
  } else {
    const img = el.cloneNode(false);
    img.className = "";
    face = document.createElement("div");
    face.className = "cg-thumb";
    face.append(img);
  }
  face.querySelectorAll("img").forEach((i) => { i.loading = "eager"; i.decoding = "sync"; });
  if (face.tagName === "IMG") face.loading = "eager";
  const wrap = document.createElement("div");
  wrap.className = "cg-face";
  // the copy is laid out at the dialog card's size (--u is 1% of the card width; a copied card keeps the tile's own)
  wrap.style.setProperty("--u", w / 100 + "px");
  face.style.setProperty("--u", w / 100 + "px");
  // a dimmed tile (an unowned card once the collection is not empty) leaves dimmed
  const o = parseFloat(getComputedStyle(el).opacity);
  if (o < 1) wrap.style.opacity = String(o);
  wrap.append(face);
  return wrap;
}

/**
 * Take what the flight needs from the pressed control before the dialog changes: its rect and a copy of its face. A
 * control without art of its own (the Card tier list's "Show the card" button) flies from the focused element, the icon
 * it came from. Returns null when there is nothing on screen to fly from.
 */
export function takeOff(from) {
  if (!canFly() || reducedMotion()) return null;
  let v = visualOf(from);
  if (!v && document.activeElement && document.activeElement !== from && !document.activeElement.closest("dialog")) v = visualOf(document.activeElement);
  if (!v || !onScreen(v)) return null;
  return { el: v, rect: v.getBoundingClientRect() };
}

const rectOf = (el) => el.getBoundingClientRect();
const center = (r) => [r.left + r.width / 2, r.top + r.height / 2];

/**
 * The flight's animations, from a tile's rect to the final rect `to` (FLIP), or back when `back` is true: the turn (one
 * transform: travel and scale move evenly with the progress, the angle follows TURN) and the front's face swap (opacity).
 */
function flightAnims(g, from, to, t, back) {
  const [fx, fy] = center(from), [tx, ty] = center(to);
  const p = `perspective(${Math.round(to.width * 4)}px)`;
  const sx = from.width / to.width, sy = from.height / to.height;
  const at = (o, deg) => `${p} translate(${(fx - tx) * (1 - o)}px, ${(fy - ty) * (1 - o)}px) scale(${sx + (1 - sx) * o}, ${sy + (1 - sy) * o}) rotateY(${deg}deg)`;
  const flip = (frames) => (back ? frames.map((f) => ({ ...f, offset: 1 - f.offset })).reverse() : frames);
  const turn = flip(TURN.map(([o, deg]) => ({ offset: o, transform: at(o, deg) })));
  // a dimmed tile (its face carries the tile's opacity) stays dimmed until it hands over
  const dim = parseFloat(g.tile.style.opacity) || 1;
  const swap = (a, b) => flip([{ offset: 0, opacity: a }, { offset: SWAP, opacity: a }, { offset: SWAP, opacity: b }, { offset: 1, opacity: b }]);
  const opts = { duration: t.move, easing: CURVE, fill: "both" };
  return [g.turn.animate(turn, opts), g.tile.animate(swap(dim, 0), opts), g.card.animate(swap(0, 1), opts)];
}

/**
 * Place the ghost on the view's card. One full turn: its front starts as the pressed tile's face and ends as the card the
 * view draws (the two are stacked and swap while the front is turned away), and its back is the game's own card back.
 * Returns { turn, tile, card }, or null when the browser refuses the top layer.
 */
function buildGhost(src, target, to) {
  const g = ghostEl();
  g.replaceChildren();
  Object.assign(g.style, { left: to.left + "px", top: to.top + "px", width: to.width + "px", height: to.height + "px" });
  const turn = document.createElement("div");
  turn.className = "cg-turn";
  const tile = faceOf(src, to.width), card = faceOf(target, to.width), back = backFace(to.width);
  card.style.opacity = "0";
  turn.append(tile, card, back);
  g.append(turn);
  // after showModal, so it is above the dialog in the top layer; if the browser refuses, the card simply does not travel
  try { g.showPopover(); } catch { g.replaceChildren(); return null; }
  return { turn, tile, card };
}

// ---- the card back: the game's own (site/assets/ui/card_back.webp), on the card frame like a thumbnail. Fetched and
// decoded once the page is idle, so the first turn never shows an empty back; never with reduced motion (no turn then).
const BACK_SRC = new URL("../assets/ui/card_back.webp", import.meta.url).href;
let backImg = null;
function loadBack() {
  if (backImg || reducedMotion() || typeof Image === "undefined") return;
  backImg = new Image();
  backImg.decoding = "async";
  backImg.alt = "";
  backImg.src = BACK_SRC;
  if (backImg.decode) backImg.decode().catch(() => { /* drawn on the frame's own ground if it fails */ });
}
if (typeof window !== "undefined") {
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1200));
  if (document.readyState === "complete") idle(loadBack); else window.addEventListener("load", () => idle(loadBack), { once: true });
}
function backFace(w) {
  loadBack();
  const frame = document.createElement("div");
  frame.className = "cg-thumb cg-cardback";
  if (backImg) frame.append(backImg.cloneNode(false));
  const wrap = document.createElement("div");
  wrap.className = "cg-face cg-back";
  wrap.style.setProperty("--u", w / 100 + "px");
  frame.style.setProperty("--u", w / 100 + "px");
  wrap.append(frame);
  return wrap;
}

// the turn's angle by progress (the keyframes share the one curve): the front turns away within the first 15% of the move,
// the back faces the visitor until 75%, then the card's face turns in and settles; the front's tile face hands over to
// the card's face at 45%, while the back is showing
const TURN = [[0, 0], [0.15, 90], [0.75, 270], [1, 360]];
const SWAP = 0.45;

function backdrop(dlg, frames, opts) {
  try { return dlg.animate({ opacity: frames }, { ...opts, pseudoElement: "::backdrop" }); } catch { return null; }
}

/** The sheet's own transform: it rises 24px on a phone; on a desktop it grows from .96 around the card's place. */
function sheetFrames(dlg, target) {
  if (matchMedia(SHEET).matches) { dlg.style.transformOrigin = ""; return ["translateY(24px)", "none"]; }
  if (target) {
    const d = rectOf(dlg), [cx, cy] = center(rectOf(target));
    dlg.style.transformOrigin = `${cx - d.left}px ${cy - d.top}px`;
  } else dlg.style.transformOrigin = "";
  return ["scale(.96)", "none"];
}

const all = (anims) => Promise.all(anims.filter(Boolean).map((a) => a.finished)).catch(() => null);

function stop(anims) { for (const a of anims) if (a) a.cancel(); }

function release(el) { if (el) el.classList.remove(AWAY); }

/**
 * Open: called right after the dialog shows the card (scrolled to the top). `fresh`: the dialog was closed (else another
 * card replaces the open one). `flight`: what takeOff returned, or null for an open without travel.
 */
export function openMotion(dlg, flight, fresh) {
  settle();
  still();      // a tilted or turned card is put back at rest before its place is measured
  const t = times(), my = ++token;
  const target = dlg.querySelector(".cd-art .gc");
  // the card's final place, measured before any animation applies its first frame (the sheet starts at .96 or 24px down)
  const to = target ? rectOf(target) : null;
  // the card that flew in before goes back to its tile at once when another card replaces it
  if (home && (!flight || home !== flight.el)) { release(home); home = null; }
  const anims = [];
  const reduce = reducedMotion();
  if (fresh) {
    if (reduce) {
      anims.push(dlg.animate({ opacity: [0, 1] }, { duration: t.state, easing: CURVE, fill: "both" }));
      anims.push(backdrop(dlg, [0, 1], { duration: t.state, easing: CURVE, fill: "both" }));
    } else {
      // the sheet and the card arrive together (280ms); the backdrop leads (200ms) and the sheet stays clear for the first
      // third of the move, so its text never reads over the bright page
      const sf = sheetFrames(dlg, flight ? target : null);
      anims.push(dlg.animate([{ transform: sf[0], opacity: 0 }, { opacity: 0, offset: SHEET_IN }, { transform: sf[1], opacity: 1 }],
        { duration: t.move, easing: CURVE, fill: "both" }));
      anims.push(backdrop(dlg, [0, 1], { duration: t.fade, easing: CURVE, fill: "both" }));
    }
  } else {
    // another card in the open dialog: its sheet changes in one fade while the card flies in
    const cd = dlg.querySelector(".cd");
    if (cd) anims.push(cd.animate({ opacity: [0, 1] }, { duration: reduce ? t.state : t.fade, easing: CURVE, fill: "both" }));
  }
  if (flight && target && !reduce) {
    // the full art may still be loading: the tile's art (already loaded) stands under it meanwhile
    const art = target.querySelector(".gc-art"), had = flight.el.matches("img") ? flight.el : flight.el.querySelector(".gc-art");
    if (art && !art.complete && had && had.currentSrc) art.style.background = `url("${had.currentSrc}") center top / cover`;
    // a pressed chip inside the dialog is gone by now: its detached copy still gives the front face
    const g = buildGhost(flight.el, target, to);
    if (g) {
      anims.push(...flightAnims(g, flight.rect, to, t, false));
      target.classList.add(AWAY);
      if (flight.el.isConnected && !flight.el.closest("dialog")) { home = flight.el; home.classList.add(AWAY); }
    }
  }
  run = { dir: "in", anims: anims.filter(Boolean), fresh, token: my, target, dlg };
  all(run.anims).then(() => { if (run && run.token === my && run.dir === "in") landIn(); });
}

/** The open run reaches its end: the real card takes the ghost's place. */
function landIn() {
  const r = run;
  run = null;
  release(r.target);
  hideGhost();
  stop(r.anims);
  r.dlg.style.transformOrigin = "";
  sway();       // the landed card sways once, so it reads as a 3D card (cardtilt.js; not with reduced motion)
}

/**
 * Close: plays the open run backwards when it is still running; else flies the card back to its tile when the tile is
 * on screen, or collapses the sheet. `done` closes the dialog (dialogs.js closeNow) once the motion has ended.
 */
export function closeMotion(dlg, done) {
  const t = times();
  if (run && run.dir === "out") return;                   // already closing
  if (run && run.dir === "in" && run.fresh) {
    // closing while it opens: the same motion, backwards from where it is
    const my = ++token;
    run.dir = "out"; run.token = my; run.done = done;
    run.anims.forEach((a) => a.reverse());
    all(run.anims).then(() => { if (run && run.token === my) landOut(); });
    return;
  }
  settle();
  still();      // the card flies back from where it lies at rest, never from a tilt or a turn
  const my = ++token;
  const target = dlg.querySelector(".cd-art .gc");
  const anims = [];
  const reduce = reducedMotion();
  let g = null;
  if (reduce) {
    if (home) { release(home); home = null; }
    anims.push(dlg.animate({ opacity: [1, 0] }, { duration: t.state, easing: CURVE, fill: "both" }));
    anims.push(backdrop(dlg, [1, 0], { duration: t.state, easing: CURVE, fill: "both" }));
  } else if (home && target && canFly() && onScreen(home) && onScreen(target) && (g = buildGhost(home, target, rectOf(target)))) {
    // back to the tile: the same flight, reversed
    anims.push(...flightAnims(g, rectOf(home), rectOf(target), t, true));
    target.classList.add(AWAY);
    // the sheet leaves first (200ms) and the backdrop trails with the card (280ms), so the tile is uncovered as it lands
    const sf = sheetFrames(dlg, target);
    anims.push(dlg.animate({ transform: [sf[1], sf[0]] }, { duration: t.move, easing: CURVE, fill: "both" }));
    anims.push(dlg.animate([{ opacity: 1 }, { opacity: 0, offset: SHEET_OUT }, { opacity: 0 }], { duration: t.fade, easing: CURVE, fill: "both" }));
    anims.push(backdrop(dlg, [1, 0], { duration: t.move, easing: CURVE, fill: "both" }));
  } else {
    // the tile is gone or off screen: the sheet collapses where it is
    if (home) { release(home); home = null; }
    const sf = sheetFrames(dlg, null);
    anims.push(dlg.animate({ transform: [sf[1], sf[0]] }, { duration: t.fade, easing: CURVE, fill: "both" }));
    anims.push(dlg.animate({ opacity: [1, 0] }, { duration: t.fade, easing: CURVE, fill: "both" }));
    anims.push(backdrop(dlg, [1, 0], { duration: t.fade, easing: CURVE, fill: "both" }));
  }
  run = { dir: "out", anims: anims.filter(Boolean), token: my, target, dlg, done };
  all(run.anims).then(() => { if (run && run.token === my) landOut(); });
}

/** The close run reaches its end: the tile shows its card again, then the dialog closes (focus returns to the tile). */
function landOut() {
  const r = run;
  run = null;
  if (home) { release(home); home = null; }
  hideGhost();
  if (r.done) r.done();
  stop(r.anims);
  release(r.target);
  r.dlg.style.transformOrigin = "";
}

/** Bring any motion to its end state at once: an open lands, a close completes. */
export function settle() {
  if (!run) return;
  if (run.dir === "in") landIn();
  else landOut();
}

/** The dialog closed by other means (another dialog took its place): drop every motion, the tile gets its card back. */
export function forget() {
  const r = run;
  run = null;
  token++;
  dropTilt();
  if (r) { stop(r.anims); release(r.target); }
  if (home) { release(home); home = null; }
  hideGhost();
  const dlg = document.querySelector("dialog.card-dlg");
  if (dlg) dlg.style.transformOrigin = "";
}
