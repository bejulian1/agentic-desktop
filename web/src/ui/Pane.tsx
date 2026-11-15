import {effectiveUiMod,uiMods} from "../state/ui-mods";
import {modVariables} from "../lib/ui-mod-theme";
import {UiModBand} from "./UiModBand";
// One pane: a header, a conversation and a message field. It subscribes to its own thread only.
import { createEffect, createMemo, createSignal, lazy, Suspense, For, onCleanup, Show } from "solid-js";
import { app, renameThread, report, scopeOf, untitled, EMPTY_THREAD_NAME } from "../state/app";
import { beginDrag, applyDrop } from "../state/drag";
import type { Grid, PaneState } from "../state/grid";
import { chatProjectFor, openThread } from "../state/navigate";
import { loadModel, peekModel, retainModel, type ApprovalRow, type ThreadModel } from "../state/thread-model";
import { closeDetachedWindow, openDetachedWindow, sendReattach } from "../state/windows";
import { Composer } from "./Composer";
import { Conversation, type ConversationTools } from "./Conversation";
import { Home } from "./Home";
import { IconBranch, IconClose, IconWarn } from "./icons";
import { ApprovalCard } from "./rows";
import { STATE_LABEL, threadState } from "../state/thread-status";
import { forkSource, forkSourceTitle, openForkSource } from "../state/fork";

// Round 11 (SPEC 24.1): the pane's own buttons moved to the top bar, where ⋯ reaches the focused
// pane's conversation (search, export) through this.
const UiModBackdrop=lazy(()=>import("./UiModBackdrop"));

export const paneTools = new Map<string, ConversationTools>();

export function Pane(props: {
  pane: PaneState;
  grid: Grid | null;
  projectId: string | null;
  code?: boolean; // Kode, also without a project (Denne datamaskinen)
  focused: boolean;
  solo?: boolean;
}) {
  const threadId = props.pane.threadId;
  const thread = createMemo(() => {
    const id = threadId();
    return id ? app.threads[id] : undefined;
  });
  // Empty panes retain a separate composer instance for each Chat project context. Typing in
  // one project must never appear when the same pane starts a chat somewhere else.
  const mod=createMemo(()=>effectiveUiMod(threadId(),props.code||thread()?.mode==="code"?"code":"chat"));
  const scene=()=>!!mod()&&(mod()!.scene.preset!=="none"||mod()!.scene.layers.length>0);
  const background=()=>scene()||!!uiMods().wallpaper;
  const modStyle=createMemo(()=>mod()?modVariables(mod()!):{});
  const composerKey = () => threadId() ?? (props.code ? props.pane.id : `${props.pane.id}:chat:${chatProjectFor(props.pane.id) ?? "global"}`);
  const [model, setModel] = createSignal<ThreadModel | null>(null);
  const [renaming, setRenaming] = createSignal(false);
  let fill: ((text: string) => void) | undefined;
  onCleanup(() => paneTools.delete(props.pane.id));
  let toBottom: (() => void) | undefined;

  createEffect(() => {
    const id = threadId();
    if (!id) return setModel(null);
    const ready = peekModel(id);
    if (ready) return setModel(ready);
    let current = true;
    loadModel(id).then((loaded) => {
      if (current) setModel(loaded);
    }).catch(report);
    onCleanup(() => (current = false));
  });

  createEffect(() => {
    const current = model();
    if (current) onCleanup(retainModel(current));
  });

  const showThread = (id: string) => {
    const target = app.threads[id];
    if (target) void openThread(target);
  };

  const detach = (paneId: string) => {
    const entry = props.grid?.detach(paneId);
    if (entry) openDetachedWindow(entry);
  };

  const startDrag = (event: PointerEvent) => {
    if ((event.target as HTMLElement).closest("button, input")) return;
    const { grid } = props;
    if (!grid) return;
    beginDrag(event, {
      source: { kind: "pane", paneId: props.pane.id, label: untitled(thread()) ? EMPTY_THREAD_NAME : thread()!.title },
      onDetach: detach,
      onDrop: (source, target) => applyDrop(grid, source, target),
    });
  };

  const commitRename = (input: HTMLInputElement) => {
    setRenaming(false);
    const title = input.value.trim();
    const id = threadId();
    if (id && title && title !== thread()?.title) renameThread(id, title).catch(report);
  };

  // Approvals that wait are answered right above the message field, in its width. They are always
  // near the end of the thread, because the run stops until they are answered.
  const pending = createMemo(() => {
    const current = model();
    if (!current) return [];
    const out: ApprovalRow[] = [];
    for (const chunk of current.chunks().slice(-3)) {
      for (const row of chunk.rows()) {
        if (row.kind !== "approval") continue;
        row.rev();
        if (row.decision === null && !row.closed) out.push(row);
      }
    }
    return out;
  });

  // Kode only, and only with something to show: a goal, a plan, chapters, threads it started or
  // files it changed. Chat is a plain conversation (SPEC 18.2).
  const parent = createMemo(() => {
    const id = thread()?.parentThreadId;
    return id ? app.threads[id] : undefined;
  });

  return (
    <div class="pane-inner" data-pane-id={props.pane.id} data-thread-id={threadId() ?? ""} classList={{ focused: props.focused,"ui-mod-pane":!!mod(),"ui-mod-scene":scene(),"background-pane":background(),"ui-mod-glass":background()&&uiMods().glass!==false&&uiMods().glassStyle!=="panels","ui-mod-panels":background()&&uiMods().glass!==false&&uiMods().glassStyle==="panels","ui-mod-clear":background()&&uiMods().glass===false,"ui-mod-compact":mod()?.layout.density==="compact" }} style={modStyle()} data-ui-mod={mod()?.id} onPointerDown={() => props.grid?.focus(props.pane.id)}>
      <Show when={scene()}><Suspense><UiModBackdrop scene={mod()!.scene}/></Suspense></Show>
      <header class="pane-head" onPointerDown={startDrag}>
        <span class="pane-dot" classList={{ running: thread()?.running }} data-state={thread() ? threadState(thread()!) : "idle"} title={thread() ? STATE_LABEL[threadState(thread()!)] || undefined : undefined} />
        <Show
          when={!renaming()}
          fallback={
            <input
              class="input rename"
              aria-label="Nytt navn"
              value={thread()?.title ?? ""}
              ref={(el) => setTimeout(() => el.select())}
              onBlur={(e) => commitRename(e.currentTarget)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename(e.currentTarget);
                if (e.key === "Escape") setRenaming(false);
              }}
            />
          }
        >
          <span class="pane-title" classList={{ empty: untitled(thread()) }} title={untitled(thread()) ? undefined : thread()!.title} onDblClick={() => !untitled(thread()) && setRenaming(true)}>{untitled(thread()) ? <span class="sr-only">{EMPTY_THREAD_NAME}</span> : thread()!.title}</span>
        </Show>
        <Show when={parent()}>
          <button type="button" class="origin-tag" title={`Laget av ${parent()!.title}`} onClick={() => showThread(parent()!.id)}>
            <IconBranch size={12} /><span>{parent()!.title}</span>
          </button>
        </Show>
        <Show when={!parent() && forkSource(thread())}>
          <button type="button" class="origin-tag" title={`Gaffel av ${forkSourceTitle(thread()!)}. Trykk for å åpne den.`} onClick={() => void openForkSource(thread()!)}>
            <IconBranch size={12} /><span>{forkSourceTitle(thread()!)}</span>
          </button>
        </Show>
        <Show when={thread()?.pendingApprovals && pending().length === 0}>
          <span class="badge pane-badge" title={STATE_LABEL.waiting}><IconWarn size={12} />{thread()!.pendingApprovals}</span>
        </Show>
        <span class="pane-spacer" />
        {/* Round 11 (SPEC 24.1): splitting, search, export and Løsriv are in the top bar, for the
            pane with focus. A pane has its own head only when there are several, and then only
            Lukk ruten, which belongs to this pane. */}
        <Show when={props.grid && props.grid.count() > 1}>
          <button type="button" class="icon-button pane-action" title="Lukk ruten" aria-label="Lukk ruten" onClick={() => props.grid!.close(props.pane.id)}><IconClose size={15} /></button>
        </Show>
        <Show when={props.solo && threadId()}>
          <button
            type="button"
            class="btn btn-small"
            onClick={() => {
              const id = threadId()!;
              sendReattach(id, thread() ? scopeOf(thread()!) : "chat");
              closeDetachedWindow(id);
              window.close();
            }}
          >
            Legg tilbake
          </button>
        </Show>
      </header>
      <div class="pane-body">
        <Show
          when={model() && (model()!.chunks().length > 0 || model()!.hasOlder())}
          fallback={<Home projectId={props.projectId} code={props.code || thread()?.mode === "code"} paneKey={threadId() ?? props.pane.id} onPick={(text) => fill?.(text)} />}
        >
          <Show when={model()} keyed>
            {(current) => <Conversation model={current} onThread={showThread} jump={(fn) => (toBottom = fn)} tools={(t) => paneTools.set(props.pane.id, t)} />}
          </Show>
        </Show>
      </div>
      <div class="pane-foot">
      <Show when={mod()?.widgets.length}><UiModBand mod={mod()!} workspace={props.projectId?app.projects[props.projectId]?.name??"Prosjekt":props.code?"Denne datamaskinen":"Chat"} usage={()=>model()?.usage()??null}/></Show>
      {/* Round 14 (SPEC 30.5): a missing folder replaces the message field (FolderMissingBar in Composer). */}
      <Show when={pending().length}>
        <div class="approval-dock" data-testid="approval-dock">
          <For each={pending()}>{(row) => <ApprovalCard row={row} />}</For>
        </div>
      </Show>
      <Show when={composerKey()} keyed>
        {(_key) => (
          <Composer
            paneKey={threadId() ?? props.pane.id}
            threadId={threadId}
            projectId={props.projectId}
            code={props.code || thread()?.mode === "code"}
            chatProjectId={threadId() ? thread()?.chatProjectId ?? null : (props.code ? null : chatProjectFor(props.pane.id))}
            autofocus={props.focused}
            onThreadCreated={(created) => {
              if (props.grid) props.grid.setThread(props.pane.id, created.id);
              else props.pane.setThreadId(created.id);
            }}
            onSent={() => toBottom?.()}
            registerFill={(fn) => (fill = fn)}
          />
        )}
      </Show>
      </div>
    </div>
  );
}
