// A very small DOM for tests that build page parts with dom.ts el() (no browser, no dependency): elements with
// attributes, children, text, classList, dataset, style, listeners, and querySelectorAll on simple selectors
// (tag, .class, [attr], [attr="v"], and combinations of these without spaces). Import it before the page modules.

type Listener = (e: { type: string; target: FakeElement }) => void;

export class FakeText {
  parentNode: FakeElement | null = null;
  data: string;
  constructor(data: string) {
    this.data = data;
  }
  get textContent(): string {
    return this.data;
  }
}

export class FakeElement {
  attributes = new Map<string, string>();
  childNodes: (FakeElement | FakeText)[] = [];
  parentNode: FakeElement | null = null;
  listeners = new Map<string, Listener[]>();
  dataset: Record<string, string> = {};
  style: Record<string, unknown> & { setProperty(k: string, v: string): void } = {
    setProperty(k: string, v: string) {
      (this as Record<string, unknown>)[k] = v;
    },
  };
  hidden = false;
  value = "";
  offsetWidth = 0;
  offsetHeight = 0;
  tagName: string;
  constructor(tagName: string) {
    this.tagName = tagName;
  }

  setAttribute(k: string, v: string): void {
    this.attributes.set(k, String(v));
    if (k.startsWith("data-")) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v);
  }
  getAttribute(k: string): string | null {
    return this.attributes.get(k) ?? null;
  }
  hasAttribute(k: string): boolean {
    return this.attributes.has(k);
  }
  removeAttribute(k: string): void {
    this.attributes.delete(k);
  }
  get className(): string {
    return this.getAttribute("class") ?? "";
  }
  set className(v: string) {
    this.setAttribute("class", v);
  }
  get id(): string {
    return this.getAttribute("id") ?? "";
  }
  set id(v: string) {
    this.setAttribute("id", v);
  }
  get title(): string {
    return this.getAttribute("title") ?? "";
  }
  set title(v: string) {
    this.setAttribute("title", v);
  }
  get classList() {
    const list = () => this.className.split(/\s+/).filter(Boolean);
    return {
      contains: (c: string) => list().includes(c),
      add: (...cs: string[]) => (this.className = [...new Set([...list(), ...cs])].join(" ")),
      remove: (...cs: string[]) => (this.className = list().filter((x) => !cs.includes(x)).join(" ")),
      toggle: (c: string, on?: boolean) => {
        const want = on ?? !list().includes(c);
        this.className = want ? [...new Set([...list(), c])].join(" ") : list().filter((x) => x !== c).join(" ");
        return want;
      },
    };
  }
  append(...kids: (FakeElement | FakeText | string)[]): void {
    for (const k of kids) {
      const n = typeof k === "string" ? new FakeText(k) : k;
      n.parentNode = this;
      this.childNodes.push(n);
    }
  }
  insertBefore(n: FakeElement, before: FakeElement | null): void {
    n.remove();
    n.parentNode = this;
    const k = before ? this.childNodes.indexOf(before) : -1;
    if (k < 0) this.childNodes.push(n);
    else this.childNodes.splice(k, 0, n);
  }
  replaceChildren(...kids: (FakeElement | FakeText | string)[]): void {
    this.childNodes = [];
    this.append(...kids);
  }
  remove(): void {
    if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter((n) => n !== this);
    this.parentNode = null;
  }
  get children(): FakeElement[] {
    return this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement);
  }
  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }
  get textContent(): string {
    return this.childNodes.map((n) => n.textContent).join("");
  }
  set textContent(v: string) {
    this.replaceChildren(v);
  }
  addEventListener(type: string, f: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), f]);
  }
  dispatch(type: string): void {
    for (const f of this.listeners.get(type) ?? []) f({ type, target: this });
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  matches(sel: string): boolean {
    const m = sel.match(/^([a-z0-9]*)((?:\.[\w-]+|\[[^\]]+\])*)$/i);
    if (!m) throw new Error(`fake-dom: unsupported selector ${sel}`);
    if (m[1] && this.tagName !== m[1].toLowerCase()) return false;
    for (const part of m[2].match(/\.[\w-]+|\[[^\]]+\]/g) ?? []) {
      if (part.startsWith(".")) {
        if (!this.classList.contains(part.slice(1))) return false;
      } else {
        const [, k, v] = part.match(/^\[([\w-]+)(?:="?([^"]*)"?)?\]$/)!;
        if (!this.hasAttribute(k) || (v !== undefined && this.getAttribute(k) !== v)) return false;
      }
    }
    return true;
  }
  querySelectorAll(sel: string): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (e: FakeElement) => {
      for (const c of e.children) {
        if (c.matches(sel)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel: string): FakeElement | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
}

const g = globalThis as Record<string, unknown>;
if (g.document === undefined) {
  const body = new FakeElement("body");
  g.document = {
    body,
    documentElement: { clientWidth: 375 },
    createElement: (tag: string) => new FakeElement(tag.toLowerCase()),
    addEventListener: () => {},
    querySelector: (s: string) => body.querySelector(s),
    querySelectorAll: (s: string) => body.querySelectorAll(s),
  };
  g.window ??= { scrollX: 0, scrollY: 0, addEventListener: () => {} };
}
