// Keeping the collection: the visitor's cards live in this browser only (store.js), so the page says so where cards are
// marked and makes the backup one click away. Two pieces, both on the Codex and My decks (SPEC.md section 4):
//   - keepLine(): "Saved in this browser only." with a "Copy my code" button, or, when this browser cannot keep what we
//     write, a plain warning with the same button;
//   - inAppNotice(): a dismissible notice shown inside an app's in-app browser (Discord, Instagram, TikTok...), whose
//     storage is separate from the visitor's real browser and is sometimes wiped.

import { h, icon, reducedMotion } from "./util.js?v=24015c5634";
import { DB } from "./data.js?v=24015c5634";
import { ownedKeys, ownedCount, canPersist } from "./store.js?v=24015c5634";
import { encode } from "./code.js?v=24015c5634";
import { toast, openCollection } from "./dialogs.js?v=24015c5634";
import { t } from "./i18n.js?v=24015c5634";

// ---------------------------------------------------------------- Copy my code
/** Copies the collection code. When the browser refuses the clipboard, the collection dialog opens with the code shown. */
async function copyCode(btn) {
  const code = encode(ownedKeys(), DB.cards.map((c) => c.key));
  try { await navigator.clipboard.writeText(code); } catch (e) { openCollection(); return; }
  btn.classList.add("done");
  btn.querySelector(".copy-ico").replaceChildren(icon("check", 14));
  toast(t("keep.copied"));
  clearTimeout(btn._timer);
  btn._timer = setTimeout(() => { btn.classList.remove("done"); btn.querySelector(".copy-ico").replaceChildren(icon("copy", 14)); }, 2400);
}

/** The copy button: both labels share one grid cell, so the width never changes when "Copied" shows. */
function copyButton() {
  // no aria-label: the visible label is the accessible name (label in name); the hidden "Copied" is out of the tree
  const btn = h("button.copy.keep-copy", { type: "button" }, [
    h("span.copy-ico", { "aria-hidden": "true" }, icon("copy", 14)),
    h("span.copy-ls", [h("span.copy-l.l-rest", t("keep.copy")), h("span.copy-l.l-done", { "aria-hidden": "true" }, t("ui.copied"))]),
  ]);
  btn.addEventListener("click", () => copyCode(btn));
  return btn;
}

/**
 * kind "saved": the line "Saved in this browser only." + Copy my code (shown by the caller once a card is owned).
 * kind "nostore": the warning that this browser will not keep the cards + Copy my code (disabled while nothing is owned).
 * Returns {el, paint()}; paint() follows the owned count.
 */
export function keepLine(kind) {
  const btn = copyButton();
  const el = h("div.keep." + kind, [
    h("p.keep-t", [icon("info"), h("span", t(kind === "saved" ? "keep.saved" : "cx.noStore"))]),
    btn,
  ]);
  const paint = () => {
    const none = !ownedCount();
    btn.disabled = none;
    btn.title = none ? t("keep.copyOff") : t("keep.copyTitle");
  };
  paint();
  return { el, paint };
}

/** Shows the no-storage warning only while this browser does not keep what we write. */
export function paintNoStore(line) {
  line.el.hidden = canPersist();
  line.paint();
}

// ---------------------------------------------------------------- in-app browser notice
// The webviews of common apps, from their user agent. A plain browser never carries these tokens; "; wv)" is the generic
// Android WebView marker.
const IN_APP = /\b(?:Discord|Instagram|FBAN|FBAV|FB_IAB|TikTok|musical_ly|BytedanceWebview|Snapchat|Line\/|Twitter)|; wv\)/i;
export const inAppBrowser = (ua = navigator.userAgent || "") => IN_APP.test(ua);

const K_HIDDEN = "spam-meta:inapp-hidden";        // sessionStorage: the visitor hid the notice for this visit
let hidden = (() => { try { return sessionStorage.getItem(K_HIDDEN) === "1"; } catch (e) { return false; } })();

function hide() {
  hidden = true;
  try { sessionStorage.setItem(K_HIDDEN, "1"); } catch (e) { /* kept in memory for this page */ }
  // fade (200 ms), then the row closes (280 ms), then the node goes: nothing below jumps
  for (const wrap of document.querySelectorAll(".inapp")) {
    const view = wrap.closest(".view");
    if (view && wrap.contains(document.activeElement)) view.focus({ preventScroll: true });
    wrap.classList.add("out");
    const close = () => { wrap.classList.remove("open"); setTimeout(() => wrap.remove(), reducedMotion() ? 0 : 280); };
    setTimeout(close, reducedMotion() ? 0 : 200);
  }
}

/** The notice, or null outside an in-app browser or once hidden this visit. */
export function inAppNotice() {
  if (hidden || !inAppBrowser()) return null;
  return h("div.inapp.collapse.open", h("div.collapse-in", h("div.inapp-in", { role: "note" }, [
    icon("info"),
    h("p", t("keep.inApp")),
    h("button.icon-btn", { type: "button", "aria-label": t("keep.hide"), title: t("keep.hide"), onclick: hide }, icon("close", 20)),
  ])));
}
