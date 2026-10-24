// Loads the generated JSON once and builds the lookups every view needs. Every request carries the publish version
// (version.js), so a new publish never mixes with data an earlier visit cached.

import { versioned, withQuery } from "./version.js?v=47b1396378";

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

export const DB = { cards: [], byId: new Map(), byKey: new Map(), meta: null, keywords: null, ranking: null, tier: null, decks: null, cardTiers: null, cardCounters: null };

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
 * The deck ranking of the game patch (tools/export_ranking.py): the decks by score and the fastest winners, each deck with its
 * card objects (`cs`, board order) and each card's talent (`tls`, the talent object, or null). Loaded at boot with the core
 * while the Deck tier list shows it (main.js), so the footer, About and the card view can quote it.
 */
export async function loadRanking() {
  if (!DB.ranking) {
    const r = await getJSON("data/ranking.json");
    for (const list of [r.by_score, r.by_speed]) {
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
 * The deck table of the ranking run (ranking-decks.json, tools/export_ranking.py): every deck it measured, best first (the
 * furthest stage reached, then the score there), each row with its card objects (board order) and their talents, its stage
 * (`level`: 3 final, 2 race, 1 screen), its score and games at that stage (`rate`, `games`), and every stage it played
 * (`stages`: screen {rate, games, kept}, race {rate, games, kept}, final {rank, score, ci95, games}, round robin place). My
 * decks and the Deck builder read it.
 */
export async function loadDecks() {
  if (!DB.decks) {
    const [d] = await Promise.all([getJSON("data/ranking-decks.json"), loadRanking().catch(() => null)]);    // the AI's name for the intro
    const cards = d.cards.map((id) => DB.byId.get(id));
    const st = (v, f) => (v ? f(v) : null);
    DB.decks = {
      raw: d,
      stages: d.stages,
      rows: d.rows.map((r, i) => {
        const cs = r[0].map((x) => cards[x]);
        const stages = {
          screen: st(r[3], ([rate, games, kept]) => ({ rate, games, kept: !!kept })),
          race: st(r[4], ([rate, games, kept]) => ({ rate, games, kept: !!kept })),
          final: st(r[5], ([rank, score, ci95, games]) => ({ rank, score, ci95, games })),
          rt: r[6] || null,
        };
        const at = r[2] === 3 ? { rate: stages.final.score, games: stages.final.games } : r[2] === 2 ? stages.race : stages.screen;
        return { i, cards: cs, talents: r[1], tls: cs.map((c, k) => (c && c.talents[r[1][k]]) || null), level: r[2], rate: at.rate,
          games: at.games, stages };
      }).filter((r) => r.cards.every(Boolean)),
    };
  }
  return DB.decks;
}
