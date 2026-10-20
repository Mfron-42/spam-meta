// The publish version of the site. Empty in the source, so the local preview loads every file by its plain URL;
// tools/publish_site.py writes a short content hash here in the published copy (and the same `?v=` on every static import,
// stylesheet and the data preload), so a visitor never runs old and new files together after a publish (SPEC.md, section 7).
export const VERSION = "7983aed0fb";

/** `url` with `extra` added to its query ("a.js" -> "a.js?x", "a.js?v=1" -> "a.js?v=1&x"). */
export const withQuery = (url, extra) => url + (url.includes("?") ? "&" : "?") + extra;

/** `url` stamped with the publish version, or unchanged in the source. */
export const versioned = (url) => (VERSION ? withQuery(url, "v=" + VERSION) : url);
