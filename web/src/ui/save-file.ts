/**
 * Save-file picker shared by the pages that read a Merchant save (save viewer, battle simulator).
 *
 * A page can't open the file dialog in an arbitrary folder (like %APPDATA%\Retora\Merchant\Documents).
 * Where the File System Access picker exists (Chromium: Chrome, Edge, Opera), the browser remembers the
 * last folder per picker `id`: after the first pick, "click to choose" opens straight in the save folder,
 * on every page that uses this module. Other browsers keep the plain <input type="file"> dialog.
 *
 * Markup: <label id="drop" class="drop"><input id="file" type="file" accept=".txt,application/json,text/plain"> … </label>
 */

// File System Access API. Not in TypeScript's DOM lib yet.
type OpenFilePicker = (options: {
  id?: string;
  startIn?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ getFile(): Promise<File> }[]>;

/** The browser remembers the folder of the last save picked with this id. */
export const PICKER_ID = "merchant-save";

export interface SaveInputOptions {
  input: HTMLInputElement;
  drop: HTMLElement;
  onFile: (file: File) => void;
  /** A picker failure other than the user cancelling (default: console.error). */
  onError?: (message: string) => void;
}

/** Wire click (remembered-folder picker when available, else the plain input), change and drag-and-drop. */
export function bindSaveInput(opts: SaveInputOptions): void {
  const { input, drop, onFile } = opts;
  const onError = opts.onError ?? ((m: string) => console.error(m));
  input.addEventListener("change", () => {
    if (input.files?.[0]) onFile(input.files[0]);
  });

  const picker = (window as unknown as { showOpenFilePicker?: OpenFilePicker }).showOpenFilePicker;
  if (picker) {
    input.addEventListener("click", async (e) => {
      e.preventDefault(); // replaces the <input type="file"> dialog
      try {
        const [handle] = await picker({
          id: PICKER_ID,
          startIn: "documents", // first time only; afterwards the remembered folder wins
          types: [{ description: "Merchant save", accept: { "text/plain": [".txt"], "application/json": [".json"] } }],
        });
        onFile(await handle.getFile());
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) onError(`Could not open the file: ${err}`);
      }
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
