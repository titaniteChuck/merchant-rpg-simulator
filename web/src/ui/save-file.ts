/**
 * Save-file picker shared by the pages that read a Merchant save (save viewer, battle simulator).
 *
 * A page can't open the file dialog in an arbitrary folder (like %APPDATA%\Retora\Merchant\Documents).
 * Where the File System Access picker exists (Chromium: Chrome, Edge, Opera), the dialog starts in the
 * folder of the save opened last (its handle is kept by save-store.ts), else in Documents, and the browser
 * also remembers the last folder per picker `id`. Other browsers keep the plain <input type="file"> dialog,
 * which opens wherever the OS decides; once a save is opened, pages reuse it without any dialog.
 *
 * Markup: <label id="drop" class="drop"><input id="file" type="file" accept=".txt,application/json,text/plain"> … </label>
 */
import { getHandle, type SaveHandle } from "./save-store.ts";

// File System Access API. Not in TypeScript's DOM lib yet.
type OpenFilePicker = (options: {
  id?: string;
  startIn?: string | SaveHandle;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<(SaveHandle & { getFile(): Promise<File> })[]>;

/** The browser remembers the folder of the last save picked with this id. */
export const PICKER_ID = "merchant-save";

export interface SaveInputOptions {
  input: HTMLInputElement;
  drop: HTMLElement;
  /** The chosen file, and its handle when the picker gave one (to reread it later without a dialog). */
  onFile: (file: File, handle?: SaveHandle) => void;
  /** A picker failure other than the user cancelling (default: console.error). */
  onError?: (message: string) => void;
}

const picker = () => (typeof window === "undefined" ? undefined : (window as unknown as { showOpenFilePicker?: OpenFilePicker }).showOpenFilePicker);

/** Open the save dialog (the remembered-folder picker when available, else the plain input). */
export async function chooseSave(opts: SaveInputOptions): Promise<void> {
  const pick = picker();
  if (!pick) {
    opts.input.click();
    return;
  }
  const onError = opts.onError ?? ((m: string) => console.error(m));
  const types = [{ description: "Merchant save", accept: { "text/plain": [".txt"], "application/json": [".json"] } }];
  try {
    const last = await getHandle();
    let handles;
    try {
      handles = await pick({ id: PICKER_ID, startIn: last ?? "documents", types });
    } catch (err) {
      if (!last || (err instanceof DOMException && err.name === "AbortError")) throw err;
      handles = await pick({ id: PICKER_ID, startIn: "documents", types }); // stale handle (file moved)
    }
    opts.onFile(await handles[0].getFile(), handles[0]);
  } catch (err) {
    if (!(err instanceof DOMException && err.name === "AbortError")) onError(`Could not open the file: ${err}`);
  }
}

/** Wire click (remembered-folder picker when available, else the plain input), change and drag-and-drop. */
export function bindSaveInput(opts: SaveInputOptions): void {
  const { input, drop, onFile } = opts;
  input.addEventListener("change", () => {
    if (input.files?.[0]) onFile(input.files[0]);
    input.value = ""; // choosing the same file again still fires "change"
  });
  if (picker()) {
    input.addEventListener("click", (e) => {
      e.preventDefault(); // replaces the <input type="file"> dialog
      chooseSave(opts);
    });
  }
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const f = e.dataTransfer?.files?.[0];
    if (f) onFile(f);
  });
}
