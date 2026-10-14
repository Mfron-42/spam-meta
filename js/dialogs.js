// Dialogs (card, About, collection code) and the toast. Native <dialog>: the browser traps focus, makes the page behind
// inert and closes on Escape; we add the 280 ms enter, the back-button close and the backdrop click.

import { h, $, icon, reducedMotion, pct, fmtDate } from "./util.js";
import { DB, loadTier, dumpDay } from "./data.js";
import { getLang, isOwned, setOwned, ownedKeys, replaceOwned, ownedCount, canPersist } from "./store.js";
import { gameCard, chip, L, cardName, otherName, ELEMENTS, elName, raName, unsize } from "./cards.js";
import { encode, decode } from "./code.js";
import { copyText } from "./ui.js";
import { t, tx, millions } from "./i18n.js";

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

/** A language change redraws what the dialogs show: the open card, the About text, the collection dialog's counts. */
export function refreshDialogs() {
  if (currentKey && cardDlg().open) renderCardDialog();
  $("#about-body").replaceChildren(buildAbout());
  if ($("#dlg-code").open) paintCodeCount();
}

const fact = (k, v) => h("div.fact", [h("span.fact-k", k), h("span.fact-v", v)]);

// An ability, passive or talent the exporter flagged as changed since the game files the values come from: a quiet note
// placed before the numbers it qualifies (DESIGN.md, "Data notice"); `data_notice` is a notice code, "notice.<code>".
const dataNote = (e) => e.data_notice ? h("p.dnote", [icon("info"), h("span", [h("span.sr", t("card.note") + " "),
  t("notice." + e.data_notice, { date: dumpDay(), patch: DB.patch })])]) : null;

const pctInt = (n) => pct(n / 100, 0);

function abilityBlock(c, a) {
  const tags = [h("span.tag", [t("card.cooldown") + " ", h("b", String(a.cooldown))])];
  if (a.mana_cost) tags.push(h("span.tag", [t("card.mana") + " ", h("b", String(a.mana_cost))]));
  if (a.uses_limit != null) tags.push(h("span.tag", [t("card.limited") + " ", h("b", t("card.uses", { n: a.uses_limit }))]));
  const stats = [
    h("span.tag", [t("card.hit") + " ", h("b", pctInt(a.hit_chance))]),
    h("span.tag", [t("card.crit") + " ", h("b", pctInt(a.crit_chance)), " ×", h("b", String(a.crit_ratio))]),
  ];
  if (a.echo_chance) stats.push(h("span.tag", [t("card.echo") + " ", h("b", pctInt(a.echo_chance))]));
  return h("div.ab", [
    h("div.ab-h", [h("i.ab-orb.sp-el-" + (a.element || c.element)), h("h4", { lang: getLang() }, L(a, "name")), h("span.tags", tags)]),
    dataNote(a),
    h("p.ab-d", { lang: getLang() }, L(a, "description")),
    h("div.tags", stats),
    h("p.ab-t", [t("card.targets") + " ", t("target." + a.target)]),
  ]);
}

/**
 * Per-card matchup lists ("Strong with", "Strong against", "Weak against"): a slot for the lab's card counters, which are
 * not published yet. Each list is a row of card chips, or "No clear result yet."; returns null while there is no data.
 */
function counterLists(c) {
  const data = DB.cardCounters && DB.cardCounters.get(c.id);
  if (!data) return null;
  const list = (key, ids) => h("div.ab", [h("h4", t(key)), ids && ids.length
    ? h("p.tags", ids.map((id) => DB.byId.get(id)).filter(Boolean).map(chip))
    : h("p.muted", t("card.noClear"))]);
  return [list("card.strongWith", data.with), list("card.strongAgainst", data.against), list("card.weakAgainst", data.weak)];
}

function renderCardDialog() {
  const c = DB.byKey.get(currentKey);
  const dlg = cardDlg();
  unsize(dlg);
  const lang = getLang();
  const own = isOwned(c.key);
  const ownBtn = h("button.btn.toggle", { type: "button", "aria-pressed": String(own), "data-own-dlg": c.key, onclick: () => {
    setOwned(c.key, !isOwned(c.key));
  } }, [icon("plus"), icon("check"), h("span.on-off", t(own ? "card.isOwned" : "card.markOwned"))]);

  const resist = ELEMENTS.filter((id) => c.resistances && c.resistances[id] != null).map((id) =>
    h("li.res", { title: t("card.resistance", { element: elName(id) }) }, [h("span.sr", t("card.resistance", { element: elName(id) }) + " "), h("i.sp-el-" + id), h("b", String(c.resistances[id]))]));

  const abilities = c.abilities.length ? c.abilities.map((a) => abilityBlock(c, a)) : [h("p.muted", t("card.noAbility"))];
  const passives = c.passives.map((p) => h("div.ab", [
    h("div.ab-h", [h("h4", { lang }, L(p, "name")), h("span.tag.soft", t("card.passive"))]),
    dataNote(p),
    h("p.ab-d", { lang }, L(p, "description")),
  ]));
  const talents = c.talents.map((tl) => h("div.ab", [
    h("div.ab-h", [h("i.ab-talent"), h("h4", { lang }, L(tl, "name"))]),
    dataNote(tl),
    h("p.ab-d", { lang }, L(tl, "description")),
  ]));
  const counters = counterLists(c);
  const where = h("p.dlg-where.muted");

  const body = h("div.dlg", [
    h("div.dlg-card", [
      h("div.gcwrap", gameCard(c, { size: "full", interactive: false, eager: true })),
      ownBtn,
      h("p.dlg-hint", t("card.feeds")),
    ]),
    h("div.dlg-txt", [
      h("div.dlg-title", [
        h("h2#dlg-name", { lang }, cardName(c)),
        otherName(c) !== cardName(c) ? h("p.muted", { lang: lang === "fr" ? "en" : "fr", translate: "no" }, otherName(c)) : null,
      ]),
      h("div.facts", [
        fact(t("card.element"), [h("i.fact-ico.sp-el-" + c.element), elName(c.element)]),
        fact(t("card.rarity"), [h("i.fact-ico.sp-gem-" + c.rarity), raName(c.rarity)]),
        fact(t("card.hp"), String(c.hp)),
        fact(t("card.gold"), String(c.gold_income)),
      ]),
      resist.length ? h("section.dlg-sec", [h("h3", t("card.resistances")), h("ul.ress", resist)]) : null,
      h("section.dlg-sec", [h("h3", t("card.abilities")), ...abilities]),
      passives.length ? h("section.dlg-sec", [h("h3", t("card.passives")), ...passives]) : null,
      talents.length ? h("section.dlg-sec", [h("h3", t("card.talents")), h("p.muted", t("card.talentsNote")), ...talents]) : null,
      counters ? h("section.dlg-sec", counters) : null,
      where,
    ]),
  ]);
  $(".dlg-scroll", dlg).replaceChildren(body);
  dlg.setAttribute("aria-labelledby", "dlg-name");

  // where the card plays: filled once the tier list is loaded
  loadTier().then((tl) => {
    if (currentKey !== c.key) return;
    const decks = tl.decks.filter((d) => !d.withheld && Array.isArray(d.cards) && d.cards.includes(c.id));
    if (!decks.length) { where.textContent = t("card.inNoDeck"); return; }
    const best = decks[0];
    where.textContent = t("card.inDecks", { n: decks.length, rank: best.rank, tier: best.tier });
  }).catch(() => { where.remove(); });
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
  $("#code-store", dlg).hidden = canPersist();
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
