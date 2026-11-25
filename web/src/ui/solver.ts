/**
 * The Battle Solver page (site/solver.html, js/solver.js, U41): the code is battle-page.ts, shared with the Simulator;
 * the solver's panel and results are battle-search.ts.
 */
// Review F14: the menus (nav.ts) are bundled into this page, first, so nav and the page share one copy of the
// shared modules (dom, names, language, tooltip, Save menu); the page loads no separate js/nav.js.
import "./nav.ts";
import { initBattlePage } from "./battle-page.ts";

initBattlePage("solve");
