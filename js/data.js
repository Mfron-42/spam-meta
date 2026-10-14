// Loads the generated JSON once and builds the lookups every view needs.

import { fmtDate } from "./util.js";

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

export const DB = { cards: [], byId: new Map(), byKey: new Map(), meta: null, tier: null, decks: null, cardTiers: null };

/** cards.json and meta.json: needed by every view. */
export async function loadCore() {
  const [cards, meta] = await Promise.all([getJSON("data/cards.json"), getJSON("data/meta.json")]);
  DB.meta = meta;
  DB.patch = cards.patch;
  // set while some card values still come from an older game dump (docs/DATA.md, "Card data notices"): a notice code the
  // Codex prints as "notice.<code>", with the date of that dump
  DB.dataNotice = cards.data_notice || null;
  DB.dumpDate = cards.game_files_dumped || null;
  DB.cards = cards.cards;
  DB.byId = new Map(cards.cards.map((c) => [c.id, c]));
  DB.byKey = new Map(cards.cards.map((c) => [c.key, c]));
  DB.cards.forEach((c, i) => { c.order = i; });
  return DB;
}

/** The day of the game files the card values come from, "10 Oct" / "10 oct.", kept on one line. */
export const dumpDay = () => (DB.dumpDate ? fmtDate(DB.dumpDate, "short", false).replace(/ /g, " ") : "");

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
