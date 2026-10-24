// The overlay release record (site/data/overlay-release.json): the one file that flips the overlay page between its
// coming-soon state and its download state. This module is the single source of truth for what a valid record is: the page
// loads it through loadRelease(), and tools/check_overlay_release.mjs runs validateRelease() on the file before a publish
// (SPEC.md, section 5, "Overlay release record").

import { versioned } from "../../js/version.js?v=a34256d2f5";

// "setup": the per-user installer (the recommended download); "zip": the portable package (no installation).
export const SETUP_KINDS = ["setup", "zip"];
const SHA256 = /^[0-9a-f]{64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const FIELDS = ["available", "version", "released", "release_url", "notes_url", "assets"];
const ASSET_FIELDS = ["kind", "name", "url", "size_bytes", "sha256"];

const isHttps = (s) => {
  if (typeof s !== "string") return false;
  try { return new URL(s).protocol === "https:"; } catch { return false; }
};
const isDay = (s) => {
  if (typeof s !== "string" || !DAY.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
/** The last path segment of a link, decoded ("" when it is not a link). */
export function fileOfUrl(u) {
  try { return decodeURIComponent(new URL(u).pathname.split("/").pop() || ""); } catch { return ""; }
}

/**
 * Every problem with a release record, as plain English lines ([] means valid).
 * Coming soon (`available` false): the other fields may stay empty, but every asset that is listed must still be well formed
 * (a kind that is known, a sha256 of 64 lower-case hex characters). Available (`available` true): the version, the date and
 * the links are filled and well formed, and there is at least one asset, each with its file name, an https link whose last
 * segment is that file name, a positive size and a sha256, so the page never draws a download it cannot stand behind.
 */
export function validateRelease(r) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return ["the record is not an object"];
  const bad = [];
  for (const k of FIELDS) if (!(k in r)) bad.push(`${k}: missing`);
  if (typeof r.available !== "boolean") bad.push("available: must be true or false");
  if ("assets" in r && !Array.isArray(r.assets)) bad.push("assets: must be a list");
  const assets = Array.isArray(r.assets) ? r.assets : [];
  const seen = new Set();
  assets.forEach((a, i) => {
    const at = `assets[${i}]`;
    if (!a || typeof a !== "object" || Array.isArray(a)) { bad.push(`${at}: not an object`); return; }
    for (const k of ASSET_FIELDS) if (!(k in a)) bad.push(`${at}.${k}: missing`);
    if (!SETUP_KINDS.includes(a.kind)) bad.push(`${at}.kind: must be one of ${SETUP_KINDS.join(", ")}`);
    else if (seen.has(a.kind)) bad.push(`${at}.kind: ${a.kind} is listed twice`);
    else seen.add(a.kind);
    if (a.sha256 && !SHA256.test(a.sha256)) bad.push(`${at}.sha256: must be 64 lower-case hex characters`);
    if (r.available === true) {
      if (typeof a.name !== "string" || !a.name || /[\\/]/.test(a.name)) bad.push(`${at}.name: empty or not a bare file name`);
      if (!isHttps(a.url)) bad.push(`${at}.url: empty or not an https link`);
      else if (a.url && fileOfUrl(a.url) !== a.name) bad.push(`${at}.url: its file name is not ${a.name}`);
      if (!Number.isSafeInteger(a.size_bytes) || a.size_bytes <= 0) bad.push(`${at}.size_bytes: must be a positive whole number`);
      if (!a.sha256) bad.push(`${at}.sha256: empty`);
    }
  });
  if (r.available !== true) return bad;

  if (typeof r.version !== "string" || !/^\d+(\.\d+){1,3}([-+][\w.]+)?$/.test(r.version)) bad.push("version: empty or not like 1.2.3");
  if (!isDay(r.released)) bad.push("released: must be a real date, YYYY-MM-DD");
  for (const k of ["release_url", "notes_url"]) if (!isHttps(r[k])) bad.push(`${k}: empty or not an https link`);
  if (!assets.length) bad.push("assets: an available release lists at least one");
  return bad;
}

/** The asset the page offers first: the installer when the release has one, else the portable ZIP. */
export function recommended(r) {
  const list = (r && r.assets) || [];
  return list.find((a) => a.kind === "setup") || list.find((a) => a.kind === "zip") || null;
}
/** The other package, offered under the main button (only when the release has both). */
export function alternative(r) {
  const main = recommended(r);
  return ((r && r.assets) || []).find((a) => a !== main) || null;
}

/** "12.4 MB", "980 KB" (joined by a no-break space): the size as a person reads it (binary steps, one decimal from MB up). */
export function formatSize(bytes, lang = "en") {
  const KB = 1024, MB = KB * 1024, GB = MB * 1024;
  const num = (n, digits) => n.toLocaleString(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (bytes >= GB) return `${num(bytes / GB, 2)} ${lang === "fr" ? "Go" : "GB"}`;
  if (bytes >= MB) return `${num(bytes / MB, 1)} ${lang === "fr" ? "Mo" : "MB"}`;
  return `${num(Math.max(1, Math.round(bytes / KB)), 0)} ${lang === "fr" ? "Ko" : "KB"}`;
}

/** The record's date in the visitor's language ("2026-10-18" -> "18 October 2026"). */
export function formatDay(day, lang = "en") {
  return new Date(day + "T00:00:00Z").toLocaleDateString(lang, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * Loads the record. Resolves { state: "ready", release } for a valid record that says available, { state: "soon" } for a valid
 * record that says not yet, and { state: "error" } for anything else (file missing, not JSON, invalid, network down): the page
 * then draws the coming-soon state, never a download.
 */
export async function loadRelease() {
  try {
    const res = await fetch(versioned(new URL("../../data/overlay-release.json", import.meta.url).href), { cache: "no-cache" });
    if (!res.ok) return { state: "error" };
    const release = await res.json();
    if (validateRelease(release).length) return { state: "error" };
    return release.available ? { state: "ready", release } : { state: "soon" };
  } catch {
    return { state: "error" };
  }
}
