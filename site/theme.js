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
})();
