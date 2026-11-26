import { createMemo, createSignal } from "solid-js";
import type { Thread } from "../../../shared/protocol";
import { patch, post } from "../lib/api";
import { t } from "../lib/i18n";
import { app, modelName, toast } from "./app";
import { MAX_PANES, type Grid } from "./grid";
import { createThreadFor } from "./navigate";

export const MAX_COMPARE_MODELS = 4;

// Each composer owns its selection. Removing the penultimate model leaves a normal single choice.
export function createModelComparison(active: () => string | undefined, chooseSingle: (id: string) => void) {
  const [selection, setSelection] = createSignal<string[]>([]);
  const ids = createMemo(() => {
    const configured = selection().filter(id => app.models.some(model => model.id === id));
    return configured.length >= 2 ? configured : [];
  });
  const clear = () => setSelection([]);
  const toggle = (id: string) => {
    const first = active();
    const current = ids().length ? ids() : first ? [first] : [];
    if (!current.includes(id) && current.length >= MAX_COMPARE_MODELS) {
      toast(t("Du kan sammenligne inntil 4 modeller samtidig."), "info");
      return;
    }
    const next = current.includes(id) ? current.filter(model => model !== id) : [...current, id];
    if (next.length === 1) chooseSingle(next[0]);
    setSelection(next.length >= 2 ? next : []);
  };
  return { ids, clear, toggle };
}

type ComparisonContext = Pick<Thread, "projectId" | "mode" | "chatProjectId" | "planMode" | "reasoning" | "chatTools" | "personality"> & { temporarySource?: string };

async function createComparisonThread(modelId: string, context: ComparisonContext): Promise<string> {
  const thread = await createThreadFor(context.projectId, modelId, {
    code: context.mode === "code", chatProjectId: context.chatProjectId,
    sideOf: context.temporarySource, chatTools: context.chatTools,
  });
  const settings: Partial<Thread> = {};
  if (thread.planMode !== context.planMode) settings.planMode = context.planMode;
  if (thread.reasoning !== context.reasoning) settings.reasoning = context.reasoning;
  if (context.personality && thread.personality !== context.personality) settings.personality = context.personality;
  if (Object.keys(settings).length) await patch(`/api/threads/${thread.id}`, settings);
  return thread.id;
}

// Preparation may finish out of order. Place panes in selection order, then launch their
// independent requests together. A failed creation or send belongs only to that model.
export async function sendComparison(options: {
  grid: Grid;
  paneId: string;
  modelIds: string[];
  first: Promise<string>;
  context: ComparisonContext;
  body: Record<string, unknown>;
  restoreDraft: (index: number, threadId?: string) => void;
}) {
  const { grid, paneId, modelIds, first, context, body } = options;
  const prepared = await Promise.allSettled([first, ...modelIds.slice(1).map(id => createComparisonThread(id, context))]);
  // A busy source queues a distinct comparison turn, even when normal messages steer the
  // running model. The other panes can start immediately.
  const message = { ...body, steer: false };
  let previous = paneId;
  const sends = await Promise.allSettled(prepared.map(async (target, index) => {
    if (target.status === "rejected") throw target.reason;
    if (index > 0) {
      if (!grid.panes().some(pane => pane.id === previous)) throw new Error(t("Ruten ble lukket."));
      const pane = grid.split(previous, "right", target.value, false);
      if (!pane) throw new Error(t("Det er plass til {count} ruter i et vindu.", { count: MAX_PANES }));
      previous = pane;
    }
    await post(`/api/threads/${target.value}/messages`, message);
    return target.value;
  }));
  for (const [index, result] of sends.entries()) {
    if (result.status === "fulfilled") continue;
    const target = prepared[index];
    options.restoreDraft(index, target.status === "fulfilled" ? target.value : undefined);
    toast(t("Kunne ikke sende til {model}: {error}", { model: modelName(modelIds[index]), error: result.reason?.message ?? t("Noe gikk galt") }));
  }
  return sends.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
}
