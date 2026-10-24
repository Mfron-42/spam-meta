// Dialogs (card, About, collection code) and the toast. Native <dialog>: the browser traps focus, makes the page behind
// inert and closes on Escape; we add the 280 ms enter, the back-button close and the backdrop click. The card dialog is
// drawn as a full-screen card view (card.css); its enter and exit (the card flying from its tile) are played by
// cardmotion.js.

import { h, $, icon, reducedMotion, pct, fmtDate, fmtInt, dec } from "./util.js?v=d1215b1076";
import { DB, loadTier, loadCardTiers, loadCardCounters, loadRanking } from "./data.js?v=d1215b1076";
import { getLang, isOwned, setOwned, ownedKeys, replaceOwned, ownedCount, canPersist } from "./store.js?v=d1215b1076";
import { cardTile, chip, L, cardName, ELEMENTS, elName, unsize, passiveWing } from "./cards.js?v=d1215b1076";
import { encode, decode } from "./code.js?v=d1215b1076";
import { copyText, disclosure } from "./ui.js?v=d1215b1076";
import { t, tx, millions } from "./i18n.js?v=d1215b1076";
import { patchTag, patchDetail, entryChanged, entryTag, oldNumbersNote, suggestedTalent, glyph, patchLine, dataDate, deckRanking, limitParams, gameSpan, medianRounds, CARD_RANKINGS_SHOWN, DECK_RANKING_SHOWN, DECK_TABLE_SHOWN, GAME_PATCH } from "./patch.js?v=d1215b1076";
import { textNodes, elementNode, hideTip } from "./cardtext.js?v=d1215b1076";
import { takeOff, openMotion, closeMotion, settle, forget } from "./cardmotion.js?v=d1215b1076";
import { attachTilt } from "./cardtilt.js?v=d1215b1076";

let openDlg = null, pushed = false;

function waitClose(fn) { if (reducedMotion()) fn(); else setTimeout(fn, 200); }

// url: an address to show while the dialog is open (a card has a shareable one). "url" mode means the page was opened on
// that address, so no history entry is added and closing only tidies the address.
export function openModal(dlg, onClose, url) {
  if (openDlg && openDlg !== dlg) closeNow(openDlg);
  if (!dlg.open) dlg.showModal();
  openDlg = dlg;
  dlg._onClose = onClose;
  document.documentElement.classList.add("modal-open");
  requestAnimationFrame(() => requestAnimationFrame(() => dlg.classList.add("on")));
  if (!pushed && !dlg._fromUrl) { history.pushState({ modal: true }, "", url || location.href); pushed = true; }
}

function closeNow(dlg) {
  hideTip();
  // the card's tile gets its card back before the dialog closes, so the browser can return focus to it
  if (dlg === cardDlg()) forget();
  dlg.classList.remove("on");
  if (dlg.open) dlg.close();
  document.documentElement.classList.remove("modal-open");
  if (openDlg === dlg) openDlg = null;
  if (dlg._onClose) { const f = dlg._onClose; dlg._onClose = null; f(); }
}

export function closeModal(dlg, fromPop = false) {
  if (!dlg.open) return;
  if (dlg === cardDlg()) closeMotion(dlg, () => closeNow(dlg));
  else { dlg.classList.remove("on"); waitClose(() => closeNow(dlg)); }
  if (pushed && !fromPop) { pushed = false; history.back(); }
}

window.addEventListener("popstate", () => {
  if (openDlg) { pushed = false; closeModal(openDlg, true); }
});

function wire(dlg) {
  // Escape closes an open keyword tooltip first (cardtext.js), the dialog on the next press
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); if (!hideTip()) closeModal(dlg); });
  // a click on the backdrop closes; the card view fills the screen, so its own empty ground (the scroller outside the
  // content column) counts as backdrop, unless the click ends a text selection
  dlg.addEventListener("click", (e) => {
    const ground = e.target === dlg || (dlg === cardDlg() && e.target.matches(".dlg-scroll"));
    if (ground && !String(getSelection() || "")) closeModal(dlg);
  });
  dlg.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeModal(dlg); });
}

// ---------------------------------------------------------------- toast
let toastTimer;
export function toast(message, action) {
  const el = $("#toast");
  clearTimeout(toastTimer);
  el.replaceChildren(h("span.toast-msg", message));
  if (action) {
    el.append(h("button.toast-act", { type: "button", onclick: () => { hideToast(); action.run(); } }, action.label));
  }
  el.classList.add("on");
  toastTimer = setTimeout(hideToast, action ? 9000 : 4000);
}
export function hideToast() { $("#toast").classList.remove("on"); }

// ---------------------------------------------------------------- card dialog
let currentKey = null, currentTalent = null;
const cardDlg = () => $("#dlg-card");

/**
 * Open a card. `mode` "url": the page was opened on the card's address (a deep link or a direct load), so no history
 * entry is added and the card opens without travelling. `from`: the pressed control; its card flies to the dialog.
 * `talent`: the position of the talent to show selected (a card of a ranked deck opens on the talent that deck plays).
 */
export function openCard(key, mode, from, talent) {
  const c = DB.byKey.get(key);
  if (!c) return;
  const tk = Number(talent);
  currentTalent = talent != null && talent !== "" && Number.isInteger(tk) && c.talents[tk] ? tk : null;
  // what the flight needs is taken before anything changes (a chip inside the open dialog is replaced below); a motion
  // still running ends at once, so a second card never lands in a half-open or half-closed dialog
  const flight = mode === "url" ? null : takeOff(from);
  settle();
  const dlg = cardDlg();
  const fresh = !dlg.open;
  currentKey = key;
  renderCardDialog();
  const tab = location.hash.replace(/^#/, "").split("/")[0] || "tiers";
  const fromUrl = mode === "url" && !dlg.open;
  dlg._fromUrl = fromUrl;
  openModal(dlg, () => {
    currentKey = null; currentTalent = null; unsize(dlg);
    if (dlg._fromUrl) { history.replaceState(null, "", "#" + tab); dlg._fromUrl = false; }
  }, `#${tab}/${key}`);
  dlg.querySelector(".dlg-scroll").scrollTop = 0;
  openMotion(dlg, flight, fresh);
}

/**
 * Leave the open card dialog for another view (its "Decks with this card" link): the dialog's history entry is replaced
 * by `#<view>` instead of going back, so the Back button then returns to where the dialog was opened from.
 */
export function leaveCard(view) {
  const dlg = cardDlg();
  if (!dlg.open) return;
  dlg._fromUrl = false;
  pushed = false;
  history.replaceState(null, "", "#" + view);
  closeModal(dlg);
}

/** A language change redraws what the dialogs show: the open card, the About text, the collection dialog's counts. */
export function refreshDialogs() {
  hideTip();
  if (currentKey && cardDlg().open) { settle(); if (currentKey && cardDlg().open) renderCardDialog(); }
  $("#about-body").replaceChildren(buildAbout());
  if ($("#dlg-code").open) paintCodeCount();
}

// ---- the card dialog, drawn as a full-screen card view (DESIGN.md, "Card view"): no panel, the content sits on the blurred
// backdrop. The card itself, its game art on the left (with, under it, the patch line, the owned toggle and the
// resistances: element, rarity, HP and gold are on the card face, so they are not repeated) and its kit on the right,
// dressed in the game card's own kit (abilities on the client's ability banner, passives between their level's wings,
// the talent picker); then, under a hairline, the "Meta" section: where it ranks (tier-list decks, card tier), "With and
// against" and the Deck builder link.

const pctInt = (n) => pct(n / 100, 0);

// an ability, passive or talent the last game patch changed carries a quiet tag beside its name (patch.js)
const changed = (c, part, i) => (entryChanged(c, part, i) ? entryTag(c) : null);

/**
 * One group of the kit. Its heading is for screen readers only (owner, 2026-10-15: "Capacités / Passifs / Talents ... ça
 * se comprend"): the game dressing says what each entry is. An optional foot line closes the group.
 */
function kitGroup(id, title, entries, foot) {
  return h("section.cd-g", { "aria-labelledby": id }, [
    h("h3.sr", { id }, title),
    h("div.cd-g-b", entries),
    foot || null,
  ]);
}

/** A passive's ribbon: ">> NAME <<" between the wings of the passive's own level (passiveWing, cards.js), as on the card face. */
function wingRibbon(c, obj) {
  const w = passiveWing(c, obj);
  return h("div.kit-rib.kit-wing", [
    h("i.kit-w.sp-pl-" + w + "-l", { "aria-hidden": "true" }),
    h("h4", { lang: getLang() }, L(obj, "name")),
    h("i.kit-w.sp-pl-" + w + "-r", { "aria-hidden": "true" }),
  ]);
}

/** The site's tags of an entry (patch change, costs), one quiet row under its ribbon; absent when empty. */
const metaRow = (tags) => (tags.some(Boolean) ? h("div.tags.kit-meta", tags) : null);

// ---- what an ability does that its game text leaves out (cards.json `hidden`, docs/DATA.md "Hidden effects"): chained
// hits after the first one, the options of a "Choice" ability, a status the text does not name. One short line under the
// game text, worded here from the structured data; it never adds anything the data does not hold.

const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmtInt(Math.abs(n));
const amountOf = (a, sign) => (Array.isArray(a) ? t("hx.range", { lo: sign ? signed(a[0]) : fmtInt(a[0]), hi: sign ? signed(a[1]) : fmtInt(a[1]) })
  : sign ? signed(a) : fmtInt(a));
// an element name: the orb and the coloured word, as in the game texts (cardtext.js)
const elNode = (id) => elementNode(id, elName(id));

/** Nodes joined by commas, the last pair by `last` (" and " / " or "); `last` null keeps commas throughout. */
function joinNodes(nodes, last) {
  const out = [];
  nodes.forEach((n, i) => {
    if (i) out.push(last && i === nodes.length - 1 ? last : ", ");
    out.push(n);
  });
  return h("span", out);
}

/** One summary item as inline nodes (its own conditions, "on a critical hit" and "on every hit", are worded by its sentence). */
function hxItem(it) {
  const els = () => joinNodes((it.el || []).map(elNode), t("hx.and"));
  let fx;
  if (it.fx === "damage" && it.others) fx = tx("hx.others", { amount: amountOf(it.amount), els: joinNodes(it.el.map(elNode), null) });
  else if (it.fx === "damage") fx = tx(it.count > 1 ? "hx.dmgN" : "hx.dmg", { amount: amountOf(it.amount), el: els(), count: it.count });
  else if (it.fx === "heal") fx = tx(it.count > 1 ? "hx.healN" : "hx.heal", { amount: amountOf(it.amount), el: els(), count: it.count });
  else if (it.fx === "bonus") fx = tx("hx.bonus", { amount: amountOf(it.amount, true), el: els() });
  else if (it.fx === "cooldown") fx = [t("hx.cd", { amount: amountOf(it.amount, true) })];
  else if (it.fx === "accuracy") fx = [t("hx.acc", { amount: amountOf(it.amount, true) })];
  else if (it.fx === "crit") fx = [t("hx.critStat", { amount: amountOf(it.amount, true) })];
  else if (it.fx === "status") fx = [h("b.hx-st", { lang: getLang() }, textNodes(L(it, "name")))];
  else return null;                                  // an item kind this page does not know: shown nowhere, never guessed
  if (it.all) fx = [...fx, " ", t("hx.all." + it.all)];
  if (it.random) fx = [...fx, " ", t("hx.random")];
  return h("span", fx);
}

/** Consecutive single hits of one element with different amounts read as one series: "3 Nature hits of 20, 30 and 40 damage". */
function hxSeries(items) {
  const out = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    const plain = (x) => x.fx === "damage" && !x.others && !x.count && !x.on && !x.random && !x.all && x.el && x.el.length === 1 && !Array.isArray(x.amount);
    if (prev && plain(it) && (prev.series || plain(prev)) && prev.el[0] === it.el[0]) {
      if (!prev.series) out[out.length - 1] = { series: [prev.amount], el: prev.el };
      out[out.length - 1].series.push(it.amount);
    } else out.push(it);
  }
  return out.map((it) => (it.series
    ? h("span", tx("hx.series", { count: it.series.length, el: elNode(it.el[0]), amounts: joinNodes(it.series.map((n) => fmtInt(n)), t("hx.and")) }))
    : hxItem(it))).filter(Boolean);
}

/** The targets caption: a random-target ability hits random cards among its targets, never all of them. */
const targetText = (a) => (a.random_target ? (a.random_target === 1 ? t("target.random") : t("target.randomN", { n: a.random_target }))
  : t("target." + a.target));

function hiddenLine(a, idx) {
  const x = a.hidden;
  if (!x) return null;
  const sentences = [];
  const say = (key, nodes) => { if (nodes.length) sentences.push(h("span.hx-s", tx(key, { fx: joinNodes(nodes, null) }))); };
  if (x.choices) {
    // one row per option, so an option never breaks in the middle of its phrase: "Choose one:", then "15 to 40 Fire
    // damage", "or 15 to 40 Shadow damage"
    const opts = x.choices.map((o) => o.map(hxItem).filter(Boolean).flatMap((n, i) => (i ? [t("hx.plus"), n] : [n]))).filter((o) => o.length);
    if (opts.length) {
      const id = "hx-c-" + idx;
      sentences.push(h("span.hx-s", { id }, t("hx.choose")));
      // "or" sits in its own column, so the options' amounts line up
      sentences.push(h("ul.hx-opts", { "aria-labelledby": id }, opts.map((o, i) => h("li", [h("span.hx-or", i ? t("hx.or") : ""), h("span", o)]))));
    }
  }
  if (x.then) {
    const nodes = hxSeries(x.then.filter((it) => !it.on));
    if (nodes.length) sentences.push(h("span.hx-s", tx("hx.then", { fx: h("span", nodes.flatMap((n, i) => (i ? [t("hx.thenSep"), n] : [n]))) })));
    x.then.filter((it) => it.on === "crit").forEach((it) => say("hx.crit", [hxItem(it)].filter(Boolean)));
  }
  for (const it of x.also || []) {
    const n = hxItem(it);
    if (!n) continue;
    say(it.on === "crit" ? (it.every_hit ? "hx.everyCrit" : "hx.crit") : it.every_hit ? "hx.every" : "hx.also", [n]);
  }
  if (!sentences.length) return null;
  // these words are the site's, not the game's: one line under the abilities says so ("hx.note"), and a hidden prefix says
  // it to a screen reader at the block itself (no title as well, it would be announced twice)
  return h("div.cd-e-x", [h("span.sr", t("hx.title")), ...sentences]);
}

function abilityEntry(c, a, i) {
  const lang = getLang();
  // what it costs, as the data gives it: the cooldown on the ribbon (the card's own cooldown sprite), mana and a use
  // limit with the other tags under the text, when there are
  const cost = [];
  if (a.mana_cost) cost.push(h("span.tag", [t("card.mana") + " ", h("b", String(a.mana_cost))]));
  if (a.uses_limit != null) cost.push(h("span.tag", [t("card.limited") + " ", h("b", t("card.uses", { n: a.uses_limit }))]));
  const cd = t("card.cooldown") + " " + a.cooldown;
  const stats = [
    h("span.tag", [t("card.hit") + " ", h("b", pctInt(a.hit_chance))]),
    h("span.tag", [t("card.crit") + " ", h("b", pctInt(a.crit_chance)), " ×", h("b", String(a.crit_ratio))]),
  ];
  if (a.echo_chance) stats.push(h("span.tag", [t("card.echo") + " ", h("b", pctInt(a.echo_chance))]));
  return h("div.cd-e.kit-e", [
    // the ability's ribbon, as on the card: element orb, name, cooldown in the client's cooldown sprite
    h("div.kit-rib.kit-ab", [h("i.kit-orb.sp-el-" + (a.element || c.element), { role: "img", "aria-label": elName(a.element || c.element) }), h("h4", { lang }, L(a, "name")),
      h("span.kit-cd", { title: cd }, [h("span.sr", cd), h("span", { "aria-hidden": "true" }, String(a.cooldown))])]),
    metaRow([changed(c, "abilities", i)]),
    h("p.cd-e-d", { lang }, textNodes(L(a, "description"))),
    hiddenLine(a, i),
    h("div.cd-e-s", [...stats, ...cost, h("span.cd-e-t", [t("card.targets") + " ", targetText(a)])]),
  ]);
}

function passiveEntry(c, p, i) {
  const lang = getLang();
  return h("div.cd-e.kit-e", [
    wingRibbon(c, p),
    metaRow([changed(c, "passives", i)]),
    h("p.cd-e-d", { lang }, textNodes(L(p, "description"))),
  ]);
}

/**
 * The talents, as the choice they are: a deck drafts ONE of the card's talents (owner, 2026-10-15: "on ne ressent pas trop
 * le switch entre les 3 et la reco"). On the backdrop of the game's own talent draft screen, the talents sit side by side as
 * three tabs (stacked on a phone), the suggested one carrying the "Suggested" tag and selected when the dialog opens; the
 * selected talent's name and text show in one shared detail area under them. Every text stays in the page (the panes share
 * one grid cell, so the area keeps the height of the longest and nothing moves when the choice changes); arrow keys move
 * between the tabs. Without a suggested talent, the first one is selected and no tag is drawn. `pick`: the talent to select
 * instead (the one a ranked deck plays, when the card was opened from that deck).
 */
function talentPicker(c, pick = null) {
  const lang = getLang();
  const sugg = suggestedTalent(c);
  const first = pick != null ? pick : sugg ? sugg.i : 0;
  const id = (i, part) => `tp-${part}-${i}`;
  const tabs = [], panes = [];
  const select = (k, focus) => {
    tabs.forEach((b, i) => {
      const on = i === k;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      panes[i].classList.toggle("on", on);
    });
    if (focus) tabs[k].focus();
  };
  c.talents.forEach((tl, i) => {
    const rec = sugg && i === sugg.i;
    tabs.push(h("button.tp-tab" + (rec ? ".rec" : ""), {
      type: "button", role: "tab", id: id(i, "tab"), "aria-controls": id(i, "pane"), "aria-selected": String(i === first),
      tabIndex: i === first ? 0 : -1, onclick: () => select(i, false),
    }, [
      h("i.tp-ico.ab-talent", { "aria-hidden": "true" }),
      h("span.tp-name", { lang }, L(tl, "name")),
      rec ? h("span.tag.sugg.tp-rec", { title: t("card.suggestedTip") }, t("card.suggested")) : null,
      // the patch mark (its words in the pane's tag, and here for a screen reader)
      entryChanged(c, "talents", i) ? h("span.tp-pc", { title: t("pc.entry", { patch: DB.patch }) }, [glyph(c), h("span.sr", t("pc.entry", { patch: DB.patch }))]) : null,
    ]));
    panes.push(h("div.tp-pane" + (i === first ? ".on" : ""), { role: "tabpanel", id: id(i, "pane"), "aria-labelledby": id(i, "tab") }, [
      // the talent's name is on its tab (the control) and only there; the pane holds its text and, when the patch
      // changed it, its tag
      changed(c, "talents", i) ? h("div.tp-pane-h", changed(c, "talents", i)) : null,
      h("p.cd-e-d", { lang }, textNodes(L(tl, "description"))),
    ]));
  });
  const list = h("div.tp-tabs", { role: "tablist", "aria-label": t("card.talents") }, tabs);
  list.addEventListener("keydown", (e) => {
    const k = tabs.indexOf(document.activeElement);
    if (k < 0) return;
    const n = tabs.length;
    const to = { ArrowRight: k + 1, ArrowDown: k + 1, ArrowLeft: k - 1, ArrowUp: k - 1, Home: 0, End: n - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    select((to + n) % n, true);
  });
  // no intro line (owner, 2026-10-15: players know a deck drafts one talent): the tabs, then the selected talent's text
  return [h("div.tp", [list, h("div.tp-detail", panes)])];
}

/**
 * "With and against": the card's "Strong with", "Strong against" and "Weak against" lists (data/cardcounters.json, loaded
 * the first time a card dialog opens), side by side in three columns (stacked on a phone). Each list holds up to 5 card
 * chips with their signed win-rate points, strongest first, or one "No clear result." line. A quiet tag beside each heading
 * says what the numbers rest on (basic AI; both counter lists are preliminary); the method sits behind a small disclosure.
 * The section always keeps its place in the Meta section: a skeleton while the file loads, an inline error with a Reload button.
 */
let howOpen = false;           // the method disclosure stays as the visitor left it, across cards and languages

/**
 * The section heading; a card the last patch changed carries its patch tag there (the lists predate the patch), unless the
 * Meta section already says so at its top (the data notice "1.22 numbers, from before the change."): said once.
 */
function cmHead(c) {
  return h("div.cm-head", [h("h4#cm-h", t("cm.h")), oldNumbersNote(c) ? null : patchTag(c)]);
}

function counterLists(c, sec) {
  const d = DB.cardCounters, mine = (d.cards && d.cards[c.id]) || {};
  const value = (pts) => h("span.cm-v." + (pts > 0 ? "up" : "down"), [(pts > 0 ? "+" : "−") + fmtInt(Math.abs(pts)), h("span.cm-u", " " + t("cm.pts"))]);
  // one column: its heading (with its quiet tag), then the entries or the empty line
  const list = (key, entries, tag) => {
    const id = "cm-" + key.split(".")[1];
    const items = (entries || []).map(([cid, pts]) => [DB.byId.get(cid), pts]).filter(([x]) => x);
    return h("div.cm-col", [
      h("div.cm-col-h", [h("h5", { id }, t(key)), h("span.tag.soft", tag)]),
      items.length
        ? h("ol.cm-l", { "aria-labelledby": id }, items.map(([x, pts]) => h("li.cm-e", [chip(x), value(pts)])))
        : h("p.cm-none", t("card.noClear")),
    ]);
  };
  const btn = h("button.tdisc", { type: "button", "aria-controls": "cm-how" }, [h("span", t("cm.how")), icon("chevron")]);
  const how = h("div", { id: "cm-how" }, h("div.collapse-in", h("ul.cm-how-l", [
    h("li", tx("cm.howWith", { games: d.synergy.n_games })),
    h("li", tx("cm.howVs", { games: d.counters.n_games })),
  ])));
  disclosure(btn, how, { open: howOpen, onToggle: (v) => { howOpen = v; } });
  const prelim = t("cm.prelim", { ai: t("cm.ai." + d.counters.ai) });
  sec.replaceChildren(
    cmHead(c),
    // both counter lists carry the tag, so neither reads as a fact on its own (coordinator, 2026-10-14)
    h("div.cm-cols", [
      list("card.strongWith", mine.with, t("cm.ai." + d.synergy.ai)),
      list("card.strongAgainst", mine.vs, prelim),
      list("card.weakAgainst", mine.weak, prelim),
    ]),
    h("div.cm-foot", [btn, how]),
  );
}

/** The section shell: filled at once when the lists are loaded, else after the load (or with an error line). */
function counterSection(c) {
  const sec = h("section.cm", { "aria-labelledby": "cm-h" });
  if (DB.cardCounters) { counterLists(c, sec); return sec; }
  sec.setAttribute("aria-busy", "true");
  sec.replaceChildren(cmHead(c), h("div.skel.cm-skel", { "aria-hidden": "true" }, [h("i"), h("i"), h("i")]));
  loadCardCounters().then(() => {
    if (currentKey === c.key && sec.isConnected) counterLists(c, sec);
  }).catch((err) => {
    console.error(err);
    if (currentKey !== c.key || !sec.isConnected) return;
    sec.replaceChildren(cmHead(c), h("div.cm-err", { role: "alert" }, [
      h("p", t("cm.err")),
      h("button.btn", { type: "button", onclick: () => location.reload() }, t("err.reload")),
    ]));
  }).finally(() => sec.removeAttribute("aria-busy"));
  return sec;
}

const TC = { "S+": "sp", S: "s", A: "a", B: "b", C: "c", D: "d", E: "e" };

/** The card's tier on each measurement of the Card tier list (data/cardtiers.json): a tier chip, then the measurement. */
function cardTierRows(c, T) {
  const r = T.cards.find((x) => x.id === c.id) || {};
  return [["competitive", "ct.axC"], ["random", "ct.axR"]].map(([m, k]) => {
    const tier = r[m] && TC[r[m].tier] ? r[m].tier : null;
    return h("li.cd-ct", [h("span.ct-tchip.tc-" + (tier ? TC[tier] : "nm"), tier || t("ct.nm")), h("span", t(k))]);
  });
}

/** The Meta section: where the card ranks, then "With and against". Its numbers fill in once their files are loaded. */
function metaBand(c) {
  const tlFig = h("span.stat-v", "—"), tlCap = h("span.stat-s", " ");
  const tlCell = h("div.stat.cd-stat", { "aria-busy": "true" }, [h("span.stat-k", t("card.tlK")), tlFig, tlCap]);
  const ctList = h("ul.cd-cts", [h("li.cd-ct"), h("li.cd-ct")]);
  const ctCell = h("div.stat.cd-stat", { "aria-busy": "true" }, [h("span.stat-k", t("card.ctK")), ctList]);
  // where the card plays in the deck tier list (the withheld stub and the secret entries have no cards, so never match)
  loadTier().then((tl) => {
    if (currentKey !== c.key) return;
    const decks = tl.decks.filter((d) => !d.withheld && Array.isArray(d.cards) && d.cards.includes(c.id));
    tlFig.textContent = fmtInt(decks.length);
    tlCap.textContent = decks.length ? t("card.tlBest", { rank: decks[0].rank, tier: decks[0].tier }) : t("card.tlNone");
  }).catch(() => { tlCell.remove(); }).finally(() => tlCell.removeAttribute("aria-busy"));
  loadCardTiers().then((T) => {
    if (currentKey !== c.key) return;
    ctList.replaceChildren(...cardTierRows(c, T));
  }).catch(() => { ctCell.remove(); }).finally(() => ctCell.removeAttribute("aria-busy"));

  return h("section.cd-meta", { "aria-labelledby": "cd-meta-h" }, [
    h("div.cd-meta-h", [
      h("h3#cd-meta-h", t("card.metaH")),
      h("a.btn.cd-find", { href: "#builder", "data-goto": "builder", "data-pick": c.key, title: t("card.findDecksTitle") }, [icon("search"), t("card.findDecks")]),
    ]),
    // the numbers below were measured before the patch: said once, above them
    oldNumbersNote(c),
    h("div.cd-stats", [tlCell, ctCell]),
    counterSection(c),
  ]);
}

/**
 * The Meta section while only the deck ranking is shown (patch.js DECK_RANKING_SHOWN): one data notice naming the ranking
 * ("Temporary ranking, patch 1.26."), then two stat cells, the decks of each list that play the card with the best rank,
 * and "Decks with this card": the Deck builder with the card picked while it is shown (patch.js DECK_TABLE_SHOWN), else,
 * when a listed deck plays it, the Deck tier list searched for the card. No card tier and no "With and against" (1.22 files).
 */
function rankingBand(c) {
  const cell = (label, fig, cap) => h("div.stat.cd-stat", [h("span.stat-k", label), h("span.stat-v", fig), h("span.stat-s", cap)]);
  const sec = h("section.cd-meta", { "aria-labelledby": "cd-meta-h" });
  const paint = (R) => {
    const holds = (list) => list.decks.filter((d) => d.cards.includes(c.id));
    const score = holds(R.by_score), speed = holds(R.by_speed);
    const best = (list, none) => (list.length ? t("card.rkBest", { rank: list[0].rank }) : t(none));
    sec.replaceChildren(
      h("div.cd-meta-h", [
        h("h3#cd-meta-h", t("card.metaH")),
        // the Deck builder with this card picked while it is shown (every measured deck), else the Deck tier list searched for it
        DECK_TABLE_SHOWN
          ? h("a.btn.cd-find", { href: "#builder", "data-goto": "builder", "data-pick": c.key, title: t("card.findDecksTitle") }, [icon("search"), t("card.findDecks")])
          : score.length || speed.length
            ? h("a.btn.cd-find", { href: "#tiers", "data-goto": "tiers", "data-find": c.key, title: t("card.rkFindTitle") }, [icon("search"), t("card.findDecks")])
            : null,
      ]),
      h("p.dnote", [icon("info"), h("span", t(R.final ? "card.rkNote" : "card.rkNoteProv", { patch: R.patch }))]),
      h("div.cd-stats", [
        cell(t("card.rkScoreK", { n: R.by_score.decks.length }), fmtInt(score.length), best(score, "card.tlNone")),
        cell(t("card.rkSpeedK", { n: R.by_speed.decks.length }), fmtInt(speed.length), best(speed, "card.tlNone")),
      ]),
    );
  };
  if (DB.ranking) paint(DB.ranking);
  else {
    sec.setAttribute("aria-busy", "true");
    sec.replaceChildren(h("div.cd-meta-h", h("h3#cd-meta-h", t("card.metaH"))), h("div.skel.cm-skel", { "aria-hidden": "true" }, [h("i"), h("i")]));
    loadRanking().then((R) => { if (currentKey === c.key && sec.isConnected) paint(R); })
      .catch(() => { if (sec.isConnected) sec.remove(); })
      .finally(() => sec.removeAttribute("aria-busy"));
  }
  return sec;
}

function renderCardDialog() {
  const c = DB.byKey.get(currentKey);
  const dlg = cardDlg();
  unsize(dlg);
  const lang = getLang();
  const own = isOwned(c.key);
  const ownBtn = h("button.btn.toggle", { type: "button", "aria-pressed": String(own), "data-own-dlg": c.key, "aria-describedby": DECK_TABLE_SHOWN ? "cd-hint" : null, onclick: () => {
    setOwned(c.key, !isOwned(c.key));
  } }, [icon("plus"), icon("check"), h("span.on-off", t(own ? "card.isOwned" : "card.markOwned"))]);

  const resist = ELEMENTS.filter((id) => c.resistances && c.resistances[id] != null).map((id) =>
    // a resistance is a percentage (the game's own texts: "résistances du lanceur de (+5%)")
    h("li.res", { title: t("card.resistance", { element: elName(id) }) }, [h("span.sr", t("card.resistance", { element: elName(id) }) + " "), h("i.sp-el-" + id), h("b", pctInt(c.resistances[id]))]));
  const tag = patchTag(c), what = patchDetail(c);
  // what the last patch changed, in its own section at the foot of the view (owner, 2026-10-15), the notes as they read
  // before; absent for an unchanged card
  const mods = tag ? h("section.cd-mods", { "aria-labelledby": "cd-mods-h" }, [
    h("h3#cd-mods-h", t("card.changesH")),
    h("ul.cd-mods-l", [h("li", tag), what ? h("li", what) : null]),
  ]) : null;

  const kit = [
    kitGroup("cd-ab", t("card.abilities"), c.abilities.length ? c.abilities.map((a, i) => abilityEntry(c, a, i)) : [h("p.cd-none", t("card.noAbility"))],
      // where the ruled lines come from, said once under the abilities that have them
      c.abilities.some((a) => a.hidden) ? h("p.hx-note", [h("span.hx-note-rule", { "aria-hidden": "true" }), t("hx.note")]) : null),
    c.passives.length ? kitGroup("cd-pa", t("card.passives"), c.passives.map((p, i) => passiveEntry(c, p, i))) : null,
    c.talents.length ? kitGroup("cd-ta", t("card.talents"), talentPicker(c, currentTalent)) : null,
  ];

  // the card's name is the dialog's accessible name; it is not printed (owner, 2026-10-15: the card face carries it)
  const body = h("div.cd", [
    h("h2.sr#dlg-name", { lang }, cardName(c)),
    h("div.cd-body", [
      h("div.cd-art", [
        // the card in the site's card tile, as the Codex draws it (plain: it is not a button here)
        cardTile(c, { interactive: false, eager: true }),
        // the six resistances straight under the card, untitled (owner, 2026-10-15: players know what they are); the
        // list keeps its name for screen readers
        resist.length ? h("ul.ress", { "aria-label": t("card.resistances") }, resist) : null,
        // "Owned cards feed My decks." only while My decks is shown (patch.js DECK_TABLE_SHOWN)
        h("div.cd-own", [ownBtn, DECK_TABLE_SHOWN ? h("p.cd-hint#cd-hint", t("card.feeds")) : null]),
      ]),
      h("div.cd-kit", kit),
    ]),
    // the Meta section reads the rankings: the full one with them, the deck ranking's counts alone with it, else none
    CARD_RANKINGS_SHOWN ? metaBand(c) : DECK_RANKING_SHOWN ? rankingBand(c) : null,
    mods,
  ]);
  $(".dlg-scroll", dlg).replaceChildren(body);
  dlg.setAttribute("aria-labelledby", "dlg-name");
  // the big card can be tilted and turned with the pointer (cardtilt.js; not with reduced motion)
  attachTilt($(".cd-art .cell", dlg));
}

export function syncDialogOwned() {
  const b = document.querySelector("[data-own-dlg]");
  if (!b || !cardDlg().open) return;
  const on = isOwned(b.dataset.ownDlg);
  b.setAttribute("aria-pressed", String(on));
  b.querySelector(".on-off").textContent = t(on ? "card.isOwned" : "card.markOwned");
}

// ---------------------------------------------------------------- About
/** One stage of the lab's funnel in plain words, from meta.json `methodology.pipeline` (numbers only). */
function stageText(s) {
  const p = { refs: s.reference_decks, games: s.games_per_deck, probes: s.probe_decks, decks: s.decks, gpp: s.games_per_pair,
    rounds: (s.rounds_games || []).join(" / ") };
  return t("about.stage." + s.stage, p);
}

function buildAbout() {
  // while the rankings are not shown (patch.js), About says what the site holds today: the cards, and the rankings being computed
  const R = deckRanking();
  if (!CARD_RANKINGS_SHOWN && R) return h("div.about", [
    h("h2#about-title", t("about.h")),
    h("p.lead", tx("about.lead")),
    h("section", [h("h3", t("about.whatH")), h("p", t(R.final ? "about.whatRk" : "about.whatRkProv", { patch: R.patch }))]),
    h("section", [
      h("h3", t("about.howH")),
      h("p", t("about.rkHow", { ai: R.pilot, games: R.games, pool: R.pool, kept: R.by_score.decks_measured,
        n: R.by_score.opponents, per: gameSpan(R.by_score.games_per_opponent) })),
      h("p", t("about.rkSpeed", { median: medianRounds(R) })),
    ]),
    h("section", [h("h3", t("about.limitsH")), h("ul", R.limits.map((l) => h("li", t("rk.limit." + l, limitParams(R)))))]),
    h("section", [h("h3", t("about.dataH")), h("p", t("about.data", { line: patchLine(), date: fmtDate(dataDate()) }))]),
    h("p.legal", t("foot.legal")),
  ]);
  if (!CARD_RANKINGS_SHOWN) return h("div.about", [
    h("h2#about-title", t("about.h")),
    h("p.lead", tx("about.lead")),
    h("section", [h("h3", t("about.whatH")), h("p", t("about.whatCards", { patch: GAME_PATCH.patch }))]),
    h("section", [h("h3", t("about.dataH")), h("p", t("about.data", { line: patchLine(), date: fmtDate(dataDate()) }))]),
    h("p.legal", t("foot.legal")),
  ]);
  const m = DB.meta, mm = m.methodology;
  const down = (m.totals && m.totals.decks_withheld) || 0;
  const cc = mm.cross_check || {};
  return h("div.about", [
    h("h2#about-title", t("about.h")),
    h("p.lead", tx("about.lead")),
    h("section", [h("h3", t("about.whatH")), h("p", t("about.what"))]),
    h("section", [
      h("h3", t("about.howH")),
      h("p", tx("about.how")),
      h("ol.stages", mm.pipeline.map((s) => h("li", [h("b", t("stage." + s.stage + ".title")), h("span", stageText(s))]))),
      h("p", t("about.total", { decks: m.totals.decks_measured, patch: m.patch, games: millions(m.totals.patch_games || m.totals.simulated_games) })),
      cc.same_winner && cc.same_top4 ? h("p", t("about.cross")) : null,
    ]),
    h("section", [h("h3", t("about.readH")), h("p", t("about.read"))]),
    h("section", [
      h("h3", t("about.limitsH")),
      h("ul", [
        ...mm.limits.map((l) => h("li", t("limit." + l.id, { from: l.from, to: l.to, pm: l.pm }))),
        down ? h("li", t("about.down", { n: down })) : null,
        h("li", t("about.talents")),
      ]),
    ]),
    h("section", [h("h3", t("about.dataH")), h("p", t("about.data", { line: patchLine(), date: fmtDate(m.generated) }))]),
    h("p.legal", t("foot.legal")),
  ]);
}

// ---------------------------------------------------------------- collection code
const codeState = { parsed: null };

function paintCodeCount() {
  $("#code-count").textContent = ownedCount() ? t("code.count", { n: ownedCount() }) : t("code.empty");
  paintCodeMsg();
}

export function openCollection() {
  const dlg = $("#dlg-code");
  const code = encode(ownedKeys(), DB.cards.map((c) => c.key));
  $("#code-out", dlg).value = code;
  $("#code-in", dlg).value = "";
  $("#code-replace", dlg).disabled = true;
  $("#code-add", dlg).disabled = true;
  // without storage the warning replaces the "saved in this browser only" sentence (the two would contradict)
  $("#code-store", dlg).hidden = canPersist();
  $("#code-p", dlg).hidden = !canPersist();
  codeState.parsed = null;
  codeState.error = null;
  paintCodeCount();
  openModal(dlg);
}

/** The line under the import field: the error of the pasted code, or what it holds. */
function paintCodeMsg() {
  const msg = $("#code-msg");
  const r = codeState.parsed;
  if (codeState.error) { msg.textContent = t("code.err." + codeState.error); msg.className = "msg err"; return; }
  if (!r) { msg.textContent = ""; msg.className = "msg"; return; }
  msg.className = "msg ok";
  msg.textContent = t("code.holds", { n: r.keys.length }) + (r.unknown ? t("code.unknown", { n: r.unknown }) : "");
}

function initCollectionDialog() {
  const dlg = $("#dlg-code");
  const all = () => DB.cards.map((c) => c.key);
  const inp = $("#code-in", dlg);
  inp.addEventListener("input", () => {
    const text = inp.value.trim();
    codeState.parsed = null;
    codeState.error = null;
    $("#code-replace", dlg).disabled = true;
    $("#code-add", dlg).disabled = true;
    if (text) {
      const r = decode(text, all());
      if (r.error) codeState.error = r.error;
      else {
        codeState.parsed = r;
        $("#code-replace", dlg).disabled = false;
        $("#code-add", dlg).disabled = false;
      }
    }
    paintCodeMsg();
  });
  $("#code-copy", dlg).addEventListener("click", async () => {
    const out = $("#code-out", dlg);
    const ok = await copyText(out.value, out);
    toast(t(ok ? "code.copiedToast" : "code.copyFail"));
  });
  $("#code-replace", dlg).addEventListener("click", () => {
    if (!codeState.parsed) return;
    const before = ownedKeys();
    const n = codeState.parsed.keys.length;
    replaceOwned(codeState.parsed.keys);
    closeModal(dlg);
    toast(t("code.replaced", { n }), { label: t("ui.undo"), run: () => replaceOwned(before) });
  });
  $("#code-add", dlg).addEventListener("click", () => {
    if (!codeState.parsed) return;
    const before = ownedKeys();
    replaceOwned([...before, ...codeState.parsed.keys]);
    closeModal(dlg);
    toast(t("code.added", { n: ownedCount() }), { label: t("ui.undo"), run: () => replaceOwned(before) });
  });
}

export function initDialogs() {
  for (const d of document.querySelectorAll("dialog")) wire(d);
  $("#about-body").replaceChildren(buildAbout());
  initCollectionDialog();
}

export function openAbout() { openModal($("#dlg-about")); }
