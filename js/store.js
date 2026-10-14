// The visitor's state: owned cards and the page language (the whole UI and the card names and texts). Persisted in localStorage only; every access is wrapped in
// try/catch and the site keeps working in memory when storage is missing (private window, blocked site data).

const K_OWNED = "spam-meta:owned:v1";
const K_NAMES = "spam-meta:names:v1";
const K_PERSIST = "spam-meta:persist-asked:v1";   // navigator.storage.persist() is asked once per browser

// Whether this browser keeps what we write: probed once at load (a browser can read but refuse to write, e.g. a zero
// quota), then it follows the last write, so a passing failure does not mark this visit as unsaved for good.
let persistent = (() => {
  try { const k = "spam-meta:probe"; localStorage.setItem(k, "1"); localStorage.removeItem(k); return true; } catch (e) { return false; }
})();

function read(key) {
  try { return localStorage.getItem(key); } catch (e) { persistent = false; return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); persistent = true; return true; } catch (e) { persistent = false; return false; }
}

const listeners = { owned: new Set(), lang: new Set() };
export const on = (type, fn) => { listeners[type].add(fn); return () => listeners[type].delete(fn); };
const emit = (type, detail) => listeners[type].forEach((fn) => fn(detail));

// ---- owned cards (a Set of card keys)
// `owned` holds every key read from storage. A key the current card data does not know (a card missing from one export,
// or a stale cached cards.json after a patch) is never deleted: it stays in storage untouched and is only left out of
// what the page counts and shows, so it comes back as soon as the data holds that card again.
const strings = (arr) => (Array.isArray(arr) ? arr.filter((k) => typeof k === "string") : []);
let owned = new Set();
let known = null;        // the card keys of the current data, set at boot by setKnown()
try {
  const raw = read(K_OWNED);
  if (raw) owned = new Set(strings(JSON.parse(raw)));
} catch (e) { owned = new Set(); }

function saveOwned() { write(K_OWNED, JSON.stringify([...owned])); askPersist(); }
const visible = () => (known ? [...owned].filter((k) => known.has(k)) : [...owned]);
const unseen = () => (known ? [...owned].filter((k) => !known.has(k)) : []);

export const isOwned = (key) => owned.has(key);
export const ownedCount = () => visible().length;
export const ownedKeys = () => new Set(visible());
export const canPersist = () => persistent;

/** The card keys of the current data. Keys outside it are kept in storage but not counted or shown. */
export function setKnown(validKeys) {
  known = new Set(validKeys);
  askPersist();
}

export function setOwned(key, value) {
  if (owned.has(key) === value) return;
  if (value) owned.add(key); else owned.delete(key);
  saveOwned();
  emit("owned", { keys: [key] });
}

/** Replace the cards the page knows (import, undo, clear); keys of cards the data does not hold stay as they are. */
export function replaceOwned(keys) {
  const next = new Set([...keys, ...unseen()]);
  const changed = [...owned].filter((k) => !next.has(k)).concat([...next].filter((k) => !owned.has(k)));
  owned = next;
  saveOwned();
  emit("owned", { keys: changed });
}

export function addMany(keys) { replaceOwned([...visible(), ...keys]); }

// Ask the browser not to evict the site's storage, once per browser, the first time the visitor owns a card. Never
// awaited and its answer is never shown: Chromium decides silently, Firefox may ask the visitor, Safari 17+ supports it.
let asked = false;
function askPersist() {
  if (asked || !persistent || !known || !ownedCount()) return;
  asked = true;
  try {
    const sm = navigator.storage;
    if (!sm || typeof sm.persist !== "function" || read(K_PERSIST)) return;
    write(K_PERSIST, "1");
    Promise.resolve(typeof sm.persisted === "function" ? sm.persisted() : false)
      .then((done) => (done ? true : sm.persist()))
      .catch(() => {});
  } catch (e) { /* not supported: nothing to do */ }
}

// other tabs of the same browser
window.addEventListener("storage", (e) => {
  if (e.key !== K_OWNED) return;
  try {
    owned = new Set(strings(JSON.parse(e.newValue || "[]")));
    emit("owned", { keys: [] });
  } catch (err) { /* ignore a malformed value */ }
});

// ---- page language: what the visitor chose, else the browser's first language (fr* -> French, anything else -> English).
// Kept under the key the card-name toggle has always used, so a choice made before the full translation still applies.
function guessLang() {
  const first = (navigator.languages && navigator.languages[0]) || navigator.language || "en";
  return /^fr\b/i.test(first) ? "fr" : "en";
}
let lang = read(K_NAMES);
if (lang !== "fr" && lang !== "en") lang = guessLang();

export const getLang = () => lang;
export function setLang(next) {
  if (next !== "fr" && next !== "en") return;
  lang = next;
  write(K_NAMES, next);
  paintLang();
  emit("lang", next);
}
function paintLang() {
  document.documentElement.lang = lang;
  document.documentElement.dataset.names = lang;
}
paintLang();
