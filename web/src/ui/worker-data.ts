/**
 * Worker side of the data hand-off (review F13): the page fetches a data file once and posts the worker a copy of
 * its bytes (a transferred ArrayBuffer) right after starting it, so the worker doesn't fetch it again. A file the
 * page didn't send (not loaded there yet, or a worker run from Node tests) is fetched as before.
 * Page side: data-files.ts dataWorker.
 */

/** The message dataWorker posts first: data file name (as under data/) -> its bytes. */
export interface DataMessage {
  dataFiles: Record<string, ArrayBuffer>;
}

const given = new Map<string, ArrayBuffer>();

/** True (and the files kept) when `msg` is the page's data message; the worker's onmessage then returns. */
export function takeDataMessage(msg: unknown): boolean {
  const files = (msg as Partial<DataMessage> | null)?.dataFiles;
  if (!files || typeof files !== "object") return false;
  for (const [name, bytes] of Object.entries(files)) given.set(name, bytes);
  return true;
}

/**
 * The JSON of data/`name`: from the bytes the page sent, else fetched next to the worker's script (js/../data/).
 * `label` names the file in an HTTP error ("game data: HTTP 404").
 */
export async function workerJson<T = unknown>(name: string, label = name): Promise<T> {
  const bytes = given.get(name);
  if (bytes) {
    given.delete(name);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }
  const r = await fetch(new URL(`../data/${name}`, self.location.href));
  if (!r.ok) throw new Error(`${label}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}
