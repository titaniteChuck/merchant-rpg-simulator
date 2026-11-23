/**
 * Where a page gets the save from: the one already opened on any page of the site (kept in this
 * browser by save-store.ts), or a file the visitor picks or drops. Once a save is loaded, the big drop
 * zone shrinks to a status bar: file name and age, Reload (same file, no dialog when the browser kept
 * its handle), Choose another file, Forget.
 */
import { el } from "./dom.ts";
import { chooseSave, bindSaveInput } from "./save-file.ts";
import { forgetSave, getHandle, getSave, putSave, rereadHandle, type SaveHandle } from "./save-store.ts";

export interface SaveSourceOptions {
  input: HTMLInputElement;
  drop: HTMLElement;
  /** Where the status bar goes. */
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

  const showLoaded = async (name: string, savedAt: number) => {
    o.drop.classList.add("compact");
    const canReread = Boolean(await getHandle());
    const btn = (label: string, title: string, f: () => void) => {
      const b = el("button", { type: "button", class: "secondary", title }, label);
      b.addEventListener("click", f);
      return b;
    };
    o.status.replaceChildren(el("div", { class: "save-bar" },
      el("span", { class: "save-bar-file" }, "📜 ", el("strong", {}, name), el("span", { class: "muted small" }, ` · opened ${age(savedAt)}`)),
      el("span", { class: "save-bar-actions" },
        btn("⟳ Reload", canReread ? "Read the same file again (after the game saved)" : "Choose the file again", reload),
        btn("Choose another file", "Open a different save", () => chooseSave(pickerOpts)),
        btn("Forget", "Remove the save from this browser", forget))));
  };

  const accept = async (file: File, handle?: SaveHandle) => {
    o.status.replaceChildren(el("p", { class: "muted" }, "Reading…"));
    try {
      const text = await file.text();
      await o.load(text, file.name);
      const savedAt = Date.now();
      await putSave({ name: file.name, text, savedAt }, handle);
      await showLoaded(file.name, savedAt);
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
    o.drop.classList.remove("compact");
    o.status.replaceChildren(el("p", { class: "muted small" }, "The save was removed from this browser."));
    o.onForget?.();
  };

  const pickerOpts = { input: o.input, drop: o.drop, onFile: accept, onError: showError };
  bindSaveInput(pickerOpts);

  // The save opened on any page before: use it right away.
  getSave().then(async (s) => {
    if (!s) return;
    try {
      await o.load(s.text, s.name);
      await showLoaded(s.name, s.savedAt);
    } catch (e) {
      showError(`The stored save ${s.name} could not be read: ${e instanceof Error ? e.message : e}`);
    }
  });
}
