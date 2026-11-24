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
   * U29: the language of the game's names and descriptions (items, skills, enemies, classes…); the site's own words
   * stay English. Remembered in this browser (localStorage "lang"); on a first visit, the browser's language when the
   * game has it, else English. The choice goes on <html data-lang> before the page's script runs (web/src/ui/language.ts
   * loads data/i18n/<code>.json and re-renders on the "merchant:language" event). The menu lists
   * data/i18n/index.json's languages by their native names; LANGS (the codes, for the first-visit guess) must match it
   * (web/test/languages.test.ts).
   */
  const LANGS = ["en", "fr", "de", "es", "br", "ru", "it", "pl"];
  let stored = null;
  try {
    stored = localStorage.getItem("lang");
  } catch { /* storage blocked: not remembered */ }
  const fromBrowser = () => {
    for (const l of navigator.languages || [navigator.language || "en"]) {
      const tag = String(l).toLowerCase();
      const code = tag.startsWith("pt") ? "br" : tag.split("-")[0];
      if (LANGS.includes(code)) return code;
    }
    return "en";
  };
  root.dataset.lang = stored && LANGS.includes(stored) ? stored : fromBrowser();
  addEventListener("DOMContentLoaded", () => {
    const bar = document.querySelector(".topbar");
    if (!bar) return;
    const wrap = document.createElement("div");
    wrap.className = "lang-pick";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lang-btn";
    b.setAttribute("aria-haspopup", "menu");
    b.setAttribute("aria-expanded", "false");
    const menu = document.createElement("div");
    menu.className = "lang-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Language of game names");
    menu.hidden = true;
    wrap.append(b, menu);
    let langs = null; // index.json's languages, once fetched
    const nameOf = (code) => langs?.find((l) => l.code === code)?.native ?? code.toUpperCase();
    const sync = () => {
      const code = root.dataset.lang || "en";
      b.textContent = `${code.toUpperCase()} ▾`;
      b.title = `Game names in ${nameOf(code)} (the site's own text stays English). Change the language`;
      b.setAttribute("aria-label", `Language of game names: ${nameOf(code)}`);
    };
    const close = (focus) => {
      menu.hidden = true;
      b.setAttribute("aria-expanded", "false");
      if (focus) b.focus();
    };
    const pick = (code) => {
      close(true);
      if (code === root.dataset.lang) return;
      root.dataset.lang = code;
      try {
        localStorage.setItem("lang", code);
      } catch { /* not remembered */ }
      sync();
      dispatchEvent(new CustomEvent("merchant:language", { detail: code }));
    };
    const items = () => [...menu.querySelectorAll("button")];
    const fill = () => {
      const list = langs ?? LANGS.map((code) => ({ code, native: code.toUpperCase() }));
      menu.replaceChildren(...[
        Object.assign(document.createElement("p"), { className: "lang-menu-title", textContent: "Game names in" }),
        ...list.map((l) => {
          const o = document.createElement("button");
          o.type = "button";
          o.setAttribute("role", "menuitemradio");
          o.setAttribute("aria-checked", String(l.code === root.dataset.lang));
          o.lang = l.bcp47 || l.code;
          const n = document.createElement("span");
          n.textContent = l.native;
          const c = document.createElement("span");
          c.className = "lang-code";
          c.textContent = l.code.toUpperCase();
          o.append(n, c);
          o.addEventListener("click", () => pick(l.code));
          return o;
        }),
        Object.assign(document.createElement("p"), { className: "lang-menu-note", textContent: "The site's own text stays English." }),
      ]);
    };
    const open = async () => {
      if (!langs) {
        try {
          const r = await fetch("data/i18n/index.json");
          if (r.ok) langs = (await r.json()).languages.filter((l) => LANGS.includes(l.code));
        } catch { /* the codes alone */ }
        sync();
      }
      fill();
      menu.hidden = false;
      b.setAttribute("aria-expanded", "true");
      (items().find((x) => x.getAttribute("aria-checked") === "true") ?? items()[0])?.focus();
    };
    b.addEventListener("click", () => (menu.hidden ? open() : close(false)));
    document.addEventListener("click", (e) => {
      if (!wrap.contains(e.target)) close(false);
    });
    wrap.addEventListener("keydown", (e) => {
      if (menu.hidden) return;
      const list = items(), i = list.indexOf(document.activeElement);
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        list[(i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        list[e.key === "Home" ? 0 : list.length - 1]?.focus();
      }
    });
    sync();
    // Right after the theme button (which sits before the save / expansion chips and GitHub).
    const theme = bar.querySelector(".theme-btn");
    if (theme) theme.after(wrap);
    else bar.insertBefore(wrap, bar.querySelector(".gh"));
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
