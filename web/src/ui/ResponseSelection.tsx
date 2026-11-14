import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { Thread } from "../../../shared/protocol";
import { deliverToComposer } from "../state/composer-delivery";
import { sideChat } from "../state/thread-actions";
import { IconChat, IconSplitRight } from "./icons";
import "../styles/response-selection.css";

const MAX_QUOTE = 64_000;
const EXCLUDED = "button, input, textarea, select, iframe, [contenteditable]:not([contenteditable=false]), [role=button], .md-code-head, .artifact-box";
interface Excerpt { text: string; left: number; top: number; bottom: number }

// Native text selection is separate from Selecting (whole messages). Only one assistant body in
// this conversation may supply an excerpt. No user text, controls, tools or other pane can join it.
export function ResponseSelection(props: { root: () => HTMLElement; thread: () => Thread | undefined; selecting: () => boolean }) {
  const [excerpt, setExcerpt] = createSignal<Excerpt | null>(null);
  // SoloApp has one fixed thread, and drafts belong to this window. Opening a side thread in its
  // hidden main grid would strand the quote. Keep the action explicit until SoloApp can navigate.
  const detached = new URLSearchParams(location.search).has("rute");
  let toolbar: HTMLDivElement | undefined;
  let dragging = false;
  let frame = 0;
  const clear = () => { cancelAnimationFrame(frame); frame = 0; setExcerpt(null); };
  createEffect(() => { if (props.selecting()) clear(); });
  const ownedSelection = (): Excerpt | null => {
    if (props.selecting() || !props.thread()) return null;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
    const range = selection.getRangeAt(0);
    const elementOf = (node: Node) => node instanceof Element ? node : node.parentElement;
    const body = elementOf(range.startContainer)?.closest<HTMLElement>('.row-text[data-message-id]');
    if (!body || !props.root().contains(body) || elementOf(range.endContainer)?.closest('.row-text[data-message-id]') !== body) return null;
    if (elementOf(range.startContainer)?.closest(EXCLUDED) || elementOf(range.endContainer)?.closest(EXCLUDED)) return null;
    for (const control of body.querySelectorAll(EXCLUDED)) if (range.intersectsNode(control)) return null;
    const text = selection.toString();
    if (!text.trim()) return null;
    const viewport = props.root().querySelector(".scroller")?.getBoundingClientRect() ?? props.root().getBoundingClientRect();
    const rect = [...range.getClientRects()].find((r) => r.width > 0 && r.height > 0 && r.bottom > Math.max(0, viewport.top) && r.top < Math.min(innerHeight, viewport.bottom));
    if (!rect) return null;
    return { text, left: rect.left + rect.width / 2, top: Math.max(viewport.top, rect.top), bottom: Math.min(viewport.bottom, rect.bottom) };
  };
  const place = () => {
    const selected = excerpt();
    if (!toolbar || !selected) return;
    const margin = 8;
    const top = selected.top - toolbar.offsetHeight - 8;
    toolbar.style.left = `${Math.max(margin, Math.min(selected.left - toolbar.offsetWidth / 2, innerWidth - toolbar.offsetWidth - margin))}px`;
    toolbar.style.top = `${Math.max(margin, Math.min(top >= margin ? top : selected.bottom + 8, innerHeight - toolbar.offsetHeight - margin))}px`;
  };
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (dragging) return;
      setExcerpt(ownedSelection());
      place();
    });
  };
  const add = (side: boolean) => {
    // Revalidate against the live selection before using the captured text; a delayed toolbar
    // click must never deliver a stale selection after the user moved to a different message.
    const selected = ownedSelection();
    const thread = props.thread();
    if (!selected || !thread || selected.text.length > MAX_QUOTE || (side && detached)) return clear();
    const quote = `Utdrag fra svaret:\n\n${selected.text.split(/\r?\n/).map((line) => `> ${line}`).join("\n")}\n\n`;
    clear();
    window.getSelection()?.removeAllRanges();
    if (side) void sideChat(thread, (created) => deliverToComposer(created.id, { text: quote, images: [] }));
    else deliverToComposer(thread.id, { text: quote, images: [] });
  };
  onMount(() => {
    const down = (event: PointerEvent) => {
      if (toolbar?.contains(event.target as Node)) {
        // Keep the native range intact for mouse/touch activation. Keyboard focus still works.
        event.preventDefault();
        return;
      }
      clear();
      dragging = props.root().contains(event.target as Node);
    };
    const up = () => { if (dragging) { dragging = false; update(); } };
    const key = (event: KeyboardEvent) => {
      if (!excerpt() || props.selecting()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        clear();
        window.getSelection()?.removeAllRanges();
      } else if (event.altKey && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        toolbar?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
      } else if (toolbar?.contains(event.target as Node) && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const buttons = [...toolbar.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowLeft" ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
    };
    const focus = (event: FocusEvent) => {
      if (!toolbar?.contains(event.target as Node) && !props.root().contains(event.target as Node)) clear();
    };
    document.addEventListener("selectionchange", update);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    document.addEventListener("keydown", key, true);
    document.addEventListener("focusin", focus);
    document.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);
    window.addEventListener("blur", clear);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
      window.removeEventListener("blur", clear);
    });
  });
  return (
    <Show when={!props.selecting() && excerpt()}>
      <Portal>
        <div class="response-selection" role="toolbar" aria-label="Handlinger for markert svartekst" data-testid="response-selection" ref={(element) => { toolbar = element; queueMicrotask(place); }} title="Alt+Enter flytter fokus til handlingene. Esc lukker.">
          <button type="button" disabled={excerpt()!.text.length > MAX_QUOTE} onClick={() => add(false)}><IconChat size={14} /><span>Legg til i chat</span></button>
          <span class="response-selection-divider" aria-hidden="true" />
          <button type="button" disabled={detached || excerpt()!.text.length > MAX_QUOTE} title={detached ? "Åpne sidechat fra hovedvinduet" : "En ny sidechat i samme modus og prosjekt. Bare utdraget legges i utkastet."} onClick={() => add(true)}><IconSplitRight size={14} /><span>Legg til i sidechat</span></button>
          <Show when={excerpt()!.text.length > MAX_QUOTE}><span class="response-selection-limit" role="status">Velg inntil 64 000 tegn</span></Show>
          <span class="sr-only" role="status">Tekst valgt. Alt+Enter åpner handlingene.</span>
        </div>
      </Portal>
    </Show>
  );
}
