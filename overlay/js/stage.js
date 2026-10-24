// The hero stage of the overlay page: two rows of real game cards (the top two decks of the Deck tier list) with the overlay
// drawn on them as the live overlay (0.1.19) draws it in the game: a clear, quiet layer. At rest only the win chance readout
// ("~58%"), centred just above the END TURN button, and ONE cyan dot on the line of the spell the AI would cast (or beside
// the end-turn button when ending the turn is the best move). Hovering that spell line moves the dot to the best target, which
// shows its death chance (a skull and a figure) and the damage the spell deals (a red range under a down triangle).
// Every figure here is made up and the stage says so ("Illustration, made-up numbers").
//
// The game's own HUD is not ours to copy: the END TURN disc and the timer ring are plain stand-ins so the readout and the dot
// sit where they sit in the game (readout above the button, the end-turn dot to the left of the timer ring).
//
// Motion: the pointer travels by transform (280ms), marks fade (120ms); one curve (base.css). Nothing is unmounted: every
// mark stays in the page and only its opacity changes. The loop runs only while the stage is on screen and the tab is
// visible, stops on the pause button, and never starts with reduced motion (the stage then holds one informative frame).

import { t } from "../../js/i18n.js?v=97c4732cce";
import { h, pct, reducedMotion } from "../../js/util.js?v=97c4732cce";
import { gameCard, L } from "../../js/cards.js?v=97c4732cce";

const NOW = 0.58;
const per = (p) => pct(p, 0);

/** The made-up numbers of the illustration, sized to the real cards' HP. The decks are put in the order the stage wants: the
 *  caster and the target sit in the second slot of their rows, so a phone, which keeps only the first two slots of a row,
 *  still shows them. */
function model(you, them) {
  const hits = (a) => /damage/i.test(a.description_en || "");
  let ci = you.findIndex((c) => (c.abilities || []).some(hits));
  if (ci < 0) ci = Math.max(0, you.findIndex((c) => (c.abilities || []).length));
  const caster = you[ci];
  const abIdx = Math.max(0, (caster.abilities || []).findIndex(hits));
  const ti = them.findIndex((c, i) => i > 0 && c.hp >= 30) > 0 ? them.findIndex((c, i) => i > 0 && c.hp >= 30) : 1;
  const target = them[ti];
  const youOrder = [...you.filter((_, i) => i !== ci)]; youOrder.splice(1, 0, caster);
  const themOrder = [...them.filter((_, i) => i !== ti)]; themOrder.splice(1, 0, target);
  const lo = Math.max(1, Math.round(target.hp * 0.3)), hi = Math.max(lo + 1, Math.round(target.hp * 0.45));
  return { youOrder, themOrder, caster, target, abIdx, lo, hi, kill: 0.38 };
}

// the timeline: [state, pointer target, ms to hold]
const STEPS = [
  { s: "rest", at: "rest", hold: 2600 },
  { s: "hover", at: "spell", hold: 3200 },
  { s: "end", at: "end", hold: 2600 },
];
const STILL = { s: "hover", at: "spell" };       // the one frame shown with reduced motion

/** `onPlaying(on)`: told each time the loop starts or stops (the page holds its ambient field still while the loop plays). */
export function createStage(stage, { onPlaying = () => {} } = {}) {
  const rowThem = stage.querySelector("#row-them"), rowYou = stage.querySelector("#row-you");
  const inner = stage.querySelector(".stage-in");
  const cursor = stage.querySelector("#cursor");
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

  let m = null, marks = null, rowEl = null, step = 0, timer = 0, playing = false, paused = false, inView = false, cur = null;

  function mark(slot, cls, kids = []) {
    const el = h("span", { class: "mk " + cls }, kids);
    slot.append(el);
    return el;
  }

  /** Puts the cards in and builds every mark once; texts are (re)written by label(). */
  function fill(you, them) {
    m = model(you, them);
    // above the fold: the art loads at once, not lazily
    m.youOrder.forEach((c, i) => slots.you[i].append(gameCard(c, { size: "full", interactive: false, eager: true })));
    m.themOrder.forEach((c, i) => slots.them[i].append(gameCard(c, { size: "full", interactive: false, eager: true })));
    const sT = slots.them[1], sC = slots.you[1];
    marks = {
      row: mark(sC, "mk-row"),                       // the hovered spell line
      dotSpell: mark(sC, "mk-dot dot-spell"),        // the suggested spell, at rest
      dotTarget: mark(sT, "mk-dot dot-target"),      // the same dot, on the best target while the spell line is hovered
      out: mark(sT, "mk-out", [h("span.ol-voice.fate"), h("span.ol-voice.small.dmg")]),
      dotEnd: $("dot-end"),
    };
    marks.dotEnd.classList.add("mk");
    label();
    stage.classList.add("ready");
    place();
    if (reducedMotion()) {
      pp.disabled = true;
      pp.title = t("ov.stage.reduced");
      pp.setAttribute("aria-label", t("ov.stage.reduced"));
      show(STILL);
    } else {
      show(STEPS[0]);
      observe();
    }
  }

  // the two glyphs util.js does not hold (16-box strokes, like its own): the skull of a death chance, the crown of the win chance
  const PATHS = {
    skull: "M3 7a5 5 0 0 1 10 0v2.4l-1.5 1V13h-7v-2.6L3 9.4zM6 8.3v.1M10 8.3v.1M7.4 11v1.4M8.6 11v1.4",
  };
  const glyph = (name, cls = "") => {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg"), p = document.createElementNS(NS, "path");
    for (const [k, v] of Object.entries({ viewBox: "0 0 16 16", width: 16, height: 16, "aria-hidden": "true", focusable: "false", class: ("ico " + name + " " + cls).trim() })) svg.setAttribute(k, v);
    p.setAttribute("d", PATHS[name]);
    svg.append(p);
    return svg;
  };

  /** Where the suggested spell line sits on the caster card, as a share of the card's own height (it scales with the card). */
  function place() {
    const sC = slots.you[1];
    rowEl = sC.querySelectorAll(".gc-ab")[m.abIdx] || null;
    const box = sC.getBoundingClientRect();
    if (!rowEl || !box.height) return;
    const r = rowEl.getBoundingClientRect();
    const top = ((r.top - box.top) / box.height) * 100, hgt = (r.height / box.height) * 100;
    const left = ((r.left - box.left) / box.width) * 100, wid = (r.width / box.width) * 100;
    for (const el of [marks.row, marks.dotSpell]) {
      el.style.setProperty("--ry", top + "%");
      el.style.setProperty("--rh", hgt + "%");
      el.style.setProperty("--rx", left + "%");
      el.style.setProperty("--rw", wid + "%");
    }
  }

  /** Every text of the stage, in the current language. */
  function label() {
    if (!m) return;
    marks.out.querySelector(".fate").replaceChildren(glyph("skull"), h("b", per(m.kill)));
    marks.out.querySelector(".dmg").replaceChildren(h("span.lost", ["▾ ", h("b", `${m.lo}–${m.hi}`)]));
    $("g-now").textContent = "~" + per(NOW);        // the readout's hedge since overlay 0.1.14: one figure, "~" before it
    $("hud-end").textContent = t("ov.stage.end");
    if (cur) show(cur);
    // the card faces were built in the previous language: rebuilt by the page's relabel (showcase.js), the spell line moves with them
    requestAnimationFrame(place);
  }

  /** Draws one state of the timeline. */
  function show(st) {
    cur = st;
    marks.row.classList.toggle("on", st.s === "hover");
    marks.dotSpell.classList.toggle("on", st.s === "rest");
    marks.dotTarget.classList.toggle("on", st.s === "hover");
    marks.out.classList.toggle("on", st.s === "hover");
    marks.dotEnd.classList.toggle("on", st.s === "end");
    point(st.at);
  }

  /** Moves the pointer onto the spell line, the END TURN disc, or to its resting place between the rows. */
  function point(at) {
    const box = inner.getBoundingClientRect();
    let x, y;
    if (at === "spell" && rowEl) {
      const r = rowEl.getBoundingClientRect();
      x = r.left - box.left + r.width * 0.62; y = r.top - box.top + r.height * 0.45;
    } else if (at === "end") {
      const r = $("hud-end").getBoundingClientRect();
      x = r.left - box.left + r.width * 0.55; y = r.top - box.top + r.height * 0.5;
    } else {
      // at rest: in the gap between the rows, right of your last visible card, off every card
      let k = 3;
      while (k > 0 && !slots.you[k].getBoundingClientRect().width) k--;
      const r = slots.you[k].getBoundingClientRect();
      x = Math.min(r.right - box.left + 12, box.width - 28); y = r.top - box.top - 22;
    }
    cursor.style.setProperty("--cx", `${Math.round(x)}px`); cursor.style.setProperty("--cy", `${Math.round(y)}px`);
  }

  // ---- the loop: the pointer moves first, the state lands when it arrives (280ms later)
  function tick() {
    step = (step + 1) % STEPS.length;
    const st = STEPS[step];
    point(st.at);
    // the old state's marks go as the pointer leaves, the new one's land with it
    for (const k of ["row", "dotSpell", "dotTarget", "out", "dotEnd"]) marks[k].classList.remove("on");
    timer = setTimeout(() => { show(st); timer = setTimeout(tick, st.hold); }, 280);
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
      place();
      cursor.style.transition = "none";
      point(cur.at);
      void cursor.offsetWidth;
      cursor.style.transition = "";
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
