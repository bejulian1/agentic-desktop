// Syntax highlighting happens in a worker, and only for blocks that come into view.
const CACHE_LIMIT = 1500;
const MAX_CHARS = 200_000;

interface Pending {
  element: HTMLElement;
  lang: string;
  text: string;
}

type Result = Array<[number, number, string]>;

// Observed per container, a group of blocks, because a long message can hold thousands of code
// blocks and an IntersectionObserver costs a little per element on every frame.
const waiting = new WeakMap<Element, Pending[]>();
const inFlight = new Map<number, Pending>();
const cache = new Map<string, Result>();
let worker: Worker | undefined;
let nextId = 1;

const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    observer.unobserve(entry.target);
    const pending = waiting.get(entry.target);
    waiting.delete(entry.target);
    if (pending) for (const item of pending) request(item);
  }
}, { rootMargin: "300px 0px" });

function apply(pending: Pending, spans: Result): void {
  const { element, text } = pending;
  if (!element.isConnected || element.textContent !== text) return;
  const fragment = document.createDocumentFragment();
  let at = 0;
  for (const [from, to, className] of spans) {
    if (from > at) fragment.appendChild(document.createTextNode(text.slice(at, from)));
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text.slice(from, to);
    fragment.appendChild(span);
    at = to;
  }
  if (at < text.length) fragment.appendChild(document.createTextNode(text.slice(at)));
  element.replaceChildren(fragment);
}

function request(pending: Pending): void {
  const key = `${pending.lang}\0${pending.text}`;
  const cached = cache.get(key);
  if (cached) return apply(pending, cached);
  worker ??= createWorker();
  const id = nextId++;
  inFlight.set(id, pending);
  worker.postMessage({ id, lang: pending.lang, text: pending.text });
}

function createWorker(): Worker {
  const created = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  created.onmessage = (event: MessageEvent<{ id: number; spans: Result }>) => {
    const pending = inFlight.get(event.data.id);
    inFlight.delete(event.data.id);
    if (!pending) return;
    const key = `${pending.lang}\0${pending.text}`;
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(key, event.data.spans);
    apply(pending, event.data.spans);
  };
  return created;
}

export function highlightWhenVisible(container: Element, element: HTMLElement, lang: string, text: string): void {
  if (!lang || text.length > MAX_CHARS) return;
  const item = { element, lang: lang.toLowerCase(), text };
  const list = waiting.get(container);
  if (list) list.push(item);
  else {
    waiting.set(container, [item]);
    observer.observe(container);
  }
}
