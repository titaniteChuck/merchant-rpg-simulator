/**
 * Where a page gets the save from: the one already opened on any page of the site (kept in this browser by
 * save-store.ts), or a file the visitor picks or drops. Before a save is loaded the page shows its big drop zone.
 * Once one is loaded, the drop zone and the save help (saveHelp) are hidden and a small
 * "📜 PlayerData.txt ▾" button in the top bar takes over: its menu says when the save was opened and offers
 * Reload (same file, no dialog when the browser kept its handle), Choose another file and Forget. Dropping a file
 * anywhere on the page still works.
 *
 * U46: "Choose another file", "Open your own save" (example loaded) and "Open your save" (no save) open the "Open your
 * save" wizard (save.html#open, save-wizard.ts: PC or Mobile, then that platform's steps and "Pick a file"), not the
 * file dialog. initSaveSource returns the dialog and the example save for the wizard's buttons.
 *
 * U52: every load the visitor starts (a picked or dropped file, the example save, Reload, on any page) ends on the save
 * viewer's Overview (overviewAfterLoad); the save kept in this browser, restored when a page opens, stays where it is.
 *
 * Example save (U20): "Try with an example save" (a button under the drop zone, and an entry in the save menu) fetches
 * data/example-save.txt (an anonymised real save, web/scripts/make-example-save.ts) and loads it exactly like a picked
 * file named "Example save": same parsing, kept in IndexedDB for the other pages, Forget and choosing a file as usual.
 *
 * Expansions (U28): every loaded save goes to expansion-state.ts (noteSave), which guesses the expansions it owns; the
 * save menu holds the expansions items ("I own Frozen Tome", "I own Scribe", "Show expansion content"). With no
 * save loaded, the top bar's expansions button (expansion-menu.ts) holds them instead.
 *
 * R1: the save menu is groups split by separators and never taller than the window (it scrolls inside). U44: it is THE
 * Save dropdown (save-menu.ts; the main menu has no "Save ▾" any more): Save file, then the page's own entries such as
 * the save viewer's "Export (CSV)" (folded under their title), then the Save pages (the save viewer's Overview,
 * Heroes …), then Expansions. With no save loaded, expansion-menu.ts's "📜 Save ▾" dropdown stands in for it, with
 * "Open your save" and "Try the example save" as its file actions. The
 * "Where is my save file?" help is one component (saveHelp), put under the drop zone of every page that calls
 * initSaveSource (the pages' HTML has none of its own).
 *
 * U38, no flash of the picker: when this browser keeps a save, theme.js (in the head, before the first paint) sets
 * <html class="has-save"> from a localStorage hint (save-store.ts SAVE_FLAG) and style.css hides the drop zone, the
 * example row and the help from the start. setLoaded keeps the class in step: it goes once the page knows there is no
 * save (none stored, or the stored one can't be read), and the picker then shows.
 */
import { el } from "./dom.ts";
import { expansionsFold, mountExpansionChip, type SaveAction, unmountExpansionChip } from "./expansion-menu.ts";
import {
  fitMenu, foldGroup, menuHead, menuKeys, menuSep, openedAt, placeChip, refocusSaveChip, rememberSaveName, SAVE_PAGE,
  saveChipButton, savePagesGroup,
} from "./save-menu.ts";
import { noteSave } from "./expansion-state.ts";
import { chooseSave, bindSaveInput } from "./save-file.ts";
import { forgetSave, getHandle, getSave, HAS_SAVE_CLASS, putSave, rereadHandle, setSaveFlag, type SaveHandle } from "./save-store.ts";
import { helpTip } from "./wiki-help.ts";
import { OPEN_HREF } from "./save-wizard.ts";

/** U46: the Save dropdown's open entries lead to the "Open your save" wizard (save.html#open, save-wizard.ts). */
export function openWizard(): void {
  location.assign(OPEN_HREF);
}

/** U52: the save viewer's Overview, where every load the visitor starts ends. */
export const OVERVIEW_HREF = `${SAVE_PAGE}#overview`;

/**
 * Where a page goes after a load the visitor started (U52): on the save viewer, its #overview hash ({ hash }, null when
 * already there); on any other page, the save viewer's Overview ({ href }).
 */
export function overviewAfterLoad(path: string, hash: string): { hash: string } | { href: string } | null {
  if (!/(^|\/)save\.html$/i.test(path)) return { href: OVERVIEW_HREF };
  return hash.toLowerCase() === "#overview" ? null : { hash: "#overview" };
}

function goToOverview(): void {
  const to = overviewAfterLoad(location.pathname, location.hash);
  if (!to) return;
  if ("href" in to) location.assign(to.href);
  else location.hash = to.hash;
}

/** The no-save picker's "?" (R2 F19): what happens to the file, what the example is. */
export const PICKER_HELP = [
  "Your save file is read by your browser and kept there for the other pages. It is never uploaded.",
  "No save at hand? The example save is an anonymised one from a real game.",
  "On a computer you can also drop the file on the button.",
];

/** The example save, relative to the pages (site/data/example-save.txt). */
export const EXAMPLE_URL = "data/example-save.txt";
/** The name the example save is kept under (the save chip shows it). */
export const EXAMPLE_NAME = "Example save";

/** The example save's text; throws an Error with a readable message when it can't be fetched. */
export async function fetchExample(fetchImpl: typeof fetch = fetch, url = EXAMPLE_URL): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(url, { cache: "no-cache" });
  } catch {
    throw new Error("the example save could not be downloaded (are you offline?). Try again, or open your own save.");
  }
  if (!res.ok) throw new Error(`the example save could not be downloaded (HTTP ${res.status}). Try again, or open your own save.`);
  const text = await res.text();
  if (!text.trim()) throw new Error("the example save is empty. Try again, or open your own save.");
  return text;
}

export interface SaveSourceOptions {
  input: HTMLInputElement;
  drop: HTMLElement;
  /** Where "Reading…" and errors go. */
  status: HTMLElement;
  /** Parse and show a save; throw an Error with a readable message when it isn't one. */
  load: (text: string, name: string) => Promise<void>;
  /** Called after "Forget" (the page clears what it showed). */
  onForget?: () => void;
  /** More entries for the save menu (e.g. the save viewer's CSV exports), asked for each time the menu opens. */
  menuExtras?: () => { title: string; items: { label: string; hint: string; run: () => void }[] };
}

/**
 * THE "Where is my save file?" help (R1 F38): one folded section, the same on every page with a drop zone.
 * initSaveSource puts it under the drop zone and hides it once a save is loaded.
 */
export function saveHelp(): HTMLElement {
  const code = (t: string) => el("code", {}, t);
  return el("details", { class: "help save-help" },
    el("summary", {}, "Where is my save file?"),
    el("ul", {},
      el("li", {}, el("strong", {}, "Windows: "), code("%APPDATA%\\Retora\\Merchant\\Documents"),
        " (paste it in the file dialog's address bar). In Chrome or Edge you only do this once: the dialog then reopens in that folder."),
      el("li", {}, el("strong", {}, "Linux / Steam Deck (Proton): "),
        code("<Steam library>/steamapps/compatdata/346750/pfx/drive_c/users/steamuser/AppData/Roaming/Retora/Merchant/Documents")),
      el("li", {}, "Slot 1 is ", code("PlayerData.txt"), ", slots 2 to 5 are ", code("Slot2Data.txt"), " … ", code("Slot5Data.txt"),
        ". Backups (", code("…Backup1.txt"), ") work too."),
      el("li", {}, el("strong", {}, "Mac: "), code("~/Library/Application Support/Merchant/Documents")),
      el("li", {}, el("strong", {}, "Phone: "), "the game's Options › Bug Report mails the save; send it to yourself. ",
        el("a", { href: OPEN_HREF }, "Step by step"))));
}

function age(ms: number): string {
  const short = openedAt(ms);
  return new Date().toDateString() === new Date(ms).toDateString() ? `today ${short}` : short;
}

/** What a page can do with its save source: open the file dialog, load the example save (the wizard's buttons). */
export interface SaveSource { choose: () => void; useExample: () => Promise<void> }

export function initSaveSource(o: SaveSourceOptions): SaveSource {
  const showError = (msg: string) => o.status.replaceChildren(el("p", { class: "error", role: "alert" }, msg));
  // The drop zone, with the <details> that wraps it on some pages.
  const dropBlock = (o.drop.closest("details") as HTMLElement | null) ?? o.drop;
  let chip: HTMLElement | null = null;

  // R2 F19: the picker is two buttons side by side, "📂 Choose save file" (the drop <label>: a click opens the dialog,
  // a file dropped on it still loads) and "🧪 Example save" (outside the label, so it doesn't open the dialog); the
  // privacy and example sentences are in a "?" after them. The pages' own text in the label is replaced.
  o.drop.replaceChildren(o.input, el("span", { class: "drop-title" }, "📂 Choose save file"));
  o.drop.classList.add("drop-btn");
  o.drop.title = "Choose your save file (PlayerData.txt, Slot2Data.txt …), or drop it here";
  const exampleBtn = el("button", { type: "button", class: "secondary example-btn",
    title: "Load an anonymised real save, to try the tools without your own file" }, "🧪 Example save");
  const exampleRow = el("div", { class: "example-save save-picker" });
  o.drop.before(exampleRow);
  exampleRow.append(o.drop, exampleBtn, helpTip(PICKER_HELP, "the save file"));
  exampleBtn.addEventListener("click", () => useExample());
  // The one save help, under the example row (R1 F38).
  const help = saveHelp();
  exampleRow.after(help);

  /** The file actions of the Save dropdown with no save loaded. */
  const noSaveActions = (): SaveAction[] => [
    { label: "📂 Open your save", hint: "Where your save is, on PC or mobile, and pick it", run: openWizard },
    { label: "🧪 Try the example save", hint: "Load an anonymised real save, to try the tools without your own file", run: () => useExample() },
  ];

  const setLoaded = (loaded: boolean) => {
    document.documentElement.classList.toggle(HAS_SAVE_CLASS, loaded);
    dropBlock.hidden = loaded;
    exampleRow.hidden = loaded;
    help.hidden = loaded;
    if (!loaded) {
      rememberSaveName(null); // the other pages' chips and the drawer say "Save" again (R2-A F10, F11)
      chip?.remove();
      chip = null;
      mountExpansionChip(noSaveActions()); // no save: the Save dropdown without one (U44)
    }
  };

  /** The top-bar button and its menu. */
  const showChip = async (name: string, savedAt: number) => {
    const isExample = name === EXAMPLE_NAME;
    const canReread = Boolean(await getHandle());
    chip?.remove();
    const menu = el("div", { class: "save-menu", role: "menu", hidden: "" });
    const button = saveChipButton(name, `Save: ${name}, opened ${age(savedAt)}`);
    const close = () => {
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
    };
    // QA R2 F6: an action that stays on the page gives the focus back to the Save button (the new one once it settles).
    const item = (label: string, hint: string, f: () => unknown) => {
      const b = el("button", { type: "button", role: "menuitem", title: hint }, label);
      b.addEventListener("click", () => {
        close();
        refocusSaveChip(f());
      });
      return b;
    };
    // R1 F45 / U44: groups split by separators (the file, the page's exports folded, the Save pages, the expansions),
    // and the menu never taller than the window (it scrolls inside, fitMenu).
    const fileGroup = el("div", { class: "save-menu-group", role: "group", "aria-label": "Save file" },
      el("p", { class: "muted small save-menu-title" }, "Save file"),
      ...(isExample ? [] : [item("⟳ Reload", canReread ? "Read the same file again (after the game saved)" : "Choose the file again", reload)]),
      item(isExample ? "📂 Open your own save" : "📂 Choose another file", "Where your save is, on PC or mobile, and pick it", openWizard),
      ...(isExample ? [] : [item("🧪 Try the example save", "Replace it with an anonymised real save (your file stays on your disk)", useExample)]),
      item("🗑 Forget", "Remove the save from this browser", forget));
    const extras = el("div", { class: "save-menu-extras" });
    const extrasSep = menuSep();
    // R2-A F09: the head on one line ("PlayerData.txt · 11:45 PM"), the rest in its tooltip; the expansions folded.
    menu.append(
      menuHead(name, savedAt, isExample ? `${name}: an anonymised real save, opened ${age(savedAt)}` : `${name}: opened ${age(savedAt)}, kept in this browser only`),
      fileGroup, extrasSep, extras, menuSep(), savePagesGroup(close), menuSep(), expansionsFold(menu));
    /** The page's own entries (folded under their title), rebuilt on every opening: they follow what the page shows. */
    const fillExtras = () => {
      const x = o.menuExtras?.();
      const has = Boolean(x && x.items.length);
      extrasSep.hidden = !has;
      if (!x || !has) return void extras.replaceChildren();
      extras.replaceChildren(foldGroup(x.title, menu, ...x.items.map((e) => item(e.label, e.hint, e.run))));
    };
    button.addEventListener("click", () => {
      if (menu.hidden) fillExtras();
      menu.hidden = !menu.hidden;
      button.setAttribute("aria-expanded", String(!menu.hidden));
      if (!menu.hidden) {
        fitMenu(menu);
        (menu.querySelector("button") as HTMLButtonElement | null)?.focus();
      }
    });
    chip = el("div", { class: "save-chip" }, button, menu);
    document.addEventListener("click", (e) => {
      if (chip && !chip.contains(e.target as Node)) close();
    });
    // Escape closes; Up / Down move between the menu items (menu pattern), wrapping.
    menuKeys(chip, menu, button, close);
    unmountExpansionChip(); // the save menu holds the expansions toggles
    if (!placeChip(chip)) o.status.after(chip); // a page without the top bar
  };

  const loaded = async (name: string, savedAt: number) => {
    o.status.replaceChildren();
    setLoaded(true);
    rememberSaveName({ name, savedAt }); // for the plain chips and the drawer of every page (R2-A F10, F11)
    await showChip(name, savedAt);
  };

  const accept = async (file: File, handle?: SaveHandle) => {
    o.status.replaceChildren(el("p", { class: "muted" }, "Reading…"));
    try {
      const text = await file.text();
      await o.load(text, file.name);
      void noteSave(text, file.name);
      const savedAt = Date.now();
      await putSave({ name: file.name, text, savedAt }, handle);
      await loaded(file.name, savedAt);
      goToOverview(); // U52: not for the stored save (restored below, without moving)
    } catch (e) {
      showError(`Could not read ${file.name}: ${e instanceof Error ? e.message : e}`);
    }
  };

  /** Fetch the example save and load it as if the visitor had picked a file named "Example save". */
  async function useExample(): Promise<void> {
    o.status.replaceChildren(el("p", { class: "muted" }, "Downloading the example save…"));
    exampleBtn.disabled = true;
    try {
      const text = await fetchExample();
      await accept(new File([text], EXAMPLE_NAME, { type: "text/plain" }));
    } catch (e) {
      showError(`Could not load the example save: ${e instanceof Error ? e.message : e}`);
    } finally {
      exampleBtn.disabled = false;
    }
  }

  const reload = async () => {
    const f = await rereadHandle();
    if (f) await accept(f, (await getHandle()) ?? undefined);
    else chooseSave(pickerOpts);
  };

  const forget = async () => {
    await forgetSave();
    void noteSave(null);
    setLoaded(false);
    o.status.replaceChildren(el("p", { class: "muted small" }, "The save was removed from this browser."));
    o.onForget?.();
  };

  const pickerOpts = { input: o.input, drop: o.drop, onFile: accept, onError: showError };
  bindSaveInput(pickerOpts);

  // Once a save is loaded the drop zone is hidden: dropping a file anywhere on the page still loads it.
  document.addEventListener("dragover", (e) => {
    if (chip && e.dataTransfer?.types.includes("Files")) e.preventDefault();
  });
  document.addEventListener("drop", (e) => {
    if (!chip || o.drop.contains(e.target as Node)) return;
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    e.preventDefault();
    accept(f);
  });

  // The save opened on any page before: use it right away. U38: theme.js already hid the picker when it expects one
  // (<html class="has-save">); without a save the expansions button stands in for the save menu from the start.
  const expected = document.documentElement.classList.contains(HAS_SAVE_CLASS);
  if (!expected) mountExpansionChip(noSaveActions());
  getSave().then(async (s) => {
    setSaveFlag(Boolean(s)); // a save kept before U38, or site data cleared in part: the hint follows the store
    if (!s) {
      if (expected) setLoaded(false);
      return void noteSave(null);
    }
    try {
      await o.load(s.text, s.name);
      void noteSave(s.text, s.name);
      await loaded(s.name, s.savedAt);
    } catch (e) {
      setLoaded(false); // the picker back, to choose a file that works
      showError(`The stored save ${s.name} could not be read: ${e instanceof Error ? e.message : e}`);
    }
  });
  return { choose: () => void chooseSave(pickerOpts), useExample };
}
