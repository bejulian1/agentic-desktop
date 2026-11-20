import { createStore } from "solid-js/store";
import type { Thread } from "../../../shared/protocol";
import { patch } from "../lib/api";
import { app, report, setApp } from "./app";

const [selections, setSelections] = createStore<Record<string, { modelId: string; saved: Promise<void> } | undefined>>({});

export const pendingModelSelection = (threadId: string) => selections[threadId];

export function selectThreadModel(threadId: string, modelId: string): void {
  const previous = selections[threadId]?.saved;
  const saved = (async () => {
    await previous?.catch(() => undefined);
    const thread = await patch<Thread>(`/api/threads/${threadId}`, { modelId });
    if (thread.id === threadId && app.threads[threadId]) setApp("threads", threadId, "modelId", thread.modelId);
  })();
  setSelections(threadId, { modelId, saved });
  const clear = () => {
    if (selections[threadId]?.saved !== saved) return false;
    setSelections(threadId, undefined);
    return true;
  };
  void saved.then(clear, (error) => { if (clear()) report(error); });
}
