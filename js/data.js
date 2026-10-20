// Loads the generated JSON once and builds the lookups every view needs. Every request carries the publish version
// (version.js), so a new publish never mixes with data an earlier visit cached.

import { versioned, withQuery } from "./version.js?v=cd9f51d7c4";

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

export const DB = { cards: [], byId: new Map(), byKey: new Map(), meta: null, keywords: null, tier: null, decks: null, cardTiers: null, cardCounters: null };

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

/** The 4,868 measured decks, with card indices resolved to card objects. */
export async function loadDecks() {
  if (!DB.decks) {
    const d = await getJSON("data/decks.json");
    const cards = d.cards.map((id) => DB.byId.get(id));
    DB.decks = {
      raw: d,
      levels: d.levels,
      rows: d.rows.map((r, i) => ({
        i, cards: r[0].map((x) => cards[x]), level: r[1], rate: r[2], games: r[3], score: r[4], rounds: r[5], tierRank: r[6],
      })),
    };
  }
  return DB.decks;
}
