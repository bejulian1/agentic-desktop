// Innstillinger → Hooks: the user's hooks, as the server has them. Every change goes through the
// settings API and comes back as the full list; hooks.changed keeps other windows (and the last
// run of each hook) up to date.
import { createStore, reconcile } from "solid-js/store";
import type { HookConfig, HooksState, HookTestResult } from "../../../shared/hooks";
import { del, get, patch, post, put } from "../lib/api";
import { on } from "../lib/socket";

// A store, reconciled by id, so a change (also the last run of a hook, which comes over the socket)
// keeps the rows on the settings page instead of making them anew, and the keyboard focus stays on
// the switch or button that was used.
const [store, setStore] = createStore<{ state: HooksState | null }>({ state: null });
export const hooksState = (): HooksState | null => store.state;
const setHooksState = (state: HooksState): void => setStore("state", reconcile(state, { key: "id" }));

on("hooks.changed", ({ state }) => setHooksState(state));

// What the form sends: everything but the id, which the server gives a new hook.
export type HookDraft = Omit<HookConfig, "id">;

export async function refreshHooks(): Promise<void> {
  setHooksState(await get<HooksState>("/api/hooks"));
}

export async function createHook(draft: HookDraft): Promise<void> {
  setHooksState(await post<HooksState>("/api/hooks", draft));
}

export async function updateHook(id: string, change: Partial<HookDraft>): Promise<void> {
  setHooksState(await patch<HooksState>(`/api/hooks/${encodeURIComponent(id)}`, change));
}

export async function deleteHook(id: string): Promise<void> {
  setHooksState(await del<HooksState>(`/api/hooks/${encodeURIComponent(id)}`));
}

export async function reorderHooks(ids: string[]): Promise<void> {
  setHooksState(await put<HooksState>("/api/hooks/order", { ids }));
}

// One run with a sample payload. With the id of a saved hook, its last run is updated too.
export function testHook(draft: HookDraft & { id?: string }): Promise<HookTestResult> {
  return post<HookTestResult>("/api/hooks/test", draft);
}
