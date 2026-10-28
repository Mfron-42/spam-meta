// The one way to list measured decks (the current ranking's deck table, deck-table.json), shared by My decks and the Deck
// builder, and the deck parts the Deck tier list reuses: a deck's card with its talent under it, a deck's facts (My decks and the
// Deck builder: its rating on the full AI's scale, or the fast estimate's state, and a listed deck's speed), a listed deck's two
// figures with their notes (the Deck tier list, listFigures), the owned badge; and, for the two deck table views,
// the two scales as two groups (scaleGroups: never sorted together), the paging and their footer Method sub-section. Rows arrive
// in the table's order (the full AI's scale by its rating, then the fast AI's picks), so a filter that keeps it keeps the ranking.

import { h, icon, dec, fmtInt } from "./util.js?v=aa3c01bc6a";
import { DB } from "./data.js?v=aa3c01bc6a";
import { getLang, isOwned, ownedCount } from "./store.js?v=aa3c01bc6a";
import { gameCard, chip, cardName, L } from "./cards.js?v=aa3c01bc6a";
import { t, tx } from "./i18n.js?v=aa3c01bc6a";
import { tipButton } from "./cardtext.js?v=aa3c01bc6a";
import { introLine, provBanner, isMatchupTalent, matchupMark } from "./patch.js?v=aa3c01bc6a";

// ---------------------------------------------------------------- a deck's card
/**
 * One card of a deck: the game card (list size, or full) and, under it, the talent the deck plays with it (the client's talent
 * glyph and its name, its game text as the title). The card opens the card view on that talent. `miss`: a card search dims it.
 */
export function deckSlot(c, talent, { full = false, miss = false } = {}) {
  const tl = c.talents[talent] || null;
  const card = gameCard(c, { size: full ? "full" : "list", eager: full });
  card.dataset.talent = String(talent);      // the card view opens on this talent (main.js, dialogs.js)
  return h("div.slot", { class: miss ? "miss" : null }, [
    card,
    tl ? h("p.slot-tl", { title: L(tl, "description") }, [h("i.ab-talent", { "aria-hidden": "true" }),
      h("span", { lang: getLang() }, [h("span.sr", t("rk.talentSr")), h("span", { translate: "no" }, L(tl, "name"))]),
      // a talent picked against the opponent (the element shields): the quiet mark after its name, the rule as its name
      isMatchupTalent(c, talent) ? matchupMark() : null]) : null,
  ]);
}

// ---------------------------------------------------------------- a deck's facts (My decks and the Deck builder)
/** A signed whole number of Elo points: "492", "−120". */
const elo = (x) => (x < 0 ? "−" : "") + fmtInt(Math.abs(x));

/**
 * A deck's facts on My decks and the Deck builder (DESIGN.md "Deck facts"). A deck of the full AI's scale: its rating, big, in
 * Elo points (0 = the benchmark decks' average) with its 95% margin and the AI that rated it, a word that explains itself (its
 * place among the decks of that scale in the tooltip); a deck of the Deck tier list adds its speed there, small (the Deck tier
 * list's own component, no list active; its Elo is the rating already on the line). A deck only the fast AI looked at: the quiet state "Fast estimate" with
 * that AI, no number (its scale is not the rating's). `r` is a deck table row.
 */
export function deckFacts(r) {
  const D = DB.decks.raw, P = D.pilots;
  if (r.scale === "fast") {
    const F = D.scales.fast;
    const [b, d] = tipButton("button.dt-fig.fast", t("dt.fast"), [h("span.fig-k", t("dt.fast")), h("span.fig-ai", { translate: "no" }, P.fast)],
      t("dt.fastTip", { ai: P.fast, of: fmtInt(F.of), per: F.per_family }));
    return h("div.dfacts", h("div.fig-line", [b, d]));
  }
  const [b, d] = tipButton("button.dt-fig", t("dt.rating"), [h("span.fig-k", t("dt.rating")), h("b.stat-v", elo(r.elo)),
    h("span.fig-pm", "±" + fmtInt(r.elo95)), h("span.fig-ai", { translate: "no" }, P.full)],
  t("dt.ratingTip", { ai: P.full, v: elo(r.elo), pm: fmtInt(r.elo95), place: fmtInt(r.place), n: fmtInt(D.scales.full.rows) }));
  return h("div.dfacts", [h("div.fig-line", [b, d]), r.listed ? listFigures(r.listed, null, ["speed"]) : null]);
}

// ---------------------------------------------------------------- a listed deck's two figures (the Deck tier list)
// the Deck tier list's two lists, in its switch's order (the owner, 2026-10-27: Elo first and by default, then Speed); a listed
// deck's figures follow the same names and the same order
export const LISTS = ["elo", "speed"];

/**
 * The figures of a listed deck (DESIGN.md "Deck figures"): Elo and Speed, named like the two lists and always in their order, so
 * they line up on every card; the active list's figure big, the other small. Each is a button that explains itself with the
 * page's tooltip (cardtext.js tipButton) on hover, keyboard focus or a tap, in plain sentences that are also its description for
 * a screen reader. Under the Elo, one quiet note: the AI whose games it rests on, or "not in the 64" for a deck of the speed list
 * outside the Elo list (its Elo is still its own, on the same scale). A figure the deck lacks keeps its slot with a quiet state
 * ("too few wins") and its tooltip says why. A figure's tooltip ends with the deck's likely place in that list when it spans
 * more than one place, so a tap or the keyboard reach what the row's "likely #1-9" (a mouse title) says. `d`: a deck of
 * deck-lists.json; `active`: the list shown; `keys`: the figures drawn (My decks and the Deck builder draw the speed only: the Elo
 * is their rating line).
 */
export function listFigures(d, active, keys = LISTS) {
  const R = DB.lists, P = R.pilots;
  const big = (k) => k === active;
  const ai = (name) => h("span", { translate: "no" }, name);   // an AI's name is a code token: never machine-translated
  const fig = {};
  const likely = (k, x) => (x && x.range && x.range[0] !== x.range[1] ? " " + t("rk.likelyTip." + k, { lo: x.range[0], hi: x.range[1] }) : "");
  const e = d.elo, out = e.rank == null;
  // the note: on the Elo list, the AI whose games the figure rests on (the list's pilot, named on its figure); on the Speed list,
  // the deck's place in the Elo list, the fact a reader of that list needs ("#3 by Elo", or "not in the 64")
  const note = out ? t("fx.eloOut", { n: R.elo.rows.length }) : active === "speed" ? t("fx.eloRank", { rank: e.rank }) : ai(P.full);
  fig.elo = { value: elo(e.value), unit: "±" + fmtInt(e.pm), note,
    desc: t("fx.elo", { v: elo(e.value), pm: fmtInt(e.pm), games: fmtInt(e.games), ai: P.full }) +
      (out ? " " + t("fx.eloOutTip", { n: R.elo.rows.length }) : likely("elo", e)) };
  const ws = d.speed;
  // the speed's 95% margin (the Elo's coverage: a "±" means one thing on the site), one decimal rounded up (never narrower than
  // measured: "±0.1" for 0.08)
  const pm = ws.pm != null ? dec(Math.ceil(ws.pm * 10 - 1e-9) / 10, 1) : null;
  fig.speed = ws.rounds != null
    // one decimal, big or small: whole rounds would put 11.03 and 11.84 a round apart and 11.84 and 12.15 on one value; its margin
    // after it, as the Elo's
    ? { value: dec(ws.rounds, 1), unit: (pm ? "±" + pm + " " : "") + t("fx.rounds"),
      desc: t("fx.speed", { v: dec(ws.rounds, 1), pm: pm || "", wins: fmtInt(ws.wins) }) + likely("speed", ws) }
    : { state: t("fx.fewWins"), desc: t("fx.speedFew", { wins: fmtInt(ws.wins || 0) }) };
  // a toolbar: the role that tells a screen reader the arrow keys move between its buttons
  const row = h("div.rfig", { role: "toolbar", "aria-label": t("fx.aria"), onkeydown: rove, onfocusin: keep }, keys.map((k, i) => {
    const f = fig[k], name = t("rk.list." + k);
    const value = f.state ? h("span.rf-s", f.state) : [h("b.rf-v", f.value), f.unit ? h("span.rf-u", " " + f.unit) : null];
    // the name and the value read as one ("Elo, 467 ±56"), the note after them, then the description
    const [b, dsc] = tipButton("button.rf" + (big(k) ? ".act" : "") + (f.state ? ".none" : ""), name,
      [h("span.rf-k", name), h("span.sr", t("ui.comma")), h("span.rf-n", value),
        h("span.rf-x", f.note ? [h("span.sr", t("ui.comma")), f.note] : null)], f.desc);
    // one tab stop per deck, the active list's figure (else the first); the arrow keys move between its figures
    if (active ? k !== active : i) b.tabIndex = -1;
    return [b, dsc];
  }));
  return row;
}

/** A figure focused by a click or a tap becomes the deck's tab stop (roving focus). */
function keep(e) {
  const b = e.target.closest(".rf");
  if (b) e.currentTarget.querySelectorAll(".rf").forEach((x) => { x.tabIndex = x === b ? 0 : -1; });
}

/** The arrow keys inside a deck's figures (roving focus, as the Card tier list's icons): Left / Right, Home / End. */
function rove(e) {
  const bs = [...e.currentTarget.querySelectorAll(".rf")], i = bs.indexOf(document.activeElement);
  const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: bs.length - 1 }[e.key];
  if (i < 0 || to == null || to < 0 || to >= bs.length) return;
  e.preventDefault();
  bs.forEach((b, k) => { b.tabIndex = k === to ? 0 : -1; });
  bs[to].focus();
}

/**
 * The head of a view that lists the deck table (My decks, the Deck builder): the title and, while the run is not final, the
 * one-line temporary banner. Everything that explains (what the table holds, the two scales, the rating, the fast estimate)
 * goes to the view's footer Method sub-section (patch.js introLine; owner, 2026-10-24).
 */
export function tableHead(key, h1, lede) {
  const D = DB.decks.raw, P = D.pilots, F = D.scales.fast;
  const method = [
    D.final ? null : h("p", [...tx("rk.mWhy")]),
    t("dt.mTable", { full: fmtInt(D.scales.full.rows), ai: P.full, fast: fmtInt(F.rows), fai: P.fast }),
    h("p", tx("dt.mRating", { ai: P.full })),
    h("p", tx("dt.mFast", { ai: P.fast, of: fmtInt(F.of), per: F.per_family })),
    // the cards left out ("Without these cards", search.js outRow) filter the table: no figure is re-measured without them
    h("p", t("out.mMethod")),
    D.not_listed ? t("md.mNotListed", { n: D.not_listed }) : null,
    DB.lists && DB.lists.matchup_talents ? matchupLine() : null,
  ];
  return h("div.vhead", [
    h("h1", h1),
    D.final ? null : provBanner(key),
    ...introLine(key, h("p", lede), { method, patch: D.patch, link: D.final }),
  ]);
}

/**
 * A list of deck table rows as its two scales (the lab lead, 2026-10-27: "never sort mixed scales together"): the decks of the
 * full AI's scale, then, under their own heading and line, the decks only the fast AI looked at, each group paged, its places
 * counted from 1. `rowOf(item)` gives an item's row; `mk(item, i)` draws it. Items keep their order inside a group.
 */
export function scaleGroups(items, rowOf, mk, page) {
  const full = items.filter((x) => rowOf(x).scale === "full"), fast = items.filter((x) => rowOf(x).scale === "fast");
  return [
    full.length ? paged(full, mk, page) : null,
    fast.length ? h("div.rk-cut.dt-cut", [h("h3", t("dt.fastH")), h("p", t("dt.fastP", { ai: DB.decks.raw.pilots.fast }))]) : null,
    fast.length ? paged(fast, mk, page) : null,
  ].filter(Boolean);
}

// ---------------------------------------------------------------- owned badge
/**
 * Paints the owned badge of a deck ("You own 3/4 · missing <chips>", or "Ready to play" when all four are owned) into
 * `el`, hidden while the collection is empty. Returns how many of the cards are owned.
 */
export function paintOwned(el, cards) {
  const any = ownedCount() > 0;
  const own = cards.filter((c) => isOwned(c.key));
  const miss = cards.filter((c) => !isOwned(c.key));
  el.hidden = !any;
  el.className = "obadge" + (own.length === 4 ? " full" : "");
  if (!any) { el.replaceChildren(); return own.length; }
  if (own.length === 4) el.replaceChildren(icon("check"), h("span", t("tl.allOwned")));
  else if (miss.length <= 2) el.replaceChildren(h("span", t("tl.youOwn", { n: own.length })), h("span.muted", ` · ${t("tl.missing")}`), ...miss.map(chip));
  else el.replaceChildren(h("span", t("tl.youOwn", { n: own.length })));
  return own.length;
}

// ---------------------------------------------------------------- one deck row
/**
 * A measured deck as a row, in the Deck tier list's pattern (DESIGN.md "Deck row"): on the ground, a head (its place in this
 * list, the four card names hidden after it for screen readers, a quiet word, the owned badge pushed right), then its four game
 * cards with their talents and its facts (`deckFacts`: its last completed phase and win rate, big, then its other phases,
 * small), a "Missing:" / "Without:" line. On one column the facts come before the cards. `cards` reorders the
 * cards for display (a deck is a set; the talents follow their cards); `hits` (the cards a card search found) or `dim` (the card
 * the visitor lacks) dims the other cards.
 */
export function deckRow(r, rankLabel, { cards = r.cards, tag = null, note = null, badge = null, hits = null, dim = null } = {}) {
  const talentOf = (c) => r.talents[r.cards.indexOf(c)];
  const miss = (c) => (hits ? !hits.includes(c) : !!(dim && dim.includes(c)));
  return h("article.deck", [
    // the list position (not a rank: the deck's place in the Deck tier list, when it has one, is beside its figures)
    h("div.deck-head", [h("h3.rk", [rankLabel, h("span.sr", " " + r.cards.map(cardName).join(", "))]), tag, badge]),
    h("div.deck-body", [
      h("div.deck-cards", cards.map((c) => deckSlot(c, talentOf(c), { miss: miss(c) }))),
      h("div.deck-facts", [deckFacts(r), note]),
    ]),
  ]);
}

/** The "Missing: <chip>" line of a deck one card away. */
export const missingLine = (c) => h("p.dr-miss", [h("span.muted", t("md.missing") + " "), chip(c)]);

/** A list that shows `page` rows and appends the next `page` on demand, without re-rendering what is already there. */
export function paged(items, mk, page = 8) {
  let shown = Math.min(page, items.length);
  const list = h("div.rk-list.decklist", items.slice(0, shown).map((it, i) => mk(it, i)));
  const count = h("p.muted", { "aria-live": "polite" });
  const btn = h("button.btn.soft", { type: "button", onclick: () => {
    const next = Math.min(items.length, shown + page);
    const fresh = items.slice(shown, next).map((it, i) => mk(it, shown + i));
    list.append(...fresh);
    shown = next;
    paint();
    const first = fresh[0] && fresh[0].querySelector("button");
    if (first) first.focus({ preventScroll: true });
  } });
  const paint = () => {
    count.textContent = t("md.showing", { a: shown, b: items.length });
    btn.textContent = t("md.showMore", { n: Math.min(page, items.length - shown) });
    btn.hidden = shown >= items.length;
  };
  paint();
  return h("div", [list, items.length > page ? h("div.more", [count, btn]) : null]);
}

/** The footer's line on the talents picked against the opponent, led by their mark (the Deck tier list's, My decks', the Deck
 * builder's Method). */
export function matchupLine() {
  return h("p.mu-line", [matchupMark({ label: "tl.matchupTag" }), " ", t("rk.mMatchup")]);
}
