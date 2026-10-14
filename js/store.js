// The visitor's state: owned cards and card-name language. Persisted in localStorage only; every access is wrapped in
// try/catch and the site keeps working in memory when storage is missing (private window, blocked site data).

const K_OWNED = "spam-meta:owned:v1";
const K_NAMES = "spam-meta:names:v1";

let persistent = true;   // false once any storage access has failed

function read(key) {
  try { return localStorage.getItem(key); } catch (e) { persistent = false; return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); return true; } catch (e) { persistent = false; return false; }
}

const listeners = { owned: new Set(), lang: new Set() };
export const on = (type, fn) => { listeners[type].add(fn); return () => listeners[type].delete(fn); };
const emit = (type, detail) => listeners[type].forEach((fn) => fn(detail));

// ---- owned cards (a Set of card keys)
let owned = new Set();
try {
  const raw = read(K_OWNED);
  if (raw) {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) owned = new Set(arr.filter((k) => typeof k === "string"));
  }
} catch (e) { owned = new Set(); }

function saveOwned() { write(K_OWNED, JSON.stringify([...owned])); }

export const isOwned = (key) => owned.has(key);
export const ownedCount = () => owned.size;
export const ownedKeys = () => new Set(owned);
export const canPersist = () => persistent;

/** Drop keys that no longer exist in the data (a card removed by a later patch). */
export function prune(validKeys) {
  const before = owned.size;
  owned = new Set([...owned].filter((k) => validKeys.has(k)));
  if (owned.size !== before) saveOwned();
}

export function setOwned(key, value) {
  if (owned.has(key) === value) return;
  if (value) owned.add(key); else owned.delete(key);
  saveOwned();
  emit("owned", { keys: [key] });
}

/** Replace the whole set (import, undo). */
export function replaceOwned(keys) {
  const next = new Set(keys);
  const changed = [...owned].filter((k) => !next.has(k)).concat([...next].filter((k) => !owned.has(k)));
  owned = next;
  saveOwned();
  emit("owned", { keys: changed });
}

export function addMany(keys) { replaceOwned([...owned, ...keys]); }
export function removeMany(keys) { const gone = new Set(keys); replaceOwned([...owned].filter((k) => !gone.has(k))); }
export function clearOwned() { replaceOwned([]); }

// other tabs of the same browser
window.addEventListener("storage", (e) => {
  if (e.key !== K_OWNED) return;
  try {
    const arr = JSON.parse(e.newValue || "[]");
    owned = new Set(Array.isArray(arr) ? arr : []);
    emit("owned", { keys: [] });
  } catch (err) { /* ignore a malformed value */ }
});

// ---- card-name language
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
  document.documentElement.dataset.names = next;
  emit("lang", next);
}
document.documentElement.dataset.names = lang;
