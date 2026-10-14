// Collection code: the owned cards as a short text that can be copied, pasted and shared. No server involved.
//
//   SPAM1-XXXX-XXXX-...-XXXX
//
// "SPAM1" is the format version. The payload is a bitmap read as Crockford base32: bit i (least significant bit of the
// first byte first) is 1 when the card at position i of ORDER_V1 is owned, then two check characters (a 10-bit checksum
// of the bitmap). ORDER_V1 is frozen: cards released later are appended after it, in key order, so a code stays valid
// when the card list grows. Spaces, line breaks, lower case and the hyphens are ignored when reading; I and L read as 1,
// O reads as 0.

export const ORDER_V1 = [
  "aeltheria_mere_primordiale", "aidan", "aldrin_gorakar", "aleera_mange_cauchemars", "amber", "ameru",
  "apprenti_evocateur", "apprentie_de_la_mort", "aristocrate_nebulaire", "artisan_des_heures", "ashtarae_lycaria",
  "astry", "baleine_farceuse", "blancheur_aquatique", "blaze", "bleu_mange_cailloux", "catimimi", "catixy",
  "cerf_des_couleurs_funebres", "chimere_brasse_chair", "chouette_polychrome", "codex_des_maux_ancestraux",
  "codex_des_sorts_lumineux", "commando_gerz", "cornu_mythologique", "crapaud_des_etoiles",
  "croqueur_de_fruits_verdoyant", "devoreur_de_faune", "dragon_ciel", "dragon_de_la_cite_infernale",
  "dragonnet_des_lumieres", "dragosaure_celeste", "eclat_du_renard_blanc", "ephial", "epine_medusine",
  "esprit_de_la_faune", "esprit_eau", "esprit_feu", "esprit_lumiere", "esprit_nature", "esprit_ombre",
  "esprit_terre", "faerylia", "felin_errant", "fleur_de_vie", "fleurmarine", "frost_glacier", "gabriel",
  "gardien_vert", "gazpoison_flottant", "girafe_florale", "godlur", "guerrier_des_neiges", "heraldesse_serpentine",
  "hibernatus", "hippocampe_nimbe", "ignea", "keria", "lame_de_la_foret", "lames_en_peine", "lapin_plume",
  "le_compagnon_des_esprits", "le_heraut_des_cendres", "le_transporteur_sauvage", "leo", "lepine_damour",
  "leviathan_des_cieux", "lil_des_montagnes", "linventeur", "lisa_la_dragonniere", "logidrake_lignatus",
  "loutre_intrepide", "lueur_despoir", "luminaire_abyssal", "lums", "maitre_amphibian", "maitre_thronebeur",
  "maitresse_des_teintes", "melodie_des_divinites", "moxilys_la_fredonneuse", "murmures_du_corail_noir",
  "naissance_daldrin", "nakyel", "neilla", "oisillons_de_midas", "paguroniyx", "panthere_imaginaire",
  "poulpe_parleur", "princesse_meridia", "prisonniere_de_la_machine", "protecteur_des_ruines", "pyro", "raffteru",
  "regent_des_abysses", "rob_laventurier", "roi_des_flammes_ardentes", "roi_eau", "roi_feu", "roi_lumiere",
  "roi_nature", "roi_ombre", "roi_terre", "rongeur_nuageux", "sanglier_dore", "sbire_des_flammes",
  "scorch_les_lezards_ignes", "shado_fleau_abyssal", "shinobi_eclairant", "soigneuse_astrale_des_bois",
  "sorciere_pyrokinetique", "souris_des_bles", "souverain_des_chutes_dether", "souverain_des_flammes",
  "spectre_canin", "squall_emissaire_des_cauchemars", "sylvan_protecteur_de_la_verdure", "tisseuse_de_mots",
  "veilleur_nocturne", "verdelune", "vivy", "vladislaus", "voyageur_des_cretes", "wibs_lenflamme",
  "wyrm_des_dunes_cornu", "yotaru_gardefeuille", "zayd", "zombie_floral"
];

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PREFIX = "SPAM1";

/** Full ordering for the cards currently in the data: the frozen list, then any newcomer by key. */
export function orderFor(keys) {
  const known = new Set(ORDER_V1);
  const extra = [...keys].filter((k) => !known.has(k)).sort();
  return [...ORDER_V1, ...extra];
}

function checksum(bytes) {
  let s = 0;
  for (let i = 0; i < bytes.length; i++) s = (s + (i + 1) * bytes[i]) % 1024;
  return ALPHABET[s >> 5] + ALPHABET[s & 31];
}

function toBase32(bytes) {
  let out = "", bits = 0, acc = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHABET[(acc >> (bits - 5)) & 31]; bits -= 5; }
    acc &= (1 << bits) - 1;
  }
  if (bits) out += ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}

function fromBase32(text) {
  const bytes = []; let bits = 0, acc = 0;
  for (const ch of text) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 5) | v; bits += 5;
    if (bits >= 8) { bytes.push((acc >> (bits - 8)) & 255); bits -= 8; acc &= (1 << bits) - 1; }
  }
  return Uint8Array.from(bytes);
}

/** owned: iterable of card keys; allKeys: every key of the current data. Returns the code string. */
export function encode(owned, allKeys) {
  const order = orderFor(allKeys);
  const index = new Map(order.map((k, i) => [k, i]));
  const bytes = new Uint8Array(Math.ceil(order.length / 8));
  for (const k of owned) {
    const i = index.get(k);
    if (i != null) bytes[i >> 3] |= 1 << (i & 7);
  }
  const body = toBase32(bytes) + checksum(bytes);
  return PREFIX + "-" + body.match(/.{1,4}/g).join("-");
}

/** Returns {keys:[...], unknown:n} or {error: code}, code one of "empty", "prefix", "short", "char", "check" (the page
 * words them, i18n "code.err.<code>"). allKeys: every key of the current data. */
export function decode(text, allKeys) {
  const t = String(text).toUpperCase().replace(/[\s-]+/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  if (!t) return { error: "empty" };
  if (!t.startsWith(PREFIX)) return { error: "prefix" };
  const body = t.slice(PREFIX.length);
  if (body.length < 3) return { error: "short" };
  const data = body.slice(0, -2), check = body.slice(-2);
  const bytes = fromBase32(data);
  if (!bytes) return { error: "char" };
  const usable = bytes.subarray(0, Math.floor(data.length * 5 / 8));
  if (checksum(usable) !== check) return { error: "check" };
  const order = orderFor(allKeys);
  const keys = [];
  let unknown = 0;
  for (let i = 0; i < usable.length * 8; i++) {
    if (usable[i >> 3] & (1 << (i & 7))) {
      if (i < order.length) keys.push(order[i]); else unknown++;
    }
  }
  return { keys, unknown };
}
