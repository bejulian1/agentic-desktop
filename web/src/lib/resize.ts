// A single ResizeObserver for everything. Hermes measured 2 600 callbacks with one per component
// and 43 with a shared one.
type Callback = (entry: ResizeObserverEntry) => void;

const callbacks = new WeakMap<Element, Callback>();
const observer = new ResizeObserver((entries) => {
  for (const entry of entries) callbacks.get(entry.target)?.(entry);
});

export function observeResize(element: Element, callback: Callback): () => void {
  callbacks.set(element, callback);
  observer.observe(element);
  return () => {
    observer.unobserve(element);
    callbacks.delete(element);
  };
}
