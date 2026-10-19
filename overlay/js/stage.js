// The hero stage of the overlay page: two rows of real game cards (the top two visible decks of the Deck tier list) with the
// overlay drawn on them as the live overlay draws it in the game (SPEC of spam-overlay, "The in-game layer"): the coach at
// rest, then a hovered target, its outcomes with their odds and the win chance after each, the HP each one leaves, and the
// kill chance on the card it can kill. Every figure here is made up and the stage says so ("Illustration, made-up numbers").
//
// What it draws, as the final overlay does: the standing win chance (crown and number) at the top of the list, delta-first
// rows (the signed change big, green or red, the win chance small), "All outcomes" as the first stop of a hovered card, the
// death chance as a skull (solid from 50%, outlined below), one red HP figure, the coach's best move as a crown figure under
// its caster, and the "they can win next turn" alert beside your row.
//
// Motion: the pointer travels by transform (280ms), marks fade (120ms), panes cross-fade (200ms), rows rise 4px with 40ms
// offsets, the selected outcome slides (200ms); one curve (base.css). Nothing is unmounted: every mark stays in the page and
// only its opacity changes. The loop runs only while the stage is on screen and the tab is visible, stops on the pause button,
// and never starts with reduced motion (the stage then holds one informative frame).

import { t, tx } from "../../js/i18n.js?v=b72f78e0fe";
import { h, pct, reducedMotion } from "../../js/util.js?v=b72f78e0fe";
import { gameCard, cardName, L, THUMB } from "../../js/cards.js?v=b72f78e0fe";

const NOW = 0.58;
const r10 = (x) => Math.max(10, Math.round(x / 10) * 10);
const pts = (a, b) => Math.round((a - b) * 100);
const per = (p) => pct(p, 0);

/** A card shown, not named, as the overlay shows it in a line (UX_CONTRACT "Cards are shown"): its art at 20 x 28 with the
 *  rarity as a pip on the lower edge. The name stays as the accessible name and the title. */
const tile = (c) => h("span", { class: "ct r-" + c.rarity, title: cardName(c) }, [
  h("img", { class: "ct-art", alt: "", width: 20, height: 28, src: THUMB("s", c.key) }),
  h("i.ct-pip"),
  h("span.sr", cardName(c)),
]);

/** The made-up numbers of the illustration, sized to the real cards' HP. */
function model(you, them) {
  // the caster: your first card with an ability that deals damage (else any ability); the threat sits on another card
  const hits = (a) => /damage/i.test(a.description_en || "");
  let ci = you.findIndex((c) => (c.abilities || []).some(hits));
  if (ci < 0) ci = Math.max(0, you.findIndex((c) => (c.abilities || []).length));
  const caster = you[ci], A = them[1], B = them[2];
  const ability = (caster.abilities || []).find(hits) || (caster.abilities || [])[0] || null;
  const ri = ci >= 2 ? 0 : 3;            // the card farthest from the caster, so their labels never meet
  const hpA = A.hp, hpB = B.hp;
  const treeA = [
    { p: 0.46, key: "hit", a: hpA, b: r10(hpA * 0.3), win: 0.63, left: r10(hpA * 0.3) },
    { p: 0.38, key: "kill", a: hpA, b: 0, win: 0.74, left: 0 },
    { p: 0.16, key: "miss", a: hpA, b: hpA, win: 0.49, left: hpA },
  ];
  const treeB = [
    { p: 0.70, key: "hit", a: hpB, b: r10(hpB * 0.55), win: 0.59, left: r10(hpB * 0.55) },
    { p: 0.22, key: "crit", a: hpB, b: r10(hpB * 0.1), win: 0.64, left: r10(hpB * 0.1) },
    { p: 0.08, key: "miss", a: hpB, b: hpB, win: 0.52, left: hpB },
  ];
  const after = (tree) => Math.round(tree.reduce((s, o) => s + o.p * o.win, 0) * 100) / 100;
  return { ci, ri, caster, A, B, ability, treeA, treeB, afterA: after(treeA), afterB: after(treeB), killA: 0.38, risk: 0.34 };
}

// the timeline: [state, selected outcome, pointer target, ms to hold]
const STEPS = [
  { s: "rest", sel: 0, at: "rest", hold: 2400 },
  { s: "A", sel: 0, at: "A", hold: 2000 },
  { s: "A", sel: 2, at: "A", wheel: true, hold: 2000 },
  { s: "A", sel: 3, at: "A", wheel: true, hold: 1800 },
  { s: "B", sel: 0, at: "B", hold: 2400 },
];
const STILL = { s: "A", sel: 0, at: "A" };       // the one frame shown with reduced motion

/** `onPlaying(on)`: told each time the loop starts or stops (the page holds its ambient field still while the loop plays). */
export function createStage(stage, { onPlaying = () => {} } = {}) {
  const rowThem = stage.querySelector("#row-them"), rowYou = stage.querySelector("#row-you");
  const inner = stage.querySelector(".stage-in"), olist = stage.querySelector(".olist");
  const cursor = stage.querySelector("#cursor"), hint = stage.querySelector("#wheel-hint");
  const pp = stage.querySelector("#stage-pp");
  const $ = (id) => stage.querySelector("#" + id);

  // the eight slots exist at once, card frames first, so the stage keeps its size while the data loads
  const slots = { them: [], you: [] };
  for (const [side, row] of [["them", rowThem], ["you", rowYou]]) {
    row.classList.add(side);
    for (let i = 0; i < 4; i++) {
      const slot = h("div.slot", [h("span.slot-frame")]);
      row.append(slot);
      slots[side].push(slot);
    }
  }

  let m = null, marks = null, step = 0, timer = 0, playing = false, paused = false, inView = false, cur = null;

  function mark(slot, cls, kids = []) {
    const el = h("span", { class: "mk " + cls }, kids);
    slot.append(el);
    return el;
  }

  /** Puts the cards in and builds every mark once; texts are (re)written by label(). */
  function fill(you, them) {
    m = model(you, them);
    // above the fold: the art loads at once, not lazily
    you.forEach((c, i) => slots.you[i].append(gameCard(c, { size: "list", interactive: false, eager: true })));
    them.forEach((c, i) => slots.them[i].append(gameCard(c, { size: "list", interactive: false, eager: true })));
    const sA = slots.them[1], sB = slots.them[2], sC = slots.you[m.ci], sR = slots.you[m.ri];
    marks = {
      ringA: mark(sA, "mk-ring"), ringB: mark(sB, "mk-ring"),
      ghostA: mark(sA, "mk-ghost", [h("i")]), ghostB: mark(sB, "mk-ghost", [h("i")]),
      pipA: mark(sA, "mk-pip"),
      outA: mark(sA, "mk-out", [h("span.ol-voice.fate"), h("span.ol-voice.small.hp")]),
      outB: mark(sB, "mk-out", [h("span.ol-voice.small.hp")]),
      coach: mark(sC, "mk-out", [h("span.ol-voice.small.coachl")]),
      // an end card's label hugs the card's outer edge, so it never runs past the stage on a phone
      risk: mark(sR, "mk-out on" + (m.ri === 0 ? " edge-l" : " edge-r"), [h("span.ol-voice.small.riskl")]),
    };
    label();
    stage.classList.add("ready");
    if (reducedMotion()) {
      pp.disabled = true;
      pp.title = t("ov.stage.reduced");
      pp.setAttribute("aria-label", t("ov.stage.reduced"));
      show(STILL, false);
    } else {
      show(STEPS[0], false);
      observe();
    }
  }

  // the three glyphs util.js does not hold (16-box strokes, like its own): the warning, the skull of a death chance, the crown
  // of the best move and of the standing win chance
  const PATHS = {
    warn: "M8 2.2 14.3 13H1.7zM8 6.5v3M8 11.3v.1",
    skull: "M3 7a5 5 0 0 1 10 0v2.4l-1.5 1V13h-7v-2.6L3 9.4zM6 8.3v.1M10 8.3v.1M7.4 11v1.4M8.6 11v1.4",
    crown: "M2 12.5 1.7 5.2 5.4 8 8 3.2 10.6 8l3.7-2.8L14 12.5z",
  };
  const glyph = (name, cls = "") => {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg"), p = document.createElementNS(NS, "path");
    for (const [k, v] of Object.entries({ viewBox: "0 0 16 16", width: 16, height: 16, "aria-hidden": "true", focusable: "false", class: ("ico " + name + " " + cls).trim() })) svg.setAttribute(k, v);
    p.setAttribute("d", PATHS[name]);
    svg.append(p);
    return svg;
  };

  function rowText(o, target) {
    if (o.key === "all") return t("ov.l.all");
    if (o.key === "kill") return t("ov.l.kill");
    if (o.key === "miss") return t("ov.l.miss");
    return t(o.key === "crit" ? "ov.l.crit" : "ov.l.hit", { a: o.a, b: o.b });
  }
  function delta(after, before) {
    const d = pts(after, before);
    return h("span", { class: "dv " + (d > 0 ? "up" : d < 0 ? "down" : "") }, (d > 0 ? "+" : d < 0 ? "−" : "") + Math.abs(d));
  }
  // the delta first (big, signed), the win chance after it small
  const winCell = (win) => h("span.w", [delta(win, NOW), h("b", per(win))]);
  /** The stops of a hovered card: "All outcomes" first, then each branch with its own chance. */
  function stops(tree, a, after) {
    return [{ key: "all", p: null, a, left: a, win: after }, ...tree];
  }
  function treeRows(list) {
    return list.map((o, i) => h("li.ol-row", { style: `--i:${i}` }, [
      h("span.p", o.p == null ? "" : per(o.p)), h("span.l", rowText(o)), winCell(o.win),
    ]));
  }

  /** Every text of the stage, in the current language. */
  function label() {
    if (!m) return;
    const ab = m.ability ? L(m.ability, "name") : "";
    marks.coach.firstChild.replaceChildren(glyph("crown"), delta(m.afterA, NOW));
    marks.risk.firstChild.replaceChildren(glyph("warn"), t("ov.g.risk") + " ", h("b", per(m.risk)));
    marks.outA.querySelector(".fate").replaceChildren(glyph("skull", m.killA >= 0.5 ? "solid" : ""), h("b", per(m.killA)));
    $("g-now").textContent = per(NOW);
    $("coach-rows").replaceChildren(
      h("li.ol-row.best", [h("span.p", ""), h("span.l", tx("ov.l.on", { ability: ab, target: tile(m.A) })), winCell(m.afterA)]),
      h("li.ol-row", [h("span.p", ""), h("span.l", tx("ov.l.on", { ability: ab, target: tile(m.B) })), winCell(m.afterB)]),
      h("li.ol-row", [h("span.p", ""), h("span.l", t("ov.l.end")), winCell(0.55)]),
    );
    $("coach-rows").querySelectorAll(".ol-row").forEach((r) => r.classList.add("coach"));
    if (cur) show(cur, false, true);
  }

  /** Draws one state of the timeline. `fresh`: the tree just appeared (its rows rise). */
  function show(st, animate = true, relabel = false) {
    const prev = cur;
    cur = st;
    const hoverA = st.s === "A", hoverB = st.s === "B", hover = hoverA || hoverB;
    const tree = hoverA ? m.treeA : hoverB ? m.treeB : null;
    marks.ringA.classList.toggle("on", hoverA);
    marks.ringB.classList.toggle("on", hoverB);
    marks.pipA.classList.toggle("on", st.s === "rest");
    marks.coach.classList.toggle("on", st.s === "rest");
    marks.outA.classList.toggle("on", hoverA);
    marks.outB.classList.toggle("on", hoverB);
    marks.ghostA.classList.toggle("on", hoverA);
    marks.ghostB.classList.toggle("on", hoverB);
    $("pane-coach").classList.toggle("on", !hover);
    $("pane-tree").classList.toggle("on", hover);
    if (hover) {
      const target = hoverA ? m.A : m.B, after = hoverA ? m.afterA : m.afterB;
      const list = stops(tree, target.hp, after), o = list[st.sel];
      const ab = m.ability ? L(m.ability, "name") : "";
      $("tree-h").replaceChildren(...tx("ov.l.on", { ability: ab, target: tile(target) }));
      $("tree-sub").replaceChildren(...(hoverA ? tx("ov.l.kills", { target: tile(target), p: per(m.killA) }) : []));
      const rows = $("tree-rows");
      const newTree = !prev || prev.s !== st.s || relabel;
      if (newTree) {
        rows.replaceChildren($("tree-sel"), ...treeRows(list));
        if (animate && !relabel) { rows.classList.remove("in"); void rows.offsetWidth; rows.classList.add("in"); }
      }
      rows.style.setProperty("--sel", st.sel);
      const ghost = hoverA ? marks.ghostA : marks.ghostB, out = hoverA ? marks.outA : marks.outB;
      ghost.firstChild.style.setProperty("--lost", String(1 - o.left / o.a));
      // the selected stop's HP, one red figure when it takes some (all outcomes and a miss take none)
      out.querySelector(".hp").replaceChildren(o.left < o.a ? h("span.lost", ["▾ ", h("b", String(o.left))]) : "");
    }
    point(st.at);
    hint.classList.toggle("on", !!st.wheel);
  }

  /** Moves the pointer onto a target card, or to its resting place beside your row. */
  function point(at) {
    const box = inner.getBoundingClientRect();
    let x, y;
    if (at === "A" || at === "B") {
      const r = slots.them[at === "A" ? 1 : 2].getBoundingClientRect();
      x = r.left - box.left + r.width * 0.58; y = r.top - box.top + r.height * 0.42;
    } else {
      // at rest: in the gap between the rows, right of your last card, off every card
      const r = slots.you[3].getBoundingClientRect();
      x = Math.min(r.right - box.left + 16, box.width - 28); y = r.top - box.top - 24;
    }
    cursor.style.setProperty("--cx", `${Math.round(x)}px`); cursor.style.setProperty("--cy", `${Math.round(y)}px`);
    // the hint sits below right of the pointer, pulled back inside the stage when it would run past its edge
    const hx = Math.min(x + 24, box.width - hint.offsetWidth - 4);
    hint.style.setProperty("--cx", `${Math.round(hx)}px`); hint.style.setProperty("--cy", `${Math.round(y + 24)}px`);
  }

  // ---- the loop: the pointer moves first, the state lands when it arrives (280ms later)
  function tick() {
    step = (step + 1) % STEPS.length;
    const st = STEPS[step];
    const moving = !cur || cur.at !== st.at;
    if (moving) {
      point(st.at);
      if (cur && cur.s !== "rest" && st.s !== cur.s) hideHover();
      timer = setTimeout(() => { show(st); timer = setTimeout(tick, st.hold); }, 280);
    } else {
      show(st);
      timer = setTimeout(tick, st.hold);
    }
  }
  function hideHover() {
    // between two targets the tree keeps its pane; only the old target's marks go
    for (const k of ["ringA", "ringB", "outA", "outB", "ghostA", "ghostB"]) marks[k].classList.remove("on");
  }
  function play() {
    if (playing || paused || !inView || document.hidden || reducedMotion() || !m) return;
    playing = true;
    onPlaying(true);
    timer = setTimeout(tick, STEPS[step].hold);
  }
  function stop() {
    clearTimeout(timer);
    if (playing) { playing = false; onPlaying(false); }
  }

  function observe() {
    new IntersectionObserver((es) => { inView = es[0].isIntersecting; inView ? play() : stop(); }, { threshold: 0.3 }).observe(stage);
    document.addEventListener("visibilitychange", () => (document.hidden ? stop() : play()));
    pp.addEventListener("click", () => {
      paused = !paused;
      pp.setAttribute("aria-pressed", String(paused));
      ppLabel();
      paused ? stop() : play();
    });
  }
  function ppLabel() {
    if (pp.disabled) return;
    const k = paused ? "ov.stage.play" : "ov.stage.pause";
    pp.title = t(k);
    pp.setAttribute("aria-label", t(k));
  }
  // the pointer's place follows the layout (a resize or a rotated phone), without travel
  let rz = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(() => {
      if (!cur) return;
      cursor.style.transition = hint.style.transition = "none";
      point(cur.at);
      void cursor.offsetWidth;
      cursor.style.transition = hint.style.transition = "";
    });
  });

  // the data could not load: the frame keeps its card sockets and says so in one line; the pause button is disabled with
  // that reason (it has nothing to pause)
  let failed = false;
  function failLabel() {
    if (!failed) return;
    stage.querySelector(".stage-fail").textContent = t("ov.stage.failed");
    pp.title = t("ov.stage.failed");
    pp.setAttribute("aria-label", t("ov.stage.failed"));
  }

  return {
    fill,
    fail() {
      if (m || failed) return;
      failed = true;
      stop();
      pp.disabled = true;
      stage.classList.add("failed");
      inner.append(h("p.stage-fail", { role: "status" }));
      failLabel();
    },
    relabel() {
      label(); ppLabel();
      if (failed) failLabel();
      else if (pp.disabled) { pp.title = t("ov.stage.reduced"); pp.setAttribute("aria-label", t("ov.stage.reduced")); }
    },
  };
}
