// Loads the generated JSON once and builds the lookups every view needs. Every request carries the publish version
// (version.js), so a new publish never mixes with data an earlier visit cached.

import { versioned, withQuery } from "./version.js?v=e550ac9b69";

const cache = new Map();
// data paths are resolved from this module, not from the page, so a page in a sub-folder (site/overlay/) reads the same files
const ROOT = new URL("../", import.meta.url);

async function getJSON(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(versioned(new URL(path, ROOT).href)).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return r.json();
    }).catch((e) => { cache.delete(path); throw e; }));
  }
  return cache.get(path);
}

export const DB = { cards: [], byId: new Map(), byKey: new Map(), meta: null, keywords: null, ranking: null, lists: null, tier: null, decks: null, cardTiers: null, cardCounters: null, facets: null };

/**
 * cards.json and meta.json: needed by every view; keywords.json (the card texts' keyword chips and tooltips, cardtext.js)
 * with them, but a failed keywords request only leaves the texts without chips.
 */
export async function loadCore() {
  const [cards, meta, keywords] = await Promise.all([getJSON("data/cards.json"), getJSON("data/meta.json"),
    getJSON("data/keywords.json").catch((e) => { console.error(e); return null; })]);
  DB.meta = meta;
  DB.keywords = keywords;
  // the patch of the card data; the rankings (meta.json `patch`) can be one patch behind it (patch.js, the patch notice)
  DB.patch = cards.patch;
  DB.cards = cards.cards;
  DB.byId = new Map(cards.cards.map((c) => [c.id, c]));
  DB.byKey = new Map(cards.cards.map((c) => [c.key, c]));
  DB.cards.forEach((c, i) => { c.order = i; });
  return DB;
}

/**
 * The Deck tier list's two lists of the game patch (tools/export_deck_lists.py, docs/DATA.md "deck-lists.json"): every listed
 * deck once, with its card objects (`cs`, board order), each card's talent (`tls`), its variants' card objects, and each list
 * (`elo`, `speed`) as its decks in order (`list.rows`). Loaded at boot with the core while the Deck tier list shows it
 * (main.js), so the footer, About, the card view and the talents' matchup marks can quote it. The tox are named through
 * facets.json (loadFacets), which the Deck tier list loads beside it.
 */
export async function loadLists() {
  if (!DB.lists) {
    const r = await getJSON("data/deck-lists.json");
    const cs = (ids) => ids.map((id) => DB.byId.get(id));
    for (const d of r.decks) {
      d.cs = cs(d.cards);
      d.tls = d.cs.map((c, i) => (c && c.talents[d.talents[i]]) || null);
      for (const v of d.variants) v.cs = cs(v.cards);
    }
    for (const k of ["elo", "speed"]) r[k].rows = r[k].decks.map((i) => r.decks[i]);
    DB.lists = r;
  }
  return DB.lists;
}

/**
 * The stage ranking run (tools/export_ranking.py; My decks' and the Deck builder's until 2026-10-27, deck-table.json since):
 * its Final round robin (`by_score`), its race and speed lists and its AIs (`pilots`), each deck with its card objects (`cs`,
 * board order) and each card's talent (`tls`, the talent object, or null). Loaded by the Card tier list, whose Tournament view
 * comes from that run (its matchup talents are the fallback of patch.js isMatchupTalent).
 */
export async function loadRanking() {
  if (!DB.ranking) {
    const r = await getJSON("data/ranking.json");
    for (const list of [r.by_score, r.by_race, r.by_speed].filter(Boolean)) {
      for (const d of list.decks) {
        d.cs = d.cards.map((id) => DB.byId.get(id));
        d.tls = d.cs.map((c, i) => (c && c.talents[d.talents[i]]) || null);
      }
    }
    DB.ranking = r;
  }
  return DB.ranking;
}

/** A deck is a set of 4 cards (board order is ignored): its sorted card ids join tierlist.json and decks.json. */
export const deckKey = (ids) => [...ids].sort().join("|");

export async function loadTier() {
  if (!DB.tier) {
    const t = await getJSON("data/tierlist.json");
    DB.tier = t;
    // a withheld stub has no cards, so it joins nothing
    DB.tierBySet = new Map(t.decks.filter((d) => !d.withheld && Array.isArray(d.cards)).map((d) => [deckKey(d.cards), d]));
  }
  return DB.tier;
}

/**
 * The card search facets (tools/export_facets.py): what each card hits, generates, is related to, holds as tox and targets.
 * A failed request resolves to null, so a view still filters on what cards.json holds (element, rarity, numbers, patch).
 */
let fcLoad = null;
export function loadFacets() {
  if (!fcLoad) {
    fcLoad = getJSON("data/facets.json").then((d) => { DB.facets = d; return d; })
      .catch((e) => { console.error(e); fcLoad = null; return null; });
  }
  return fcLoad;
}

/** The card tier list (tools/export_cardtiers.py): each record gets its card object; an unknown id is dropped. */
export async function loadCardTiers() {
  if (!DB.cardTiers) {
    const t = await getJSON("data/cardtiers.json");
    t.cards = t.cards.map((r) => ({ ...r, card: DB.byId.get(r.id) })).filter((r) => r.card);
    DB.cardTiers = t;
  }
  return DB.cardTiers;
}

/**
 * The per-card "Strong with" / "Strong against" / "Weak against" lists (tools/export_cardcounters.py), loaded when a card
 * dialog first needs them. A failed request is retried once after 1.2 s with a query, so the browser does not hand back
 * the failed fetch; a second failure rejects, and the next call starts afresh.
 */
let ccLoad = null;
export function loadCardCounters() {
  const path = "data/cardcounters.json";
  if (!ccLoad) {
    ccLoad = getJSON(path)
      .catch(() => new Promise((r) => setTimeout(r, 1200)).then(() => getJSON(withQuery(path, "retry=" + Date.now()))))
      .then((d) => { DB.cardCounters = d; return d; })
      .catch((e) => { ccLoad = null; throw e; });
  }
  return ccLoad;
}

/**
 * The deck table of the current ranking (deck-table.json, tools/export_deck_lists.py; docs/DATA.md "deck-table.json"): every deck
 * the run rated, on two scales that are never mixed: the full AI's (`scale` "full", best first by its rating, `elo` and `elo95`
 * in Elo points, 0 = the benchmark decks' average), then the fast AI's first-sort picks (`scale` "fast", in their own order, no
 * number). Each row has its card objects (board order), their talents, its place in its scale (`place`, 1-based) and, for a
 * deck of the Deck tier list, that deck (`listed`, from deck-lists.json, loaded with it). My decks and the Deck builder read it.
 */
export async function loadDecks() {
  if (!DB.decks) {
    const [d, L] = await Promise.all([getJSON("data/deck-table.json"), loadLists()]);
    const cards = d.cards.map((id) => DB.byId.get(id));
    const place = { full: 0, fast: 0 };
    DB.decks = {
      raw: d,
      rows: d.rows.map(([cs0, talents, scale, elo, elo95, list], i) => {
        const cs = cs0.map((x) => cards[x]);
        const sc = scale ? "full" : "fast";
        return { i, cards: cs, talents, tls: cs.map((c, k) => (c && c.talents[talents[k]]) || null), scale: sc,
          place: ++place[sc], elo, elo95, listed: list >= 0 ? L.decks[list] : null };
      }).filter((r) => r.cards.every(Boolean)),
    };
  }
  return DB.decks;
}
