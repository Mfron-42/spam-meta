// Dialogs (card, About, collection code) and the toast. Native <dialog>: the browser traps focus, makes the page behind
// inert and closes on Escape; we add the 280 ms enter, the back-button close and the backdrop click.

import { h, $, icon, reducedMotion, fmtInt, plural } from "./util.js";
import { DB, loadTier, withheldLong } from "./data.js";
import { getLang, isOwned, setOwned, ownedKeys, replaceOwned, ownedCount, canPersist } from "./store.js";
import { gameCard, L, cardName, otherName, ELEMENTS, ELEMENT_NAME, RARITY_NAME, unsize } from "./cards.js";
import { encode, decode } from "./code.js";
import { copyText } from "./ui.js";

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

export function refreshCardDialog() { if (currentKey && cardDlg().open) renderCardDialog(); }

const fact = (k, v) => h("div.fact", [h("span.fact-k", k), h("span.fact-v", v)]);

// An ability, passive or talent the exporter flagged as changed since the game files the values come from: a quiet note
// placed before the numbers it qualifies (DESIGN.md, "Data notice"). English UI text, so it keeps the page language.
const dataNote = (e) => e.data_notice ? h("p.dnote", [icon("info"), h("span", [h("span.sr", "Note: "), e.data_notice])]) : null;

function abilityBlock(c, a) {
  const tags = [h("span.tag", ["Cooldown ", h("b", String(a.cooldown))])];
  if (a.mana_cost) tags.push(h("span.tag", ["Mana ", h("b", String(a.mana_cost))]));
  if (a.uses_limit != null) tags.push(h("span.tag", ["Limited to ", h("b", plural(a.uses_limit, "use"))]));
  const stats = [
    h("span.tag", ["Hit ", h("b", `${a.hit_chance}%`)]),
    h("span.tag", ["Crit ", h("b", `${a.crit_chance}%`), " ×", h("b", String(a.crit_ratio))]),
  ];
  if (a.echo_chance) stats.push(h("span.tag", ["Echo ", h("b", `${a.echo_chance}%`)]));
  return h("div.ab", [
    h("div.ab-h", [h("i.ab-orb.sp-el-" + (a.element || c.element)), h("h4", { lang: getLang() }, L(a, "name")), h("span.tags", tags)]),
    dataNote(a),
    h("p.ab-d", { lang: getLang() }, L(a, "description")),
    h("div.tags", stats),
    h("p.ab-t", ["Targets: ", a.targets]),
  ]);
}

function renderCardDialog() {
  const c = DB.byKey.get(currentKey);
  const dlg = cardDlg();
  unsize(dlg);
  const lang = getLang();
  const own = isOwned(c.key);
  const ownBtn = h("button.btn.toggle", { type: "button", "aria-pressed": String(own), "data-own-dlg": c.key, onclick: () => {
    setOwned(c.key, !isOwned(c.key));
  } }, [icon("plus"), icon("check"), h("span.on-off", own ? "Owned" : "Mark as owned")]);

  const resist = ELEMENTS.filter(([id]) => c.resistances && c.resistances[id] != null).map(([id, label]) =>
    h("li.res", { title: `${label} resistance` }, [h("span.sr", `${label} resistance `), h("i.sp-el-" + id), h("b", String(c.resistances[id]))]));

  const abilities = c.abilities.length ? c.abilities.map((a) => abilityBlock(c, a)) : [h("p.muted", "This card has no active ability.")];
  const passives = c.passives.map((p) => h("div.ab", [
    h("div.ab-h", [h("h4", { lang }, L(p, "name")), h("span.tag.soft", "Passive")]),
    dataNote(p),
    h("p.ab-d", { lang }, L(p, "description")),
  ]));
  const talents = c.talents.map((t) => h("div.ab", [
    h("div.ab-h", [h("i.ab-talent"), h("h4", { lang }, L(t, "name"))]),
    dataNote(t),
    h("p.ab-d", { lang }, L(t, "description")),
  ]));
  const where = h("p.dlg-where.muted");

  const body = h("div.dlg", [
    h("div.dlg-card", [
      h("div.gcwrap", gameCard(c, { size: "full", interactive: false, eager: true })),
      ownBtn,
      h("p.dlg-hint", "Owned cards feed the My decks tab."),
    ]),
    h("div.dlg-txt", [
      h("div.dlg-title", [
        h("h2#dlg-name", { lang }, cardName(c)),
        otherName(c) !== cardName(c) ? h("p.muted", { lang: lang === "fr" ? "en" : "fr", translate: "no" }, otherName(c)) : null,
      ]),
      h("div.facts", [
        fact("Element", [h("i.fact-ico.sp-el-" + c.element), ELEMENT_NAME[c.element]]),
        fact("Rarity", [h("i.fact-ico.sp-gem-" + c.rarity), RARITY_NAME[c.rarity]]),
        fact("Health", String(c.hp)),
        fact("Gold per turn", String(c.gold_income)),
      ]),
      resist.length ? h("section.dlg-sec", [h("h3", "Resistances"), h("ul.ress", resist)]) : null,
      h("section.dlg-sec", [h("h3", "Abilities"), ...abilities]),
      passives.length ? h("section.dlg-sec", [h("h3", "Passives"), ...passives]) : null,
      talents.length ? h("section.dlg-sec", [h("h3", "Talents"), h("p.muted", "A deck may draft one talent per card."), ...talents]) : null,
      where,
    ]),
  ]);
  $(".dlg-scroll", dlg).replaceChildren(body);
  dlg.setAttribute("aria-labelledby", "dlg-name");

  // where the card plays: filled once the tier list is loaded
  loadTier().then((t) => {
    if (currentKey !== c.key) return;
    const decks = t.decks.filter((d) => !d.withheld && Array.isArray(d.cards) && d.cards.includes(c.id));
    if (!decks.length) { where.textContent = "It is not in any deck of the tier list."; return; }
    const best = decks[0];
    where.textContent = `It plays in ${plural(decks.length, "deck")} of the tier list; the highest is #${best.rank} (tier ${best.tier}).`;
  }).catch(() => { where.remove(); });
}

export function syncDialogOwned() {
  const b = document.querySelector("[data-own-dlg]");
  if (!b || !cardDlg().open) return;
  const on = isOwned(b.dataset.ownDlg);
  b.setAttribute("aria-pressed", String(on));
  b.querySelector(".on-off").textContent = on ? "Owned" : "Mark as owned";
}

// ---------------------------------------------------------------- About
function crossCheck(cc) {
  const found = cc.same_winner && cc.same_top4 ? "It found the same winner and the same top 4." : "Its results are in the data files.";
  return `The top decks were also cross-checked by a different kind of AI, an AlphaZero-style AI (neural networks plus tree search, trained by self-play). ${found} The two rankings of the ${cc.finalists} finalists agree closely (rank correlation ${cc.spearman_finals.toFixed(2)}).`;
}

function buildAbout() {
  const m = DB.meta, mm = m.methodology;
  const stageNames = { screen: "Quick screen", halving: "Halving", round_robin: "Round-robin", finals: "Finals" };
  const date = new Date(m.generated + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const faceDown = withheldLong(m.totals);
  return h("div.about", [
    h("h2#about-title", "About SPAM Meta"),
    h("p.lead", [h("b", "This site is AI-generated."), " Its data export and its analysis are AI-generated too."]),
    h("section", [
      h("h3", "What it is"),
      h("p", "A fan-made guide to the card game SPAM. The Tier list ranks the strongest decks of the current patch, the Codex shows every card, and My decks finds the best decks you can build from the cards you own."),
    ]),
    h("section", [
      h("h3", "How the rankings were made"),
      h("p", [h("b", "In short: "), "computer players played each deck against many others, again and again, in a copy of the game that runs offline. The decks that win the most are ranked highest."]),
      h("p", mm.headline),
      h("p", mm.settings),
      h("ol.stages", mm.pipeline.map((s) => h("li", [h("b", stageNames[s.stage] || s.stage), h("span", s.description)]))),
      h("p", `${fmtInt(m.totals.decks_measured)} decks were measured for patch ${m.patch}, over about ${((m.totals.patch_games || m.totals.simulated_games) / 1e6).toFixed(2)} million simulated matches.`),
      h("p", crossCheck(mm.cross_check)),
    ]),
    h("section", [
      h("h3", "How to read a win rate"),
      h("p", "A win rate only means something next to what it was measured against. The Tier list shows two numbers for every deck, measured the same way for all of them: against the 10 best decks and against the good decks of the round-robin. My decks also lists decks that were only tested lightly (halving and quick screen, with fewer games). Those rates cannot be compared with each other or with the Tier list numbers, which is why each deck says how it was tested."),
    ]),
    h("section", [
      h("h3", "Limits"),
      h("ul", mm.limits.map((t) => h("li", t))),
      faceDown ? h("p", faceDown) : null,
      h("p", "Rankings are talent-free: talents are a final add-on, and their results are added once they are measured."),
    ]),
    h("section", [
      h("h3", "Data"),
      h("p", `Patch ${m.patch}. Generated on ${date}.`),
    ]),
    h("p.legal", m.legal),
  ]);
}

// ---------------------------------------------------------------- collection code
const codeState = { parsed: null };

export function openCollection() {
  const dlg = $("#dlg-code");
  const code = encode(ownedKeys(), DB.cards.map((c) => c.key));
  $("#code-out", dlg).value = code;
  $("#code-in", dlg).value = "";
  const msg = $("#code-msg", dlg);
  msg.textContent = ""; msg.className = "msg";
  $("#code-replace", dlg).disabled = true;
  $("#code-add", dlg).disabled = true;
  $("#code-count", dlg).textContent = ownedCount() ? `${plural(ownedCount(), "card")} in this code.` : "Your collection is empty, so this code is empty too.";
  $("#code-store", dlg).hidden = canPersist();
  codeState.parsed = null;
  openModal(dlg);
}

function initCollectionDialog() {
  const dlg = $("#dlg-code");
  const all = () => DB.cards.map((c) => c.key);
  const inp = $("#code-in", dlg), msg = $("#code-msg", dlg);
  inp.addEventListener("input", () => {
    const text = inp.value.trim();
    codeState.parsed = null;
    $("#code-replace", dlg).disabled = true;
    $("#code-add", dlg).disabled = true;
    if (!text) { msg.textContent = ""; msg.className = "msg"; return; }
    const r = decode(text, all());
    if (r.error) { msg.textContent = r.error; msg.className = "msg err"; return; }
    codeState.parsed = r;
    msg.className = "msg ok";
    msg.textContent = `This code holds ${plural(r.keys.length, "card")}.` + (r.unknown ? ` ${plural(r.unknown, "card")} in it ${r.unknown === 1 ? "is" : "are"} not in the game data yet and will be ignored.` : "");
    $("#code-replace", dlg).disabled = false;
    $("#code-add", dlg).disabled = false;
  });
  $("#code-copy", dlg).addEventListener("click", async () => {
    const out = $("#code-out", dlg);
    const ok = await copyText(out.value, out);
    toast(ok ? "Code copied." : "Select the code and copy it by hand.");
  });
  $("#code-replace", dlg).addEventListener("click", () => {
    if (!codeState.parsed) return;
    const before = ownedKeys();
    const n = codeState.parsed.keys.length;
    replaceOwned(codeState.parsed.keys);
    closeModal(dlg);
    toast(`Collection replaced: ${plural(n, "card")} owned.`, { label: "Undo", run: () => replaceOwned(before) });
  });
  $("#code-add", dlg).addEventListener("click", () => {
    if (!codeState.parsed) return;
    const before = ownedKeys();
    replaceOwned([...before, ...codeState.parsed.keys]);
    closeModal(dlg);
    toast(`Added to your collection: ${plural(ownedCount(), "card")} owned now.`, { label: "Undo", run: () => replaceOwned(before) });
  });
}

export function initDialogs() {
  for (const d of document.querySelectorAll("dialog")) wire(d);
  $("#about-body").replaceChildren(buildAbout());
  initCollectionDialog();
}

export function openAbout() { openModal($("#dlg-about")); }
