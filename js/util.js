// Small DOM and formatting helpers shared by every module. No dependencies.

/** Create an element: h("div.cls#id", {attr: v, onclick}, child, [children], "text"). Text is always set as text. */
export function h(tag, props, ...kids) {
  const m = /^([a-z0-9-]+)((?:[.#][\w-]+)*)$/i.exec(tag);
  const el = document.createElement(m ? m[1] : tag);
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === "#") el.id = part.slice(1);
      else el.classList.add(part.slice(1));
    }
  }
  if (props && typeof props === "object" && !(props instanceof Node) && !Array.isArray(props)) {
    for (const [k, v] of Object.entries(props)) {
      if (v === false || v == null) continue;
      if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className += (el.className ? " " : "") + v;
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k === "style" && typeof v === "object") for (const [p, x] of Object.entries(v)) el.style.setProperty(p, x);
      else el.setAttribute(k, v === true ? "" : v);
    }
  } else if (props != null) kids.unshift(props);
  add(el, kids);
  return el;
}

function add(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Lowercase, accent-free copy used for search. */
export const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const fmtInt = (n) => new Intl.NumberFormat("en-US").format(Math.round(n));

/** 0.7345 -> "73.5%", 0.73 -> "73%": one decimal only when it is not a round number. */
export function pct(p, digits = 1) {
  const v = (p * 100).toFixed(digits);
  return (digits ? v.replace(/\.0+$/, "") : v) + "%";
}
/** Half-width of a 95% interval as "±2.0": percentage points. */
export const pm = (ci) => "±" + (ci * 100).toFixed(1);

export const plural = (n, one, many = one + "s") => `${fmtInt(n)} ${n === 1 ? one : many}`;

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Escape for the one place where a string goes into a RegExp. */
export const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Inline SVG icon from a path list; 16 px strokes, monochrome. */
const ICONS = {
  check: "M3.5 8.5l3 3 6-7",
  plus: "M8 3.5v9M3.5 8h9",
  close: "M4 4l8 8M12 4l-8 8",
  search: "M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM11 11l3.5 3.5",
  chevron: "M4 6l4 4 4-4",
  info: "M8 7.2v4.3M8 4.6v.1M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z",
  filters: "M2.5 4.5h11M4.5 8h7M6.5 11.5h3",
  copy: "M5.5 5.5h7v8h-7zM3.5 10.5v-8h7",
  arrow: "M3 8h10M9 4l4 4-4 4",
  back: "M13 8H3M7 4L3 8l4 4",
};
export function icon(name, size = 16) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("ico");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", ICONS[name]);
  svg.append(p);
  return svg;
}
