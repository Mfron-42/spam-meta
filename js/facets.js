// The card filters (DESIGN.md "Card filters"): one trigger per group in the toolbar, its popover under the toolbar from 760px;
// on a phone the "Filters" button opens every group in a bottom sheet. The active filters read as one line of removable chips,
// each group's values joined by its "and" / "or" (a button that switches it), and every card can say why it matched. The model
// (matching, counts, reasons, the address) is facetmodel.js; the Codex and the Card tier list use this one component.

import { h, icon, fmtInt, norm } from "./util.js?v=d299a81e8e";
import { t } from "./i18n.js?v=d299a81e8e";
import { getLang } from "./store.js?v=d299a81e8e";
import { elName, raName } from "./cards.js?v=d299a81e8e";
import { elementNode } from "./cardtext.js?v=d299a81e8e";
import { segmented, chromeBottom } from "./ui.js?v=d299a81e8e";
import { OP_GROUPS, TALENT_GROUPS, NUMS, chipCount, filterCount, reasons } from "./facetmodel.js?v=d299a81e8e";

const PHONE = "(max-width: 759px)";
const L = (o, k) => o[`${k}_${getLang()}`] || o[`${k}_en`] || "";
// the groups whose name needs a line of help in their popover (element, rarity and patch say it all)
const HINTS = new Set(["hit", "gen", "fx", "tox", "tgt"]);
// the effects in five small families, so 32 chips read as five short lists (i18n "fxc.<id>"); an effect no family lists joins
// the last one
const FX_FAMILIES = [
  ["cd", ["temporality", "eternity", "echo", "reset"]],
  ["life", ["heal", "revive", "phoenix", "death", "shield", "maxhp", "vampirism", "immunity"]],
  ["dmg", ["crit", "boost", "area", "pierce", "accuracy", "poison", "erosion", "reflect", "revenge", "absorb"]],
  ["ctl", ["taunt", "freeze", "stun", "smoke", "vanish", "weaken", "purge", "transform"]],
  ["eco", ["gold", "luck"]],
];
const HEART_ORDER = ["fire", "water", "earth", "nature", "light", "shadow"];

// ---- the address: the query of the filters belongs to the tab on screen (#codex, #card-tiers); another tab drops it, and it
// comes back with its tab. One listener for the page, so two views never write over each other.
const owners = new Map();
// the tabs that keep their filters in the address; until such a tab's view has read the address, nobody writes it
const ADDRESS_TABS = new Set(["codex", "card-tiers"]);
let wired = false;
/** The tab the address shows ("codex" for #codex/<card key>). */
export const hashTab = () => location.hash.replace(/^#/, "").split("/")[0] || "";
/** Registers the query of a tab's filters (a function returning "?..." or ""), and writes the address now. */
export function ownAddress(tab, query) {
  owners.set(tab, query);
  if (!wired) { window.addEventListener("hashchange", writeAddress); wired = true; }
  writeAddress();
}
/** Writes the query of the tab on screen into the address (no history entry). */
export function writeAddress() {
  const tab = hashTab(), f = owners.get(tab);
  if (!f && ADDRESS_TABS.has(tab)) return;          // its view is still loading: the address is its to read first
  const q = f ? f() : "";
  if (q === location.search || (!q && !location.search)) return;
  try { history.replaceState(history.state, "", location.pathname + q + location.hash); } catch (e) { /* the address stays as it is */ }
}

/** The label of one value of one group, and its sprite class (element orb, rarity gem) when it has one. */
export function valueLabel(index, g, v, patch) {
  if (g === "el") return { text: elName(v), sprite: "sp-el-" + v };
  if (g === "ra") return { text: raName(v), sprite: "sp-gem-" + v };
  if (g === "hit" || g === "gen") return v === "var" ? { text: t("fv.var") } : { text: elName(v), sprite: "sp-el-" + v, el: v };
  if (g === "fx") return { text: t("eff." + v), hint: t("eff." + v + ".tip") };
  if (g === "tox") {
    const x = index.tox.get(v);
    return { text: x ? L(x, "name") : v, sprite: x && x.el ? "sp-el-" + x.el : null };
  }
  if (g === "tgt") return { text: t("tgt." + v), hint: t("tgt." + v + ".tip") };
  if (g === "pc") return { text: t("pc." + v, { patch }) };
  return { text: v };
}

/** One value of a number filter, formatted for the language: "1,100", "50%" / "1 100", "50\u00a0%". */
const numText = (n, v) => (n.pct ? `${fmtInt(v)}${getLang() === "fr" ? "\u00a0%" : "%"}` : fmtInt(v));

/** A number filter's range as words: "≥ 50%", "≤ 2", "400–900". */
export function rangeText(n, [lo, hi], [lo0, hi0]) {
  const f = (v) => numText(n, v);
  if (lo > lo0 && hi < hi0) return lo === hi ? f(lo) : `${f(lo)}–${f(hi)}`;
  return lo > lo0 ? `≥ ${f(lo)}` : `≤ ${f(hi)}`;
}

/**
 * The filter UI of one view.
 *  - id: a prefix for element ids ("cx", "ct")
 *  - index: facetmodel buildIndex(); S: the state (facetmodel emptyState / fromQuery), changed in place
 *  - triggers: [[trigger id, [groups]]] in toolbar order; a group is a set group, "num" or "own"
 *  - items(): the index entries the view filters; opts(): {owned, text} for the counts; shown(): how many it shows now
 *  - patch: the card data's patch (the "Changed in" values); onChange(): the view re-applies
 *  - sentenceClear: false when the view has its own "Clear filters" beside the line (the Card tier list)
 * Returns {bar, sheetBtn, sentence, refresh(), reasonsFor(x), destroy(), openSheet()}.
 */
export function facetFilters({ id, index, S, triggers, items, opts, shown, patch, onChange, sentenceClear = true }) {
  const chips = [];            // {g, v, el, n}
  const segs = [];             // {g, seg}
  const sliders = [];          // {n, lo, hi, out, fill}
  const switches = [];         // talents switches
  const ownSegs = [];
  const clears = [];           // {groups, el}
  const bodies = new Map();    // trigger id -> its body node (moved between the popover and the sheet)
  const trig = new Map();      // trigger id -> {btn, n}
  const groupChips = {};       // group -> its chips, for the roving focus
  const cur = {};              // group -> the value of the chip last used (it keeps the group's tab stop)
  const uid = id;
  const change = () => { onChange(); refresh(); };

  // the values of a group in display order: the tox hearts first, by element, then every tox by its name in the page language
  function ordered(g) {
    const vals = index.values[g].slice();
    if (g !== "tox") return vals;
    const name = (v) => valueLabel(index, g, v, patch).text;
    const heart = (v) => { const x = index.tox.get(v); return x && x.el ? HEART_ORDER.indexOf(x.el) : -1; };
    return vals.sort((a, b) => (heart(a) < 0) - (heart(b) < 0) || heart(a) - heart(b) || name(a).localeCompare(name(b), getLang()));
  }

  // ---- one group's body
  function setBody(g) {
    const head = h("div.fg-head", [h("h2.fg-t", t("fg." + g))]);
    if (OP_GROUPS.has(g)) {
      const seg = segmented([["any", t("fg.any")], ["all", t("fg.all")]], S.op[g], (v) => { S.op[g] = v; change(); }, t("fg.opAria", { group: t("fg." + g) }));
      seg.el.classList.add("fg-op");
      segs.push({ g, seg });
      head.append(seg.el);
    }
    const hintText = HINTS.has(g) ? t("fg." + g + ".hint") : "";
    const hint = hintText ? h("p.fg-hint", hintText) : null;
    const mine = [];
    const chipOf = (v) => {
      const lab = valueLabel(index, g, v, patch);
      const n = h("span.n");
      const el = h("button.chip", { type: "button", "aria-pressed": "false", tabindex: "-1",
        onclick: () => { cur[g] = v; toggle(S.sel[g], v); change(); } }, [lab.sprite ? h("i." + lab.sprite) : null, h("span.chip-l", lab.text), n]);
      // a chip that explains itself says it in the group's help line while it is pointed at or focused (a title alone would
      // leave touch and keyboard without it)
      if (lab.hint && hint) {
        const say = () => { hint.textContent = `${lab.text}${t("why.sep")}${lab.hint}`; hint.classList.add("on"); };
        const back = () => { hint.textContent = hintText; hint.classList.remove("on"); };
        // the focus a popover gives its chip on open is not a reading: only a keyboard focus (focus-visible) speaks
        el.addEventListener("pointerenter", say); el.addEventListener("focus", () => { if (el.matches(":focus-visible")) say(); });
        el.addEventListener("pointerleave", back); el.addEventListener("blur", back);
      }
      const c = { g, v, el, n, hint: lab.hint || "", text: lab.text };
      chips.push(c); mine.push(c);
      return el;
    };
    let list;
    if (g === "fx") {
      const rest = new Set(index.values.fx);
      const fams = FX_FAMILIES.map(([fam, vals]) => [fam, vals.filter((v) => rest.delete(v))]);
      fams[fams.length - 1][1].push(...rest);
      list = h("div.fg-fams", { role: "group", "aria-label": t("fg.fx") }, fams.filter(([, vals]) => vals.length).map(([fam, vals]) =>
        h("div.fg-fam", [h("p.fg-fam-t", { id: `${uid}-fam-${fam}` }, t("fxc." + fam)),
          h("div.chips", { role: "group", "aria-labelledby": `${uid}-fam-${fam}` }, vals.map(chipOf))])));
    } else {
      list = h("div.chips.fg-chips", { role: "group", "aria-label": t("fg." + g) }, ordered(g).map(chipOf));
    }
    // one tab stop per group: the arrows move between its chips (roving focus), Home and End go to its ends
    groupChips[g] = mine;
    list.addEventListener("keydown", (e) => {
      const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: "first", End: "last" };
      if (!(e.key in keys)) return;
      const on = mine.filter((c) => !c.el.disabled), i = on.findIndex((c) => c.el === document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const k = keys[e.key];
      const next = k === "first" ? on[0] : k === "last" ? on[on.length - 1] : on[(i + k + on.length) % on.length];
      cur[g] = next.v;
      rove(g);
      next.el.focus();
    });
    const foot = h("div.fg-foot");
    if (TALENT_GROUPS.has(g)) foot.append(talentSwitch());
    const clear = h("button.btn.ghost.fg-clear", { type: "button", onclick: () => { S.sel[g] = []; change(); } }, t("fg.clear"));
    clears.push({ groups: [g], el: clear });
    foot.append(clear);
    return h("section.fg", { "data-g": g }, [head, hint, list, foot]);
  }

  /** The chip of a group in the tab order: the one last used if it can be, else the first picked, else the first enabled. */
  function rove(g) {
    const mine = groupChips[g] || [];
    const on = mine.filter((c) => !c.el.disabled);
    const pick = on.find((c) => c.v === cur[g]) || on.find((c) => S.sel[g].includes(c.v)) || on[0];
    for (const c of mine) c.el.tabIndex = c === pick ? 0 : -1;
  }

  function talentSwitch() {
    const b = h("button.switch", { type: "button", role: "switch", "aria-checked": String(S.tal), title: t("fg.talTitle"),
      onclick: () => { S.tal = !S.tal; change(); } }, [h("span.sw-track", { "aria-hidden": "true" }, h("span.sw-knob")), h("span.sw-l", t("fg.tal"))]);
    switches.push(b);
    return b;
  }

  function numBody() {
    const rows = NUMS.map((n) => {
      const [lo0, hi0] = index.ranges[n.id];
      const cur = S.num[n.id] || [lo0, hi0];
      const mk = (which, v) => h("input.rg-in", { type: "range", min: lo0, max: hi0, step: n.step, value: v,
        "aria-label": t(which === "lo" ? "fg.numMin" : "fg.numMax", { name: t("fn." + n.id) }) });
      const lo = mk("lo", cur[0]), hi = mk("hi", cur[1]);
      const out = h("output.rg-out");
      const fill = h("span.rg-fill");
      const set = (src) => {
        let a = Number(lo.value), b = Number(hi.value);
        if (a > b) { if (src === lo) { b = a; hi.value = b; } else { a = b; lo.value = a; } }
        if (a <= lo0 && b >= hi0) delete S.num[n.id]; else S.num[n.id] = [a, b];
        change();
      };
      lo.addEventListener("input", () => set(lo));
      hi.addEventListener("input", () => set(hi));
      sliders.push({ n, lo, hi, out, fill });
      // a press on the rail (the thumbs alone take the pointer) brings the nearer thumb there, as a single slider does
      const track = h("div.rg-track", [h("span.rg-rail", { "aria-hidden": "true" }, fill), lo, hi]);
      track.addEventListener("pointerdown", (e) => {
        if (e.target === lo || e.target === hi) return;
        const r = track.getBoundingClientRect(), pad = 12;
        const f = Math.min(1, Math.max(0, (e.clientX - r.left - pad) / Math.max(1, r.width - 2 * pad)));
        const v = Math.round((lo0 + f * (hi0 - lo0)) / n.step) * n.step;
        const near = Math.abs(v - Number(lo.value)) <= Math.abs(v - Number(hi.value)) ? lo : hi;
        near.value = Math.min(hi0, Math.max(lo0, v));
        set(near);
        near.focus({ preventScroll: true });
      });
      return h("div.rg", [
        h("div.rg-top", [h("span.rg-l", [t("fn." + n.id), n.per === "ability" ? h("span.rg-per", t("fg.perAbility")) : null]), out]),
        track,
      ]);
    });
    const clear = h("button.btn.ghost.fg-clear", { type: "button", onclick: () => { S.num = {}; change(); } }, t("fg.clear"));
    clears.push({ groups: ["num"], el: clear });
    return h("section.fg", { "data-g": "num" }, [h("div.fg-head", [h("h2.fg-t", t("fg.num"))]), h("p.fg-hint", t("fg.num.hint")),
      h("div.rgs", rows), h("div.fg-foot", clear)]);
  }

  function ownBody() {
    const seg = segmented([["all", t("cx.all")], ["owned", t("cx.owned")], ["missing", t("cx.missing")]], S.own, (v) => { S.own = v; change(); }, t("cx.ownAria"));
    ownSegs.push(seg);
    return h("section.fg", { "data-g": "own" }, [h("div.fg-head", [h("h2.fg-t", t("fg.own"))]), seg.el]);
  }

  const groupBody = (g) => (g === "num" ? numBody() : g === "own" ? ownBody() : setBody(g));

  for (const [tid, groups] of triggers) {
    const kids = groups.filter((g) => g === "num" || g === "own" || index.values[g].length).map(groupBody);
    if (!kids.length) continue;
    bodies.set(tid, h("div.fg-body", kids));
  }
  const groupsOf = (tid) => (triggers.find(([x]) => x === tid) || [, []])[1];
  const activeIn = (groups) => groups.reduce((k, g) => k + (g === "num" ? Object.keys(S.num).length : g === "own" ? (S.own !== "all" ? 1 : 0) : S.sel[g].length), 0);

  // ---- the toolbar triggers and their popover (from 760px)
  // the popover stays in the page (closed: invisible, out of the reading and tab order); it opens from its trigger in 100ms
  const pop = h(`div.fpop#${id}-fpop`, { role: "dialog", "aria-modal": "false" });
  let openTid = null;
  const bar = h("div.fbar", { role: "group", "aria-label": t("fg.barAria") });
  for (const [tid] of triggers) {
    if (!bodies.has(tid)) continue;
    const n = h("span.fbar-n");
    const btn = h("button.fbar-b", { type: "button", "aria-expanded": "false", "aria-controls": `${id}-fpop`, "data-t": tid,
      title: tid === "more" ? t(groupsOf(tid).includes("own") ? "ft.moreTitle" : "ft.moreTitlePc") : null,
      onclick: () => (openTid === tid ? closePop(true) : openPop(tid)) }, [h("span", t("ft." + tid)), n, icon("chevron")]);
    trig.set(tid, { btn, n });
    bar.append(btn);
  }
  const barWrap = h("div.fbar-w", [bar, pop]);

  function openPop(tid) {
    if (openTid) closePop(false);
    const { btn } = trig.get(tid);
    openTid = tid;
    pop.replaceChildren(bodies.get(tid));
    pop.setAttribute("aria-label", t("ft." + tid));
    pop.classList.toggle("wide", groupsOf(tid).some((g) => g === "fx" || g === "tox"));
    // under its trigger, kept inside the toolbar's width
    const w = barWrap.clientWidth, pw = pop.offsetWidth;
    const left = Math.max(0, Math.min(btn.offsetLeft, w - pw));
    pop.style.left = left + "px";
    pop.style.transformOrigin = `${btn.offsetLeft - left + btn.offsetWidth / 2}px 0`;
    btn.setAttribute("aria-expanded", "true");
    fit(btn);
    pop.classList.add("on");
    // focus goes to the group's chip in the tab order (the any / all switch waits for two picks), else its first control
    const first = pop.querySelector(".chip[tabindex='0']:not(:disabled)") || pop.querySelector("button:not(:disabled), input");
    if (first) first.focus({ preventScroll: true });
    document.addEventListener("pointerdown", outside, true);
  }
  /** The popover keeps inside the window: when its group does not fit under its trigger, the page first scrolls the toolbar up
   * under the header (the Codex's toolbar then sticks there), then the popover takes the height left and scrolls inside. */
  function fit(btn) {
    pop.style.maxHeight = "none";
    const want = pop.scrollHeight;
    let room = innerHeight - pop.getBoundingClientRect().top - 16;
    if (room < want) {
      const up = Math.min(want - room, btn.getBoundingClientRect().top - chromeBottom() - 64);
      if (up > 0) window.scrollBy(0, up);
      room = innerHeight - pop.getBoundingClientRect().top - 16;
    }
    pop.style.maxHeight = Math.max(240, room) + "px";
  }

  function closePop(focus) {
    if (!openTid) return;
    const { btn } = trig.get(openTid);
    btn.setAttribute("aria-expanded", "false");
    pop.classList.remove("on");
    openTid = null;
    document.removeEventListener("pointerdown", outside, true);
    if (focus) btn.focus({ preventScroll: true });
  }
  function outside(e) {
    if (!pop.contains(e.target) && !bar.contains(e.target)) closePop(false);
  }
  pop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePop(true); return; }
    if (e.key !== "Tab" || !openTid) return;
    // the popover reads as if it sat right after its trigger: Shift+Tab from its first control goes back to the trigger, Tab
    // from its last control goes on to the next trigger (and closes it)
    const all = [...pop.querySelectorAll("button:not(:disabled), input")].filter((x) => x.offsetParent && x.tabIndex >= 0);
    const btn = trig.get(openTid).btn;
    if (e.shiftKey && document.activeElement === all[0]) { e.preventDefault(); btn.focus(); }
    else if (!e.shiftKey && document.activeElement === all[all.length - 1]) {
      const next = btn.nextElementSibling;
      e.preventDefault();
      closePop(!next);
      if (next) next.focus();
    }
  });
  pop.addEventListener("focusout", (e) => { if (openTid && e.relatedTarget && !pop.contains(e.relatedTarget) && !bar.contains(e.relatedTarget)) closePop(false); });
  bar.addEventListener("keydown", (e) => { if (e.key === "Escape" && openTid) { e.preventDefault(); closePop(true); } });
  const mq = matchMedia(PHONE);
  const onMq = () => { closePop(false); closeSheet(); };
  mq.addEventListener("change", onMq);

  // ---- the phone's bottom sheet: every group, one disclosure each
  let sheet = null, sheetCount = null, sheetSecs = [];
  const sheetBtn = h("button.btn.ghost.fbtn", { type: "button", "aria-haspopup": "dialog", onclick: () => openSheet() },
    [icon("filters"), h("span", t("cx.filters")), h("span.fbar-n.fbtn-n")]);
  function buildSheet() {
    sheetCount = h("span");
    const close = h("button.close", { type: "button", "aria-label": t("ui.close"), title: t("ui.close"), onclick: () => closeSheet() }, icon("close"));
    const body = h("div.fs-body");
    sheetSecs = [];
    for (const [tid] of triggers) {
      if (!bodies.has(tid)) continue;
      const n = h("span.fbar-n");
      const btn = h("button.fs-h", { type: "button", "aria-expanded": "false" }, [h("span", t("ft." + tid)), n, icon("chevron")]);
      const region = h("div.collapse", h("div.collapse-in", h("div.fs-in")));
      btn.addEventListener("click", () => { const o = btn.getAttribute("aria-expanded") !== "true"; btn.setAttribute("aria-expanded", String(o)); region.classList.toggle("open", o); });
      sheetSecs.push({ tid, btn, region, n });
      body.append(h("div.fs-sec", [btn, region]));
    }
    const clearAll = h("button.btn.ghost", { type: "button", onclick: () => { clearFilters(); } }, t("fg.clearAll"));
    clears.push({ groups: "all", el: clearAll });
    const show = h("button.btn.primary.fs-show", { type: "button", onclick: () => closeSheet() }, sheetCount);
    sheet = h(`dialog.sheet.fsheet#${id}-fsheet`, { "aria-labelledby": `${id}-fsheet-t` }, [
      h("div.fs-head", [h("h2", { id: `${id}-fsheet-t` }, t("cx.filters"))]), close, body, h("div.fs-foot", [clearAll, show])]);
    sheet.addEventListener("cancel", (e) => { e.preventDefault(); closeSheet(); });
    sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });
    document.body.append(sheet);
  }
  function openSheet() {
    if (!sheet) buildSheet();
    for (const s of sheetSecs) {
      s.region.querySelector(".fs-in").replaceChildren(bodies.get(s.tid));
      const on = activeIn(groupsOf(s.tid)) > 0 || s === sheetSecs[0];
      s.btn.setAttribute("aria-expanded", String(on));
      s.region.classList.toggle("open", on);
    }
    refresh();
    sheet.showModal();
    // focus lands on the first section, not on the close button in the corner
    sheetSecs[0].btn.focus({ preventScroll: true });
    document.documentElement.classList.add("modal-open");
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add("on")));
  }
  function closeSheet() {
    if (!sheet || !sheet.open) return;
    sheet.classList.remove("on");
    const done = () => { sheet.close(); document.documentElement.classList.remove("modal-open"); sheetBtn.focus({ preventScroll: true }); };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) done(); else setTimeout(done, 200);
  }

  // ---- the active filters as one line
  const sentence = h(`div.fq#${id}-fq`, { role: "group", "aria-label": t("fg.activeAria"), tabindex: "-1" });
  function paintSentence() {
    // an edit made in the line keeps the focus in the line: on the same control when it is still there (an "and" turned
    // "or"), else on the control now in its place, else on the line itself
    const act = document.activeElement;
    const was = sentence.contains(act) && act !== sentence ? { k: act.dataset.k, i: [...sentence.querySelectorAll("button")].indexOf(act) } : null;
    const kids = [];
    for (const [tid, groups] of triggers) {
      for (const g of groups) {
        if (g === "num") {
          for (const n of NUMS) {
            const r = S.num[n.id];
            if (!r) continue;
            kids.push(h("span.fq-grp", [qchip(`${t("fn." + n.id)} ${rangeText(n, r, index.ranges[n.id])}`, () => { delete S.num[n.id]; change(); }, null, "n:" + n.id)]));
          }
          continue;
        }
        if (g === "own") {
          if (S.own !== "all") kids.push(h("span.fq-grp", qchip(t(S.own === "owned" ? "cx.owned" : "cx.missing"), () => { S.own = "all"; change(); }, null, "own")));
          continue;
        }
        const sel = S.sel[g];
        if (!sel.length) continue;
        const parts = [h("span.fq-g", t("fg." + g))];
        sel.forEach((v, i) => {
          if (i) {
            parts.push(OP_GROUPS.has(g)
              ? h("button.fq-op", { type: "button", "data-k": `op:${g}:${i}`, title: t(S.op[g] === "all" ? "fg.toAny" : "fg.toAll"), "aria-label": t(S.op[g] === "all" ? "fg.opAllAria" : "fg.opAnyAria"),
                onclick: () => { S.op[g] = S.op[g] === "all" ? "any" : "all"; change(); } }, t(S.op[g] === "all" ? "fg.and" : "fg.or"))
              : h("span.fq-or", t("fg.or")));
          }
          const lab = valueLabel(index, g, v, patch);
          parts.push(qchip(lab.text, () => { toggle(sel, v); change(); }, lab.sprite, `v:${g}:${v}`));
        });
        kids.push(h("span.fq-grp", parts));
      }
    }
    if (!S.tal && TALENT_GROUPS_USED()) kids.push(h("span.fq-grp", qchip(t("fg.talOff"), () => { S.tal = true; change(); }, null, "tal")));
    if (kids.length && sentenceClear) kids.push(h("button.btn.ghost.fq-clear", { type: "button", "data-k": "clear", onclick: () => clearFilters(true) }, t("fg.clearAll")));
    sentence.replaceChildren(...kids);
    sentence.hidden = !kids.length;
    if (!was) return;
    const btns = [...sentence.querySelectorAll("button")];
    const back = (was.k && btns.find((b) => b.dataset.k === was.k)) || btns[Math.min(was.i, btns.length - 1)];
    if (back) back.focus({ preventScroll: true });
    else if (!sentence.hidden) sentence.focus({ preventScroll: true });
    else (matchMedia(PHONE).matches ? sheetBtn : (bar.querySelector("button") || sheetBtn)).focus({ preventScroll: true });
  }
  const TALENT_GROUPS_USED = () => [...TALENT_GROUPS].some((g) => S.sel[g].length);
  function qchip(text, remove, sprite, key) {
    return h("button.qchip", { type: "button", "data-k": key, title: t("fg.remove", { label: text }), "aria-label": t("fg.remove", { label: text }), onclick: remove },
      [sprite ? h("i." + sprite) : null, h("span", text), icon("close", 14)]);
  }
  function clearFilters(focusBack) {
    for (const g of Object.keys(S.sel)) S.sel[g] = [];
    S.num = {}; S.tal = true; S.own = "all";
    change();
    if (focusBack) (matchMedia(PHONE).matches ? sheetBtn : (bar.querySelector("button") || sheetBtn)).focus({ preventScroll: true });
  }

  // ---- paint every control from the state
  function refresh() {
    const xs = items(), o = opts();
    for (const c of chips) {
      const on = S.sel[c.g].includes(c.v);
      const n = chipCount(xs, S, c.g, c.v, o);
      c.n.textContent = fmtInt(n);
      c.el.setAttribute("aria-pressed", String(on));
      c.el.setAttribute("aria-label", `${c.text}, ${t("cx.result", { n })}`);
      c.el.disabled = !n && !on;
      c.el.title = !n && !on ? t("filter.none") : c.hint || "";
    }
    for (const g of Object.keys(groupChips)) rove(g);
    // "Any of | All of" means something from two picks: until then it is drawn disabled, its title says why
    for (const { g, seg } of segs) {
      seg.set(S.op[g]);
      const few = S.sel[g].length < 2;
      seg.el.querySelectorAll("button").forEach((b) => { b.disabled = few; });
      seg.el.title = few ? t("fg.opNeed") : "";
    }
    for (const s of ownSegs) s.set(S.own);
    for (const b of switches) b.setAttribute("aria-checked", String(S.tal));
    for (const r of sliders) {
      const [lo0, hi0] = index.ranges[r.n.id];
      const [a, b] = S.num[r.n.id] || [lo0, hi0];
      if (Number(r.lo.value) !== a) r.lo.value = a;
      if (Number(r.hi.value) !== b) r.hi.value = b;
      // two thumbs on one spot: the one that can move away from the end stays on top
      r.lo.style.zIndex = a === b && a >= hi0 ? "2" : "";
      // at rest the range says its two ends, so the scale is read before a thumb moves
      r.out.textContent = S.num[r.n.id] ? rangeText(r.n, [a, b], [lo0, hi0]) : `${numText(r.n, lo0)}–${numText(r.n, hi0)}`;
      r.out.classList.toggle("on", !!S.num[r.n.id]);
      r.fill.classList.toggle("on", !!S.num[r.n.id]);
      const span = hi0 - lo0 || 1;
      r.fill.style.left = ((a - lo0) / span) * 100 + "%";
      r.fill.style.right = ((hi0 - b) / span) * 100 + "%";
      r.lo.setAttribute("aria-valuetext", rangeText(r.n, [a, hi0], [lo0 - 1, hi0]));
      r.hi.setAttribute("aria-valuetext", rangeText(r.n, [lo0, b], [lo0, hi0 + 1]));
    }
    for (const c of clears) {
      const k = c.groups === "all" ? filterCount(S) + (S.tal ? 0 : 1) : activeIn(c.groups);
      c.el.disabled = !k;
      c.el.title = k ? "" : t("fg.clearNone");
    }
    for (const [tid, { btn, n }] of trig) {
      const k = activeIn(groupsOf(tid));
      n.textContent = k ? fmtInt(k) : "";
      btn.classList.toggle("has", k > 0);
    }
    for (const s of sheetSecs) { const k = activeIn(groupsOf(s.tid)); s.n.textContent = k ? fmtInt(k) : ""; }
    const total = filterCount(S);
    sheetBtn.querySelector(".fbtn-n").textContent = total ? fmtInt(total) : "";
    sheetBtn.title = total ? t("fg.sheetOn", { n: total }) : t("fg.sheetTitle");
    if (sheetCount) sheetCount.textContent = t("fg.show", { n: shown() });
    paintSentence();
  }

  /**
   * Why a card matched, one line per group (DESIGN.md "Card filters", why it matched): the entries that give it the picks
   * ("Hits: Cosmic Flames", a talent led by its glyph), and which picks it holds only where that is news (an "any of" group of
   * two picks or more; a number filter's values). An entry named like the pick it gives ("Reset" for Reset) is not repeated, and
   * a line with nothing left to say is left out: the line of active filters already says it.
   */
  function reasonsFor(x) {
    const c = x.c, sep = t("why.sep");
    const out = [];
    for (const r of reasons(x, S)) {
      const num = r.g === "num" ? NUMS.find((n) => n.id === r.id) : null;
      const labs = num ? [] : r.values.map((v) => valueLabel(index, r.g, v, patch));
      const same = new Set(labs.map((l) => norm(l.text)));
      const entries = r.refs.map(([part, i]) => [part, part === "a" ? c.abilities[i] : part === "p" ? c.passives[i] : c.talents[i]])
        .filter(([, e]) => e && !same.has(norm(L(e, "name"))));
      const showVals = !!num || (S.op[r.g] !== "all" && S.sel[r.g].length > 1);
      if (!showVals && !entries.length) continue;
      const label = num ? t("fn." + r.id) : t("why." + r.g);
      const vals = !showVals ? [] : num ? [r.values.map((v) => numText(num, v)).filter(uniq).join(", ")]
        : joinNodes(labs.map((l) => (l.el ? elementNode(l.el, l.text) : h("b", l.text))), ", ");
      const names = entries.slice(0, 2).map(([part, e]) => h("span.why-e", [part === "t"
        ? h("i.ab-talent.why-tl", { title: t("why.talent"), "aria-label": t("why.talent"), role: "img" }) : null, L(e, "name")]));
      const more = entries.length > 2 ? h("span.why-more", t("why.more", { n: entries.length - 2 })) : null;
      out.push(h("p.why", [h("span.why-g", label), showVals ? [" ", ...vals] : null,
        names.length ? [sep, ...joinNodes(names, ", "), more ? [" ", more] : null] : null]));
    }
    return out;
  }

  /** Before the view rebuilds (a language change): close, and take the sheet and the listeners away. */
  function destroy() {
    closePop(false);
    mq.removeEventListener("change", onMq);
    if (sheet) { if (sheet.open) { sheet.close(); document.documentElement.classList.remove("modal-open"); } sheet.remove(); sheet = null; }
  }

  refresh();
  return { bar: barWrap, sheetBtn, sentence, refresh, reasonsFor, destroy, openSheet, close: () => closePop(false) };
}

const uniq = (v, i, a) => a.indexOf(v) === i;
function toggle(arr, v) { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); }
function joinNodes(nodes, sep) { const out = []; nodes.forEach((n, i) => { if (i) out.push(sep); out.push(n); }); return out; }
