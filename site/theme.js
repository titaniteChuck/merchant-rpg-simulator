/*
 * Theme switch (U16), on every page, before the page paints: the game's dark brown by default, parchment (light) when
 * chosen with the ☀ / ☾ button this script adds to the top bar. The choice is kept in this browser (localStorage).
 */
(() => {
  const root = document.documentElement;
  let theme = "dark";
  try {
    if (localStorage.getItem("theme") === "light") theme = "light";
  } catch { /* storage blocked: dark */ }
  root.dataset.theme = theme;
  addEventListener("DOMContentLoaded", () => {
    const bar = document.querySelector(".topbar");
    if (!bar) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "theme-btn";
    const sync = () => {
      const light = root.dataset.theme === "light";
      b.textContent = light ? "☾" : "☀";
      b.title = light ? "Switch to the dark theme" : "Switch to the parchment (light) theme";
      b.setAttribute("aria-label", b.title);
    };
    b.addEventListener("click", () => {
      root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
      try {
        localStorage.setItem("theme", root.dataset.theme);
      } catch { /* not remembered */ }
      sync();
    });
    sync();
    bar.insertBefore(b, bar.querySelector(".gh"));
  });

  /*
   * U20: on a phone the top bar's links, the wiki's section chips and the tabs scroll sideways on one line
   * (style.css). Keep the current page / section / tab in view: on load, and whenever it changes (the wiki and the
   * tabs set it from script). Only that row scrolls, never the page; a row that fits is left alone.
   */
  const ROWS = ".topnav, .wiki-nav, .tabs";
  const CURRENT = '[aria-current="page"], [aria-selected="true"]';
  const reveal = (row) => {
    const cur = row.querySelector(CURRENT);
    if (!cur || row.scrollWidth <= row.clientWidth + 1) return;
    const r = row.getBoundingClientRect(), c = cur.getBoundingClientRect();
    if (c.left >= r.left + 16 && c.right <= r.right - 16) return; // already in view (clear of the fades)
    row.scrollLeft += c.left - r.left - (r.width - c.width) / 2;
  };
  addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(ROWS).forEach(reveal);
    new MutationObserver((list) => {
      const rows = new Set();
      for (const m of list) {
        if (m.type === "attributes") {
          const row = m.target.closest?.(ROWS);
          if (row) rows.add(row);
        } else {
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (n.matches(ROWS)) rows.add(n);
            n.querySelectorAll(ROWS).forEach((x) => rows.add(x));
          }
        }
      }
      if (rows.size) requestAnimationFrame(() => rows.forEach(reveal));
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-current", "aria-selected"] });
  });
})();
