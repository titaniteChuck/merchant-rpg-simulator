/**
 * Page side of the data hand-off (review F13): each data file is fetched once per page (bytes kept, JSON parsed
 * once), and a worker started with dataWorker gets a copy of the bytes the page holds as its first message, so it
 * doesn't download the file again. Worker side: worker-data.ts.
 */
import type { DataMessage } from "./worker-data.ts";

const bytes = new Map<string, Promise<ArrayBuffer>>();
const parsed = new Map<string, Promise<unknown>>();

/** The bytes of data/`name`, fetched once per page; a failed fetch is tried again on the next call. */
function load(name: string, label = name): Promise<ArrayBuffer> {
  let p = bytes.get(name);
  if (!p) {
    p = fetch(`data/${name}`).then((r) => {
      if (!r.ok) throw new Error(`${label}: HTTP ${r.status}`);
      return r.arrayBuffer();
    });
    p.catch(() => bytes.delete(name));
    bytes.set(name, p);
  }
  return p;
}

/** The parsed JSON of data/`name`, fetched and parsed once per page. `label` names the file in an HTTP error. */
export function dataJson<T = unknown>(name: string, label = name): Promise<T> {
  let p = parsed.get(name);
  if (!p) {
    p = load(name, label).then((b) => JSON.parse(new TextDecoder().decode(b)));
    p.catch(() => parsed.delete(name));
    parsed.set(name, p);
  }
  return p as Promise<T>;
}

/**
 * A module worker for js/`script` that first receives a copy of the bytes of `names` (data files under data/) the
 * page has or is fetching. Messages posted to it right away still arrive after the data: postMessage waits for the
 * files (a file that fails to load is left out, and the worker fetches it itself).
 */
export function dataWorker(script: string, names: string[]): Worker {
  const w = new Worker(new URL(`js/${script}`, document.baseURI), { type: "module" });
  const post = w.postMessage.bind(w) as (msg: unknown, transfer?: Transferable[]) => void;
  let queue: Promise<void> = Promise.all(names.map((n) => load(n).then((b) => [n, b.slice(0)] as const, () => null)))
    .then((got) => {
      const msg: DataMessage = { dataFiles: Object.fromEntries(got.filter((g) => g !== null)) };
      post(msg, Object.values(msg.dataFiles));
    });
  w.postMessage = ((msg: unknown, opt?: Transferable[] | StructuredSerializeOptions) => {
    queue = queue.then(() => post(msg, Array.isArray(opt) ? opt : opt?.transfer)).catch((e) => console.error(e));
  }) as Worker["postMessage"];
  return w;
}
