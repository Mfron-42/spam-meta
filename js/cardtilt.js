// Cards held like physical 3D cards (DESIGN.md "Card in hand"; SPEC.md section 3.3). Two surfaces share one engine:
// - The card view's big card (the hero): a hovering mouse or pen tilts it up to 28° at its edges, its layers separate in
//   depth (the art sinks, the name, bars and HP rise a little, the orb, gold hexagon and rarity gem pop forward), a soft light
//   follows the pointer, and at a strong tilt the card shows a thickness and the edge of the S card back behind it. Held
//   (mouse down, or a finger moved sideways) it turns on its vertical axis under the pointer, the S back on the far side, and
//   on release turns back to its face by the shorter way. For its first second after opening it sways once, so a visitor
//   sees it is a 3D card; then it rests.
// - Every card tile (cardTile: the Codex grid): the same tilt, up to 20° at its edges, with the same layers and light and a
//   thin edge behind it. Hover only: a mouse or a pen, never a touch, so phones get nothing. No drag, no back.
// Motion: entering eases the tilt in (200 ms), leaving eases it back to rest (280 ms), on the site's one curve; between the
// two the tilt follows the pointer frame by frame (a user's own move is never eased).
// How: one requestAnimationFrame loop for the whole page, running only while a card is being moved by the pointer or an
// ease is running, and stopped at rest, where every transform, CSS variable, 3D context and will-change is removed (so the
// card is drawn sharp and the open and close flights measure and copy it at rest). Hit areas never move: a tile's button
// keeps its box and only the layer inside it (.gc-in) is turned; the hero's events are read on its tile (.cell). Pointer
// only: nothing for the keyboard or a screen reader. With prefers-reduced-motion nothing moves.

import { reducedMotion } from "./util.js?v=a12dd2e24e";

const HERO = { maxY: 28, maxX: 24, persp: 3, art: 10, front: 3, pop: 10 };    // degrees at the edges; perspective in card
const TILE = { maxY: 20, maxX: 18, persp: 3.5, art: 10, front: 3, pop: 8 };   // widths; layer depths in % of the card width
const START = 6;                  // px a press travels before it becomes a drag (hero)
const HALF_TURN = 1.25;           // card widths of drag for a half turn (a full turn is 2.5 card widths)
const ENTER = 200, LEAVE = 280, BACK = 280, SWAY = 280;   // DESIGN.md durations: fade/size (200) and move (280)
const SLABS = 5;                  // layers of the hero's thickness, between its face and the S back 7% of its width behind
// the hero's one sway after opening: three moves of 280 ms on the one curve, through two tilts, back to rest
const SWAY_PATH = [[0.55, -0.3], [-0.45, 0.2], [0, 0]];
const AWAY = "cg-away";           // cardmotion.js: the card is flying (a ghost stands in for it), so it is not held

// the site's one curve, cubic-bezier(.4, 0, .2, 1), solved for y at time x
const curve = (() => {
  const x1 = 0.4, y1 = 0, x2 = 0.2, y2 = 1;
  const bx = (t) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const by = (t) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 24; i++) { t = (lo + hi) / 2; if (bx(t) < x) lo = t; else hi = t; }
    return by(t);
  };
})();

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const RAD = Math.PI / 180;
// a hover is a mouse or a pen; a touch never tilts by hovering (a laptop with a touchscreen still tilts under its mouse)
const hovers = (e) => e.pointerType === "mouse" || e.pointerType === "pen";
const VARS = ["--tx", "--ty", "--th", "--ax", "--ay", "--fx", "--fy", "--oz", "--u"];

// ---- the one loop: every card being moved or easing, drawn in one frame
const live = new Set();     // cards that asked for a frame
const held = new Set();     // cards not at rest (a still() puts all of them back)
let raf = 0;
function kick(c) {
  live.add(c);
  held.add(c);
  if (!raf) raf = requestAnimationFrame(tick);
}
function tick(now) {
  raf = 0;
  const due = [...live];
  live.clear();
  for (const c of due) if (draw(c, now)) live.add(c);
  if (live.size) raf = requestAnimationFrame(tick);
}

/** A card the engine can move: `hit` takes the pointer and never moves, `rot` is turned. */
function holder(kind, hit, rot, gc, extra = {}) {
  return { kind, cfg: kind === "hero" ? HERO : TILE, hit, rot, gc, hx: 0, hy: 0, h: 0, a: 0, hover: false, drag: null,
    tw: { h: null, a: null }, sw: null, w: 0, ...extra };
}

function ease(c, key, to, dur) {
  const from = c[key];
  c.tw[key] = from === to ? null : { from, to, t0: performance.now(), dur };
  if (!c.tw[key]) c[key] = to;
  kick(c);
}

function point(c, e, r) {
  c.w = (c.kind === "tile" && r.width) || c.gc.offsetWidth || r.width;   // a tile's hit box is its card
  c.hx = clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2), -1, 1);
  c.hy = clamp((e.clientY - (r.top + r.height / 2)) / (r.height / 2), -1, 1);
}

function draw(c, now) {
  for (const key of ["h", "a"]) {
    const tw = c.tw[key];
    if (!tw) continue;
    const p = clamp((now - tw.t0) / tw.dur, 0, 1);
    c[key] = tw.from + (tw.to - tw.from) * curve(p);
    if (p >= 1) { c[key] = tw.to; c.tw[key] = null; }
  }
  if (c.sw) {
    // the sway after opening: it gives way to the visitor's own pointer at once
    if (c.hover || (c.drag && c.drag.on) || flying(c)) { c.sw = null; if (!c.hover) c.hx = c.hy = 0; }
    else {
      // (a frame's time can be a little older than the moment the sway was asked for)
      const k = Math.max(0, now - c.sw.t0) / SWAY, i = Math.floor(k);
      if (i >= SWAY_PATH.length) { c.sw = null; c.hx = c.hy = 0; c.h = 0; }
      else {
        const from = i > 0 ? SWAY_PATH[i - 1] : [0, 0], to = SWAY_PATH[i], p = curve(k - i);
        c.hx = from[0] + (to[0] - from[0]) * p;
        c.hy = from[1] + (to[1] - from[1]) * p;
        c.h = 1;
      }
    }
  }
  if (c.a !== 0 && !c.tw.a && !(c.drag && c.drag.on) && Math.abs(c.a % 360) < 1e-6) c.a = 0;
  const busy = c.hover || (c.drag && c.drag.on) || c.tw.h || c.tw.a || c.sw;
  if (!busy && c.a === 0) { c.h = 0; rest(c); return false; }
  if (!c.rot.classList.contains("tilt-on")) {
    // the 3D context, the layers' depth and will-change exist only while the card is held
    if (c.kind === "hero") c.rot.style.setProperty("--u", c.gc.style.getPropertyValue("--u") || (c.gc.offsetWidth / 100) + "px");
    c.rot.classList.add("tilt-on");
    if (c.kind === "tile") c.cell.classList.add("tilt-hot");
  }
  const g = c.cfg, tx = c.hx * c.h, ty = c.hy * c.h;
  const hy = tx * g.maxY, hx = -ty * g.maxX;          // the hover tilt (degrees), without the drag's turn
  const w = c.w || c.gc.offsetWidth || 200;
  c.rot.style.transform = `perspective(${Math.round(w * g.persp)}px) rotateX(${hx.toFixed(3)}deg) rotateY(${(hy + c.a).toFixed(3)}deg)`;
  // layers inside the face (which is flat, being clipped to its round corners) shift as the depths they stand for would
  // under this tilt: the art sinks (away from the pointer), the name, bars and HP rise (toward it). The orb, hexagon and
  // gem sit truly in front (translateZ, scaled in by the hover's strength), the light follows the pointer.
  const sy = Math.sin(hy * RAD), sx = Math.sin(-hx * RAD);
  const set = (k, v) => c.rot.style.setProperty(k, v.toFixed(4));
  set("--tx", tx); set("--ty", ty); set("--th", c.h);
  set("--ax", -g.art * sy); set("--ay", -g.art * sx);
  set("--fx", g.front * sy); set("--fy", g.front * sx);
  set("--oz", g.pop * c.h);
  // (the hero's thickness and S back face forward and hide their backs, so a turned card never shows them through itself)
  // only an ease or the sway asks for the next frame; a still pointer costs nothing, its next move asks again
  return !!(c.tw.h || c.tw.a || c.sw);
}

/** At rest: no transform, no variable, no 3D context, no will-change; the card is drawn exactly as it is without the engine. */
function rest(c) {
  c.rot.style.removeProperty("transform");
  for (const p of VARS) c.rot.style.removeProperty(p);
  c.rot.classList.remove("tilt-on");
  if (c.cell) c.cell.classList.remove("tilt-hot", "ct-drag");
  held.delete(c);
  live.delete(c);
}

function stop(c) {
  if (c.drag && c.drag.on) { try { c.hit.releasePointerCapture(c.drag.id); } catch { /* already released */ } }
  Object.assign(c, { hx: 0, hy: 0, h: 0, a: 0, hover: false, drag: null, tw: { h: null, a: null }, sw: null });
  rest(c);
}

const flying = (c) => c.gc.classList.contains(AWAY);

/** Put every card back at rest at once (before a flight measures or copies one, or when the view closes). */
export function still() {
  for (const c of [...held]) stop(c);
  if (hero) stop(hero);
  if (tile) tile = null;
  if (raf && !live.size) { cancelAnimationFrame(raf); raf = 0; }
}

// =============================================================== the hero: the card view's big card
let hero = null;

/** Hold the card view's tile (`.cd-art .cell`) like a card. Called each time the view draws a card. */
export function attachTilt(cell) {
  if (hero) stop(hero);
  hero = null;
  if (!cell || reducedMotion() || typeof requestAnimationFrame === "undefined") return;
  const cw = cell.querySelector(".cw"), gc = cw && cw.querySelector(".gc");
  if (!gc) return;
  const src = new URL("../assets/ui/card_back.webp", import.meta.url).href;
  const img = () => Object.assign(document.createElement("img"), { src, alt: "", decoding: "async", draggable: false });
  // behind the face: the thickness (slabs of the card's edge) and the S back, seen at a strong tilt; and the back itself,
  // facing the other way, seen in a turn
  const peek = document.createElement("div");
  peek.className = "ct-peek";
  const sheet = document.createElement("div");
  sheet.className = "ct-sheet";
  sheet.append(img());
  peek.append(sheet);
  for (let i = 1; i <= SLABS; i++) {
    const s = document.createElement("div");
    s.className = "ct-slab";
    s.style.setProperty("--i", String(i));
    peek.append(s);
  }
  const back = document.createElement("div");
  back.className = "cg-thumb cg-cardback ct-back";
  back.append(img());
  for (const el of [peek, back]) el.setAttribute("aria-hidden", "true");
  cw.prepend(peek, back);
  cell.classList.add("ct");
  hero = holder("hero", cell, cw, gc, { cell });
  cell.addEventListener("pointerenter", heroMove);
  cell.addEventListener("pointermove", heroMove);
  cell.addEventListener("pointerleave", heroLeave);
  cell.addEventListener("pointerdown", heroDown);
  cell.addEventListener("pointerup", heroUp);
  cell.addEventListener("pointercancel", heroUp);
}

/** The view closed: forget the card. */
export function dropTilt() { still(); hero = null; }

/** The view's card has landed (cardmotion.js): it sways once, unless the pointer already holds it. */
export function sway() {
  const c = hero;
  if (!c || reducedMotion() || c.hover || c.drag || flying(c) || !c.gc.isConnected) return;
  c.w = c.gc.offsetWidth || c.w;
  c.sw = { t0: performance.now() };
  kick(c);
}

function heroMove(e) {
  const c = hero;
  if (!c || flying(c) || reducedMotion()) return;
  const d = c.drag;
  if (d && d.id === e.pointerId) {
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.on && Math.abs(dx) > START && (e.pointerType !== "touch" || Math.abs(dx) > Math.abs(dy))) {
      d.on = true;
      d.x = e.clientX;   // the turn starts from here, so it does not jump by the threshold
      try { c.hit.setPointerCapture(e.pointerId); } catch { /* the pointer is gone */ }
      c.cell.classList.add("ct-drag");
      c.tw.a = null;
      d.a0 = c.a;
    }
    if (d.on) {
      c.a = clamp(d.a0 + ((e.clientX - d.x) / (c.w || 1)) * (180 / HALF_TURN), -360, 360);
      if (hovers(e)) point(c, e, c.hit.getBoundingClientRect());
      kick(c);
      return;
    }
  }
  if (!hovers(e)) return;
  point(c, e, c.hit.getBoundingClientRect());
  if (!c.hover) { c.hover = true; c.sw = null; ease(c, "h", 1, ENTER); }
  kick(c);
}

function heroLeave(e) {
  const c = hero;
  if (!c || (c.drag && c.drag.on)) return;   // a held drag keeps the card until it is released
  if (c.hover && hovers(e)) { c.hover = false; ease(c, "h", 0, LEAVE); }
}

function heroDown(e) {
  const c = hero;
  if (!c || flying(c) || reducedMotion() || (e.pointerType === "mouse" && e.button !== 0)) return;
  c.w = c.gc.offsetWidth || c.w;   // the turn's scale (a touch never hovers, so it is measured here)
  c.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false, a0: c.a };
}

function heroUp(e) {
  const c = hero;
  if (!c || !c.drag || c.drag.id !== e.pointerId) return;
  const was = c.drag.on;
  c.drag = null;
  c.cell.classList.remove("ct-drag");
  if (!was) return;
  try { c.hit.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  // back to the face by the shorter way (the nearest whole turn), on the one curve, without overshoot
  ease(c, "a", Math.round(c.a / 360) * 360, BACK);
  // released outside the card: the hover tilt eases out too
  const r = c.hit.getBoundingClientRect();
  const inside = e.type === "pointerup" && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (c.hover && !inside) { c.hover = false; ease(c, "h", 0, LEAVE); }
}

// =============================================================== the tiles: every cardTile button on the page
// One set of delegated listeners for the whole page (never one per tile); a tile gets its holder on first hover.
const tiles = new WeakMap();
let tile = null;            // the tile under the pointer, if any
let last = null;            // the pointer's last position, to find the tile again after a scroll

/** The tile button under an event target: a card tile's game card (it carries the turned layer .gc-in), not flying. The
 * tile's owned toggle, on the card's corner, counts as the card, so the tilt does not drop under it. */
function tileAt(t) {
  if (!t || !t.closest) return null;
  const own = t.closest(".cw > .own");
  const gc = own ? own.parentElement.querySelector(":scope > button.gc") : t.closest("button.gc");
  if (!gc || gc.classList.contains(AWAY) || !gc.firstElementChild || !gc.firstElementChild.classList.contains("gc-in")) return null;
  let c = tiles.get(gc);
  if (!c) {
    const cell = gc.closest(".cell");
    if (!cell) return null;
    c = holder("tile", gc, gc.firstElementChild, gc, { cell });
    tiles.set(gc, c);
  }
  return c;
}

function leaveTile() {
  const c = tile;
  tile = null;
  if (c && c.hover) { c.hover = false; ease(c, "h", 0, LEAVE); }
}

function tileMove(e) {
  if (!hovers(e)) return;
  last = { x: e.clientX, y: e.clientY };
  if (reducedMotion()) { if (tile) { const c = tile; tile = null; stop(c); } return; }
  const c = tileAt(e.target);
  if (c !== tile) {
    leaveTile();
    if (!c) return;
    tile = c;
    c.r = null;
  }
  if (!c) return;
  // the button's box never moves with the tilt: it is measured once per hover (and again after a scroll), not per move
  if (!c.r) c.r = c.hit.getBoundingClientRect();
  point(c, e, c.r);
  if (!c.hover) { c.hover = true; ease(c, "h", 1, ENTER); }
  kick(c);
}

// the page scrolled under a still pointer: the tile under it changes, or the same tile sees the pointer elsewhere
function tileScroll() {
  if (!tile || !last) return;
  tile.r = null;
  const el = document.elementFromPoint(last.x, last.y);
  tileMove({ pointerType: "mouse", clientX: last.x, clientY: last.y, target: el });
}

/** Install the tiles' hover tilt (once, at start). */
export function holdTiles() {
  if (typeof document === "undefined" || typeof requestAnimationFrame === "undefined") return;
  document.addEventListener("pointermove", tileMove, { passive: true });
  document.addEventListener("pointerout", (e) => { if (!e.relatedTarget && tile) leaveTile(); }, { passive: true });
  document.addEventListener("scroll", tileScroll, { passive: true, capture: true });
}
