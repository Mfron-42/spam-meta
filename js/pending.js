// The placeholder of a ranking view while its rankings are being computed for the game patch (patch.js CARD_RANKINGS_SHOWN; owner,
// 2026-10-21: "Patch 1.26 : calcul en cours"). The Deck tier list and the Card tier list draw it instead of their old numbers:
// the view's heading, one quiet status line in a sunken strip (a fact, not a control), and the way to the Codex, the view that
// is live. It loads no ranking data.

import { h, icon } from "./util.js?v=57c092aad8";
import { t } from "./i18n.js?v=57c092aad8";
import { on } from "./store.js?v=57c092aad8";
import { GAME_PATCH } from "./patch.js?v=57c092aad8";

const HEADINGS = { "view-tiers": "tl.h1", "view-card-tiers": "ct.h1" };

export function mount(el) {
  const draw = () => el.replaceChildren(
    h("div.vhead", h("h1", t(HEADINGS[el.id] || "tl.h1"))),
    h("div.pending", [
      h("p.pending-s", [icon("clock", 24), h("span", t("pend.status", { patch: GAME_PATCH.patch }))]),
      h("a.btn.primary", { href: "#codex", "data-goto": "codex" }, [t("pend.go"), icon("arrow")]),
    ]),
  );
  draw();
  on("lang", draw);
}
