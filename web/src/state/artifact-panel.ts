// Round 15 (SPEC 31.1): the artifact panel beside the conversation, in Chat and in Kode. A box in an
// answer opens it; it shows the app running or its code, and the versions of the same app in the
// thread. Only this small state is in the first bundle: the panel itself (ui/ArtifactPanel.tsx) is
// a chunk that loads the first time a box is opened.
import { createSignal } from "solid-js";
import type { ArtifactDoc } from "../markdown/artifact-detect";

export type ArtifactTab = "preview" | "code";

export interface ArtifactPanelState {
  threadId: string | null;
  doc: ArtifactDoc; // the version that was opened
  tab: ArtifactTab;
  seq: number; // new for every open, also of the same box again
  focus: boolean; // false when it opened by itself, so the message field keeps the focus
  opener: HTMLElement | null; // the box, which gets the focus back when the panel closes
}

let seq = 0;
const [panel, setPanel] = createSignal<ArtifactPanelState | null>(null);
export const artifactPanel = panel;

// The version on screen, for the boxes: the one that is open is marked in the conversation.
type Shown = { messageId: string | null; sourceKey: string } | null;
let shownNow: Shown = null;
const shownListeners = new Set<() => void>();
export function setShownVersion(next: Shown): void {
  if (shownNow?.messageId === next?.messageId && shownNow?.sourceKey === next?.sourceKey) return;
  shownNow = next;
  for (const listener of shownListeners) listener();
}
export function shownVersion(): Shown {
  return shownNow;
}
export function onShownVersion(listener: () => void): () => void {
  shownListeners.add(listener);
  return () => shownListeners.delete(listener);
}

export function openArtifactPanel(threadId: string | null, doc: ArtifactDoc, options: { tab?: ArtifactTab; focus?: boolean; opener?: HTMLElement | null } = {}): void {
  setPanel({ threadId, doc, tab: options.tab ?? "preview", seq: ++seq, focus: options.focus ?? true, opener: options.opener ?? null });
}

export function closeArtifactPanel(): void {
  const current = panel();
  if (!current) return;
  setPanel(null);
  setBig(false);
  setShownVersion(null);
  if (current.focus && current.opener?.isConnected) current.opener.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
}

// Åpne stort: the panel over the conversation's width, beside the sidebar. Ends when it closes.
const [big, setBig] = createSignal(false);
export { big as artifactBig, setBig as setArtifactBig };

// A new app was written in some thread: the panel looks for new versions.
const [written, setWritten] = createSignal(0);
export const artifactsWritten = written;
export function noteArtifactWritten(): void {
  setWritten((n) => n + 1);
}

// The panel's width, kept between visits. Wider than the tool panel by default: an app needs room.
const WIDTH_KEY = "ad-artifact-width";
function initialWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(saved) && saved >= 340) return saved;
  } catch {
    // Not kept this time.
  }
  return Math.round(Math.min(Math.max(innerWidth * 0.44, 420), 760));
}
const [width, setWidthSignal] = createSignal(initialWidth());
export const artifactWidth = width;
export const maxArtifactWidth = () => Math.max(340, innerWidth - 380);
export function setArtifactWidth(next: number, keep = false): void {
  setWidthSignal(Math.round(Math.min(Math.max(next, 340), maxArtifactWidth())));
  if (!keep) return;
  try {
    localStorage.setItem(WIDTH_KEY, String(width()));
  } catch {
    // Only remembered when storage works.
  }
}
