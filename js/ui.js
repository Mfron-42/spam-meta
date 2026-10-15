// Shared interface pieces: the disclosure (collapsible region), FLIP reordering, segmented control, filter chip, and the
// small "go to a tab" helper used by the Owned <-> My decks links.

import { h, icon, reducedMotion } from "./util.js?v=a7940cbe94";

export const CURVE = "cubic-bezier(.4, 0, .2, 1)";

/**
 * A collapsible region. Returns {region, set(open)}; the button toggles it. The region always stays in the page (it
 * collapses by grid rows); closed content is visibility:hidden, so it leaves the tab order and the reading order.
 */
export function disclosure(button, region, { open = false, onToggle } = {}) {
  region.classList.add("collapse");
  const set = (v) => {
    region.classList.toggle("open", v);
    button.setAttribute("aria-expanded", String(v));
    if (onToggle) onToggle(v);
  };
  button.addEventListener("click", () => set(button.getAttribute("aria-expanded") !== "true"));
  set(open);
  return { region, set };
}

/** Wrap content so it can collapse: .collapse > .collapse-in */
export const collapsible = (id, ...kids) => h("div.collapse", { id }, h("div.collapse-in", kids));

/**
 * FLIP: remember where children are, run mutate(), then slide the ones that moved (280 ms, transform only) and fade in
 * the new ones (200 ms). Children far outside the viewport are not animated.
 */
export function flip(container, mutate) {
  const first = new Map();
  for (const el of container.children) first.set(el, el.getBoundingClientRect());
  mutate();
  if (reducedMotion()) return;
  const vh = innerHeight;
  for (const el of container.children) {
    const r1 = el.getBoundingClientRect();
    if (r1.bottom < -120 || r1.top > vh + 120) continue;
    const r0 = first.get(el);
    if (!r0) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: CURVE }); continue; }
    const dx = r0.left - r1.left, dy = r0.top - r1.top;
    if (dx || dy) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 280, easing: CURVE });
  }
}

/** Segmented control: sunken track, raised active segment. options: [[value, label]]. */
export function segmented(options, value, onChange, label) {
  const root = h("div.seg", { role: "group", "aria-label": label });
  const btns = options.map(([v, text]) => {
    const b = h("button", { type: "button", "data-v": v, "aria-pressed": String(v === value), onclick: () => { api.set(v); onChange(v); } }, text);
    return b;
  });
  root.append(...btns);
  const api = {
    el: root,
    set(v) { btns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v))); },
  };
  return api;
}

/** Filter chip with an optional sprite class and a live count. */
export function filterChip(label, spriteClass, onClick) {
  const n = h("span.n");
  const b = h("button.chip", { type: "button", "aria-pressed": "false", onclick: onClick }, [
    spriteClass ? h("i." + spriteClass.split(" ").join(".")) : null, h("span.chip-l", label), n,
  ]);
  return { el: b, n };
}

export function setChip(chip, count, pressed, onTitle, offTitle) {
  chip.n.textContent = String(count);
  chip.el.setAttribute("aria-pressed", String(pressed));
  const dead = !count && !pressed;
  chip.el.disabled = dead;
  chip.el.title = dead ? offTitle : onTitle;
}

/** Scroll the page so an element is just under the sticky header. */
export function scrollToEl(el) {
  const top = el.getBoundingClientRect().top + scrollY - (parseInt(getComputedStyle(document.documentElement).scrollPaddingTop) || 0) - 8;
  scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? "auto" : "smooth" });
}

export { icon, h };

/**
 * Copy text to the clipboard. Returns true when it was copied. When the browser refuses (no permission, an insecure
 * page, an old browser), the text in `source` (an input, a textarea or any element) is selected instead, so the visitor
 * can finish with Ctrl+C or a long press, and false is returned.
 */
export async function copyText(text, source) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall through to the selection */ }
  try {
    if (source && typeof source.select === "function") source.select();
    else if (source) { const sel = window.getSelection(); sel.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(source); sel.addRange(r); }
    return !!document.execCommand("copy");
  } catch (e) { return false; }
}
