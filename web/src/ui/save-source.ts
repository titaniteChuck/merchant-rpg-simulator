/**
 * Where a page gets the save from: the one already opened on any page of the site (kept in this browser by
 * save-store.ts), or a file the visitor picks or drops. Before a save is loaded the page shows its big drop zone.
 * Once one is loaded, the drop zone and the save help (elements marked data-save-help) are hidden and a small
 * "📜 PlayerData.txt ▾" button in the top bar takes over: its menu says when the save was opened and offers
 * Reload (same file, no dialog when the browser kept its handle), Choose another file and Forget. Dropping a file
 * anywhere on the page still works.
 */
import { el } from "./dom.ts";
import { chooseSave, bindSaveInput } from "./save-file.ts";
import { forgetSave, getHandle, getSave, putSave, rereadHandle, type SaveHandle } from "./save-store.ts";

export interface SaveSourceOptions {
  input: HTMLInputElement;
  drop: HTMLElement;
  /** Where "Reading…" and errors go. */
  status: HTMLElement;
  /** Parse and show a save; throw an Error with a readable message when it isn't one. */
  load: (text: string, name: string) => Promise<void>;
  /** Called after "Forget" (the page clears what it showed). */
  onForget?: () => void;
}

function age(ms: number): string {
  const d = new Date(ms);
  const sameDay = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `today ${time}` : `${d.toLocaleDateString()} ${time}`;
}

export function initSaveSource(o: SaveSourceOptions): void {
  const showError = (msg: string) => o.status.replaceChildren(el("p", { class: "error", role: "alert" }, msg));
  // The drop zone, with the <details> that wraps it on some pages, and the page's save help.
  const dropBlock = (o.drop.closest("details") as HTMLElement | null) ?? o.drop;
  const helps = () => [...document.querySelectorAll<HTMLElement>("[data-save-help]")];
  let chip: HTMLElement | null = null;

  const setLoaded = (loaded: boolean) => {
    dropBlock.hidden = loaded;
    for (const h of helps()) h.hidden = loaded;
    if (!loaded) {
      chip?.remove();
      chip = null;
    }
  };

  /** The top-bar button and its menu. */
  const showChip = async (name: string, savedAt: number) => {
    const canReread = Boolean(await getHandle());
    chip?.remove();
    const menu = el("div", { class: "save-menu", role: "menu", hidden: "" });
    const button = el("button", { type: "button", class: "save-chip-btn", "aria-haspopup": "menu", "aria-expanded": "false",
      title: `Save: ${name}, opened ${age(savedAt)}` }, "📜 ", el("span", { class: "save-chip-name" }, name), " ▾");
    const close = () => {
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
    };
    const item = (label: string, hint: string, f: () => void) => {
      const b = el("button", { type: "button", role: "menuitem", title: hint }, label);
      b.addEventListener("click", () => {
        close();
        f();
      });
      return b;
    };
    menu.append(
      el("p", { class: "muted small" }, el("strong", {}, name), el("br"), `opened ${age(savedAt)} · kept in this browser only`),
      item("⟳ Reload", canReread ? "Read the same file again (after the game saved)" : "Choose the file again", reload),
      item("📂 Choose another file", "Open a different save", () => chooseSave(pickerOpts)),
      item("🗑 Forget", "Remove the save from this browser", forget));
    button.addEventListener("click", () => {
      menu.hidden = !menu.hidden;
      button.setAttribute("aria-expanded", String(!menu.hidden));
      if (!menu.hidden) (menu.querySelector("button") as HTMLButtonElement | null)?.focus();
    });
    chip = el("div", { class: "save-chip" }, button, menu);
    document.addEventListener("click", (e) => {
      if (chip && !chip.contains(e.target as Node)) close();
    });
    chip.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        close();
        button.focus();
        return;
      }
      // Up / Down move between the menu items (menu pattern), wrapping.
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !menu.hidden) {
        const items = [...menu.querySelectorAll<HTMLButtonElement>("button")];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        const j = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        e.preventDefault();
        items[j]?.focus();
      }
    });
    const bar = document.querySelector(".topbar");
    const gh = bar?.querySelector(".gh");
    if (bar && gh) bar.insertBefore(chip, gh);
    else o.status.after(chip); // a page without the top bar
  };

  const loaded = async (name: string, savedAt: number) => {
    o.status.replaceChildren();
    setLoaded(true);
    await showChip(name, savedAt);
  };

  const accept = async (file: File, handle?: SaveHandle) => {
    o.status.replaceChildren(el("p", { class: "muted" }, "Reading…"));
    try {
      const text = await file.text();
      await o.load(text, file.name);
      const savedAt = Date.now();
      await putSave({ name: file.name, text, savedAt }, handle);
      await loaded(file.name, savedAt);
    } catch (e) {
      showError(`Could not read ${file.name}: ${e instanceof Error ? e.message : e}`);
    }
  };

  const reload = async () => {
    const f = await rereadHandle();
    if (f) await accept(f, (await getHandle()) ?? undefined);
    else chooseSave(pickerOpts);
  };

  const forget = async () => {
    await forgetSave();
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

  // The save opened on any page before: use it right away.
  getSave().then(async (s) => {
    if (!s) return;
    try {
      await o.load(s.text, s.name);
      await loaded(s.name, s.savedAt);
    } catch (e) {
      showError(`The stored save ${s.name} could not be read: ${e instanceof Error ? e.message : e}`);
    }
  });
}
