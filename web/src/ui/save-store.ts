/**
 * The save the visitor opened, kept in this browser (IndexedDB) so every page can use it without asking
 * again. Nothing leaves the browser; "Forget" deletes it.
 *
 * Also keeps the file handle when the File System Access picker gave one (Chrome, Edge): "Reload" then
 * rereads the same file (after the game saved again) without a dialog, and the picker starts in its folder.
 */

const DB = "merchant-rpg-simulator";
const STORE = "kv";

export interface StoredSave {
  name: string;
  text: string;
  /** ms since epoch */
  savedAt: number;
}

/** FileSystemFileHandle where the browser has it (not in TypeScript's DOM lib yet). */
export interface SaveHandle {
  name: string;
  getFile(): Promise<File>;
  queryPermission?(o: { mode: "read" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "read" }): Promise<PermissionState>;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Storage can be missing or blocked (private windows, disabled site data): every call degrades to "nothing stored". */
async function safe<T>(f: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return typeof indexedDB === "undefined" ? fallback : await f();
  } catch {
    return fallback;
  }
}

export const getSave = () => safe(() => tx<StoredSave | undefined>("readonly", (s) => s.get("save")), undefined);
export const getHandle = () => safe(() => tx<SaveHandle | undefined>("readonly", (s) => s.get("handle")), undefined);

export async function putSave(save: StoredSave, handle?: SaveHandle | null): Promise<void> {
  await safe(() => tx("readwrite", (s) => s.put(save, "save")), undefined);
  if (handle) await safe(() => tx("readwrite", (s) => s.put(handle, "handle")), undefined);
  else await safe(() => tx("readwrite", (s) => s.delete("handle")), undefined);
}

export async function forgetSave(): Promise<void> {
  await safe(() => tx("readwrite", (s) => s.delete("save")), undefined);
  await safe(() => tx("readwrite", (s) => s.delete("handle")), undefined);
}

/** The latest version of the remembered file (asks for read permission if needed), or null. */
export async function rereadHandle(): Promise<File | null> {
  const h = await getHandle();
  if (!h) return null;
  try {
    let p = (await h.queryPermission?.({ mode: "read" })) ?? "granted";
    if (p !== "granted") p = (await h.requestPermission?.({ mode: "read" })) ?? "denied";
    return p === "granted" ? await h.getFile() : null;
  } catch {
    return null; // file moved or deleted
  }
}
