/**
 * The Battle Simulator page (site/battle.html, js/battle.js): the code is battle-page.ts, shared with the Solver.
 * U41: a link to the page's old Solve mode (`?mode=solve`, `#solve` …) goes to the Solver page instead.
 */
import { solverRedirect } from "./battle-links.ts";
import { initBattlePage } from "./battle-page.ts";

const solver = solverRedirect(location.search, location.hash);
if (solver) location.replace(solver);
else initBattlePage("simulate");
