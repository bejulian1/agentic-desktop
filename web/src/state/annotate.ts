// Round 11b (SPEC 25.1): the shortcut for Annoter reaches the Browser panel through here, so the
// shortcut handler does not have to load the panel. A panel that is open listens; with none open
// the shortcut says what to do instead.
import { createSignal } from "solid-js";

const [annotateRequest, setAnnotateRequest] = createSignal(0);
export { annotateRequest };

let listening = 0;

export function listenForAnnotate(): () => void {
  listening++;
  return () => {
    listening--;
  };
}

// false when no Browser panel is open to take it.
export function requestAnnotate(): boolean {
  if (!listening) return false;
  setAnnotateRequest(annotateRequest() + 1);
  return true;
}
