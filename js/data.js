// Loads the generated JSON once and builds the lookups every view needs.

const cache = new Map();

async function getJSON(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(path).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return r.json();
    }).catch((e) => { cache.delete(path); throw e; }));
  }
  return cache.get(path);
}

export const DB = { cards: [], byId: new Map(), byKey: new Map(), meta: null, tier: null, decks: null };

/** cards.json and meta.json: needed by every view. */
export async function loadCore() {
  const [cards, meta] = await Promise.all([getJSON("data/cards.json"), getJSON("data/meta.json")]);
  DB.meta = meta;
  DB.patch = cards.patch;
  // set while some card values still come from an older game dump (docs/DATA.md, "Card data notices"); the Codex prints it
  DB.dataNotice = cards.data_notice || null;
  DB.cards = cards.cards;
  DB.byId = new Map(cards.cards.map((c) => [c.id, c]));
  DB.byKey = new Map(cards.cards.map((c) => [c.key, c]));
  DB.cards.forEach((c, i) => { c.order = i; });
  return DB;
}

// Why a withheld deck is drawn face down (its `withheld_reason` is "legendary_paywall"). Plain wording, no figure: every
// number on the page comes from the data. tools/review_local.py quotes WITHHELD_SHORT by name.
export const WITHHELD_SHORT = "Its strength comes from legendary cards that are hard to obtain, so showing it would push players to pay to win. It stays hidden until a balance patch. Its win rates are real and are counted in the ranking.";

/** The About paragraph on the face-down decks, from meta.json totals.decks_withheld; null when no deck is face down. */
export function withheldLong(totals) {
  const n = (totals && totals.decks_withheld) || 0;
  if (!n) return null;
  const one = n === 1;
  return `${one ? "One deck" : `${n} decks`} of the Tier list ${one ? "is" : "are"} drawn face down: ${one ? "its" : "their"} win rates are shown, not ${one ? "its" : "their"} cards. ${one ? "Its" : "Their"} strength comes from legendary cards that are hard to obtain, so showing ${one ? "it" : "them"} would push players to pay to win; ${one ? "it stays" : "they stay"} hidden until a balance patch. ${one ? "Its" : "Their"} win rates are counted in every ranking and in the fields the other decks were measured against.`;
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
