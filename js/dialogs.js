// Dialogs (card, About, collection code) and the toast. Native <dialog>: the browser traps focus, makes the page behind
// inert and closes on Escape; we add the 280 ms enter, the back-button close and the backdrop click.

import { h, $, icon, reducedMotion, pct, fmtDate, fmtInt } from "./util.js?v=7e4699d742";
import { DB, loadTier, loadCardTiers, loadCardCounters } from "./data.js?v=7e4699d742";
import { getLang, isOwned, setOwned, ownedKeys, replaceOwned, ownedCount, canPersist } from "./store.js?v=7e4699d742";
import { gameCard, chip, L, cardName, otherName, ELEMENTS, elName, raName, unsize } from "./cards.js?v=7e4699d742";
import { encode, decode } from "./code.js?v=7e4699d742";
import { copyText, disclosure } from "./ui.js?v=7e4699d742";
import { t, tx, millions } from "./i18n.js?v=7e4699d742";
import { patchTag, patchDetail, entryChanged, entryTag, oldNumbersNote, suggestedTalent } from "./patch.js?v=7e4699d742";

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
  dlg.classList.remove("on");
  if (dlg.open) dlg.close();
  document.documentElement.classList.remove("modal-open");
  if (openDlg === dlg) openDlg = null;
  if (dlg._onClose) { const f = dlg._onClose; dlg._onClose = null; f(); }
}

export function closeModal(dlg, fromPop = false) {
  if (!dlg.open) return;
  dlg.classList.remove("on");
  waitClose(() => closeNow(dlg));
  if (pushed && !fromPop) { pushed = false; history.back(); }
}

window.addEventListener("popstate", () => {
  if (openDlg) { pushed = false; closeModal(openDlg, true); }
});

function wire(dlg) {
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); closeModal(dlg); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) closeModal(dlg); });
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
let currentKey = null;
const cardDlg = () => $("#dlg-card");

export function openCard(key, mode) {
  const c = DB.byKey.get(key);
  if (!c) return;
  currentKey = key;
  renderCardDialog();
  const dlg = cardDlg();
  const tab = location.hash.replace(/^#/, "").split("/")[0] || "tiers";
  const fromUrl = mode === "url" && !dlg.open;
  dlg._fromUrl = fromUrl;
  openModal(dlg, () => {
    currentKey = null; unsize(dlg);
    if (dlg._fromUrl) { history.replaceState(null, "", "#" + tab); dlg._fromUrl = false; }
  }, `#${tab}/${key}`);
  dlg.querySelector(".dlg-scroll").scrollTop = 0;
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
  if (currentKey && cardDlg().open) renderCardDialog();
  $("#about-body").replaceChildren(buildAbout());
  if ($("#dlg-code").open) paintCodeCount();
}

// ---- the card dialog, in three zones (DESIGN.md, "Card dialog"): a header band with what the card is (names, patch line,
// element, rarity, HP, gold, the owned toggle); the card itself, its game art (with its resistances) on the left and its
// kit on the right in framed groups (abilities, passives, talents with the suggested one first); then, on the night
// ground, the "Meta" band: where it ranks (tier-list decks, card tier), "With and against" and the Deck finder link.

const fact = (k, v) => h("li.fact", [h("span.fact-k", k), h("span.fact-v", v)]);

const pctInt = (n) => pct(n / 100, 0);

// an ability, passive or talent the last game patch changed carries a quiet tag beside its name (patch.js)
const changed = (c, part, i) => (entryChanged(c, part, i) ? entryTag(c) : null);

/** One framed group of the kit: its heading row (with an optional caption), then its entries. */
function kitGroup(id, title, entries, note) {
  return h("section.cd-g", { "aria-labelledby": id }, [
    h("div.cd-g-h", [h("h3", { id }, title), note ? h("span.cd-g-note", note) : null]),
    h("div.cd-g-b", entries),
  ]);
}

function abilityEntry(c, a, i) {
  const lang = getLang();
  // what it costs, as the data gives it: cooldown always, mana and a use limit when there are
  const cost = [h("span.tag", [t("card.cooldown") + " ", h("b", String(a.cooldown))])];
  if (a.mana_cost) cost.push(h("span.tag", [t("card.mana") + " ", h("b", String(a.mana_cost))]));
  if (a.uses_limit != null) cost.push(h("span.tag", [t("card.limited") + " ", h("b", t("card.uses", { n: a.uses_limit }))]));
  const stats = [
    h("span.tag", [t("card.hit") + " ", h("b", pctInt(a.hit_chance))]),
    h("span.tag", [t("card.crit") + " ", h("b", pctInt(a.crit_chance)), " ×", h("b", String(a.crit_ratio))]),
  ];
  if (a.echo_chance) stats.push(h("span.tag", [t("card.echo") + " ", h("b", pctInt(a.echo_chance))]));
  return h("div.cd-e", [
    h("div.cd-e-h", [h("i.ab-orb.sp-el-" + (a.element || c.element)), h("h4", { lang }, L(a, "name")), changed(c, "abilities", i),
      h("span.tags.cd-cost", cost)]),
    h("p.cd-e-d", { lang }, L(a, "description")),
    h("div.cd-e-s", [...stats, h("span.cd-e-t", [t("card.targets") + " ", t("target." + a.target)])]),
  ]);
}

function passiveEntry(c, p, i) {
  const lang = getLang();
  return h("div.cd-e", [
    h("div.cd-e-h", [h("h4", { lang }, L(p, "name")), changed(c, "passives", i)]),
    h("p.cd-e-d", { lang }, L(p, "description")),
  ]);
}

/**
 * The talents: the suggested one (the talent the site's simulations give the card) first, in a sunken cell headed
 * "Suggested talent", then the others as a quieter list. Without a suggested talent, the plain list.
 */
function talentEntries(c) {
  const lang = getLang();
  const sugg = suggestedTalent(c);
  const row = (tl, i) => h("li.cd-t", [
    h("div.cd-e-h", [h("i.ab-talent", { "aria-hidden": "true" }), h("h4", { lang }, L(tl, "name")), changed(c, "talents", i)]),
    h("p.cd-e-d", { lang }, L(tl, "description")),
  ]);
  const others = c.talents.map((tl, i) => [tl, i]).filter(([, i]) => !sugg || i !== sugg.i);
  if (!sugg) return [h("ul.cd-tl", others.map(([tl, i]) => row(tl, i)))];
  return [
    h("div.cd-sugg", [
      h("span.tag.sugg.cd-sugg-k", { title: t("card.suggestedTip") }, t("card.suggestedH")),
      h("div.cd-e-h", [h("i.ab-talent", { "aria-hidden": "true" }), h("h4", { lang }, L(sugg.tl, "name")), changed(c, "talents", sugg.i)]),
      h("p.cd-e-d", { lang }, L(sugg.tl, "description")),
    ]),
    others.length ? h("div.cd-others", [h("p.cd-others-k", t("card.otherTalents")), h("ul.cd-tl", others.map(([tl, i]) => row(tl, i)))]) : null,
  ];
}

/**
 * "With and against": the card's "Strong with", "Strong against" and "Weak against" lists (data/cardcounters.json, loaded
 * the first time a card dialog opens), side by side in three columns (stacked on a phone). Each list holds up to 5 card
 * chips with their signed win-rate points, strongest first, or one "No clear result." line. A quiet tag beside each heading
 * says what the numbers rest on (basic AI; both counter lists are preliminary); the method sits behind a small disclosure.
 * The section always keeps its place in the Meta band: a skeleton while the file loads, an inline error with a Reload button.
 */
let howOpen = false;           // the method disclosure stays as the visitor left it, across cards and languages

/** The section heading; a card the last patch changed carries its patch tag there (the lists predate the patch). */
function cmHead(c) {
  return h("div.cm-head", [h("h4#cm-h", t("cm.h")), patchTag(c)]);
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
  const btn = h("button.cm-how", { type: "button", "aria-controls": "cm-how" }, [h("span", t("cm.how")), icon("chevron")]);
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

/** The Meta band: where the card ranks, then "With and against". Its numbers fill in once their files are loaded. */
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
      h("a.btn.cd-find", { href: "#builder", "data-goto": "builder", "data-pick": c.key }, [icon("search"), t("card.findDecks")]),
    ]),
    // the numbers below were measured before the patch: said once, above them
    oldNumbersNote(c),
    h("div.cd-stats", [tlCell, ctCell]),
    counterSection(c),
  ]);
}

function renderCardDialog() {
  const c = DB.byKey.get(currentKey);
  const dlg = cardDlg();
  unsize(dlg);
  const lang = getLang();
  const own = isOwned(c.key);
  const ownBtn = h("button.btn.toggle", { type: "button", "aria-pressed": String(own), "data-own-dlg": c.key, "aria-describedby": "cd-hint", onclick: () => {
    setOwned(c.key, !isOwned(c.key));
  } }, [icon("plus"), icon("check"), h("span.on-off", t(own ? "card.isOwned" : "card.markOwned"))]);

  const resist = ELEMENTS.filter((id) => c.resistances && c.resistances[id] != null).map((id) =>
    h("li.res", { title: t("card.resistance", { element: elName(id) }) }, [h("span.sr", t("card.resistance", { element: elName(id) }) + " "), h("i.sp-el-" + id), h("b", String(c.resistances[id]))]));
  const tag = patchTag(c), what = patchDetail(c);

  const kit = [
    kitGroup("cd-ab", t("card.abilities"), c.abilities.length ? c.abilities.map((a, i) => abilityEntry(c, a, i)) : [h("p.cd-none", t("card.noAbility"))]),
    c.passives.length ? kitGroup("cd-pa", t("card.passives"), c.passives.map((p, i) => passiveEntry(c, p, i))) : null,
    c.talents.length ? kitGroup("cd-ta", t("card.talents"), talentEntries(c), t("card.talentsNote")) : null,
  ];

  const body = h("div.cd", [
    h("header.cd-head", [
      h("div.cd-id", [
        h("h2#dlg-name", { lang }, cardName(c)),
        otherName(c) !== cardName(c) ? h("p.cd-alt", { lang: lang === "fr" ? "en" : "fr", translate: "no" }, otherName(c)) : null,
        tag ? h("p.pline", [tag, what ? h("span", what) : null]) : null,
      ]),
      h("ul.cd-facts", [
        fact(t("card.element"), [h("i.fact-ico.sp-el-" + c.element), elName(c.element)]),
        fact(t("card.rarity"), [h("i.fact-ico.sp-gem-" + c.rarity), raName(c.rarity)]),
        fact(t("card.hp"), String(c.hp)),
        fact(t("card.gold"), String(c.gold_income)),
      ]),
      h("div.cd-own", [ownBtn, h("p.cd-hint#cd-hint", t("card.feeds"))]),
    ]),
    h("div.cd-body", [
      h("div.cd-art", [
        h("div.gcwrap", gameCard(c, { size: "full", interactive: false, eager: true })),
        resist.length ? h("section.cd-res", { "aria-labelledby": "cd-res-h" }, [h("h3#cd-res-h", t("card.resistances")), h("ul.ress", resist)]) : null,
      ]),
      h("div.cd-kit", kit),
    ]),
    metaBand(c),
  ]);
  $(".dlg-scroll", dlg).replaceChildren(body);
  dlg.setAttribute("aria-labelledby", "dlg-name");
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
    h("section", [h("h3", t("about.dataH")), h("p", t("about.data", { patch: m.patch, date: fmtDate(m.generated) }))]),
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
