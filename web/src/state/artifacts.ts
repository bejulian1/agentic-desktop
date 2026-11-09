// Artifacts: the list for the sidebar and the room, and whether the room is showing. The list
// never carries HTML; an open artifact fetches its own.
import { createMemo, createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { Artifact, ArtifactLang, ArtifactSummary } from "../../../shared/protocol";
import { del, post, patch } from "../lib/api";
import { on } from "../lib/socket";

const [list, setList] = createStore<{ items: ArtifactSummary[] }>({ items: [] });
const listeners = new Set<() => void>();

export const artifacts = () => list.items;
export const artifactCount = createMemo(() => list.items.length);

function changed(): void {
  for (const listener of listeners) listener();
}

// For the chat cards, which are plain DOM and not inside a reactive scope.
export function onArtifactsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function upsert(artifact: ArtifactSummary): void {
  const rest = list.items.filter((a) => a.id !== artifact.id);
  setList("items", reconcile([artifact, ...rest].sort((a, b) => b.updatedAt - a.updatedAt), { key: "id" }));
  changed();
}

export function setArtifacts(items: ArtifactSummary[]): void {
  setList("items", reconcile(items, { key: "id" }));
  changed();
}

export function wireArtifactEvents(): void {
  on("artifact.changed", ({ artifact }) => upsert(artifact));
  on("artifact.deleted", ({ artifactId }) => {
    setList("items", (items) => items.filter((a) => a.id !== artifactId));
    changed();
  });
}

export function savedArtifactFor(messageId: string | null, sourceKey: string): ArtifactSummary | undefined {
  if (!messageId) return undefined;
  return list.items.find((a) => a.messageId === messageId && a.sourceKey === sourceKey);
}

// The room in the middle of the window. id null is the gallery.
const [room, setRoom] = createSignal<{ id: string | null } | null>(null);
export { room };

export function openArtifacts(id: string | null = null): void {
  setRoom({ id });
}

export function closeArtifacts(): void {
  if (room()) setRoom(null);
}

function strip(artifact: Artifact): ArtifactSummary {
  const { html: _html, previousHtml: _previous, ...summary } = artifact;
  return summary;
}

// Answers apply at once, so the UI does not wait for the broadcast.
export async function createArtifact(body: { html?: string; lang?: ArtifactLang; title?: string; threadId?: string | null; messageId?: string | null; sourceKey?: string | null }): Promise<Artifact> {
  const artifact = await post<Artifact>("/api/artifacts", body);
  upsert(strip(artifact));
  return artifact;
}

export async function updateArtifact(id: string, body: { title?: string; html?: string }): Promise<Artifact> {
  const artifact = await patch<Artifact>(`/api/artifacts/${id}`, body);
  upsert(strip(artifact));
  return artifact;
}

export async function duplicateArtifact(id: string): Promise<Artifact> {
  const artifact = await post<Artifact>(`/api/artifacts/${id}/duplicate`);
  upsert(strip(artifact));
  return artifact;
}

export async function restoreArtifact(id: string): Promise<Artifact> {
  const artifact = await post<Artifact>(`/api/artifacts/${id}/restore`);
  upsert(strip(artifact));
  return artifact;
}

export async function deleteArtifact(id: string): Promise<void> {
  await del(`/api/artifacts/${id}`);
  setList("items", (items) => items.filter((a) => a.id !== id));
  changed();
}

// Names a code block within a message, so a saved one can be recognised again. FNV-1a over the
// text plus its length: the same block always gives the same key.
export function sourceKeyFor(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16).padStart(8, "0")}-${text.length}`;
}
