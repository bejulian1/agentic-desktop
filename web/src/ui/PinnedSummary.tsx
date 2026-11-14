// A compact summary of the focused Code thread, anchored in the top bar.
// File counts come from recorded changes; terminals belong to the displayed project.
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { Attachment, SummaryTurnChanges, Thread } from "../../../shared/protocol";
import { app, currentProject, report, settingsOpen } from "../state/app";
import { openThread } from "../state/navigate";
import { peekPanelActions, showPanel } from "../state/panel";
import { Popover } from "./Popover";
import { on as onMessage } from "../lib/socket";
import "../styles/pinned-summary.css";
import { loadModel, peekModel, retainModel, type ThreadModel } from "../state/thread-model";
import { GoalLine } from "./Goal";
import { IconAgent, IconAt, IconBookmark, IconChevron, IconClose, IconFile, IconFolder, IconImage, IconList, IconPin, IconTerminal } from "./icons";
import { imageUrl, showImage } from "./rows";
import { jumpToMessage } from "./Conversation";
import { get, patch } from "../lib/api";

function excerpt(text: string, max = 160): string {
  const plain = text.replace(/```[\s\S]*?```/g, " ").replace(/[#*_`>|-]+/g, " ").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

const SHOWN = 5;

function Section(props: { title: string; testid: string; children: any }) {
  return (
    <section class="pinned-section" data-testid={props.testid}>
      <h3 class="pinned-label">{props.title}</h3>
      {props.children}
    </section>
  );
}

export function PinnedSummary(props: { thread?: Thread }) {
  const [open, setOpen] = createSignal(false);
  const [model, setModel] = createSignal<ThreadModel | null>(null);
  const project = () => props.thread?.projectId ? app.projects[props.thread.projectId] : props.thread ? undefined : currentProject();
  const projectId = () => project()?.id ?? "local";
  const identity = () => `${props.thread?.id ?? "new"}:${projectId()}`;
  let previous = identity();
  createEffect(() => {
    const next = identity();
    const inSettings = settingsOpen();
    if (previous !== next || inSettings) setOpen(false);
    previous = next;
  });
  // Pane loading and this loading share the model cache. Keep it only while the card is open.
  createEffect(() => {
    const id = props.thread?.id;
    if (!open() || !id) return setModel(null);
    let current = true;
    let release: (() => void) | undefined;
    const ready = peekModel(id);
    if (ready) { setModel(ready); release = retainModel(ready); }
    else void loadModel(id).then((value) => {
      if (!current) return;
      setModel(value);
      release = retainModel(value);
    }).catch(report);
    onCleanup(() => { current = false; release?.(); });
  });
  let trigger: HTMLButtonElement | undefined;
  const close = () => setOpen(false);
  const closeAndFocus = () => { close(); trigger?.focus({ preventScroll: true }); };
  const run = (action: () => unknown) => { close(); void action(); };
  interface Terminal { terminalId: string; title: string; exited: boolean }
  const [terminals, setTerminals] = createSignal<Terminal[]>([]);
  const [terminalState, setTerminalState] = createSignal<"loading" | "ready" | "error">("loading");
  let reloadTerminals: (() => void) | undefined;
  createEffect(() => {
    if (!open()) return;
    const id = projectId();
    setTerminals([]);
    setTerminalState("loading");
    let current = true;
    let sequence = 0;
    const refresh = async () => {
      const request = ++sequence;
      try {
        const value = await get<Terminal[]>(`/api/projects/${id}/terminals`);
        if (!current || request !== sequence) return;
        setTerminals(value.filter((terminal) => !terminal.exited));
        setTerminalState("ready");
      } catch {
        if (current && request === sequence) setTerminalState("error");
      }
    };
    reloadTerminals = () => void refresh();
    void refresh();
    const offs = [
      onMessage("terminal.opened", (message) => { if (message.projectId === id) void refresh(); }),
      onMessage("terminal.exit", () => void refresh()),
    ];
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 10_000);
    onCleanup(() => { current = false; offs.forEach((off) => off()); clearInterval(timer); reloadTerminals = undefined; });
  });
  const [changes, setChanges] = createSignal<SummaryTurnChanges[]>([]);
  const [changesState, setChangesState] = createSignal<"loading" | "ready" | "error">("loading");
  let reloadChanges: (() => void) | undefined;
  createEffect(() => {
    if (!open()) return;
    const id = props.thread?.id;
    setChanges([]);
    setChangesState(id ? "loading" : "ready");
    if (!id) return;
    let current = true;
    let sequence = 0;
    const refresh = async () => {
      const request = ++sequence;
      try {
        const value = await get<SummaryTurnChanges[]>(`/api/threads/${id}/summary-changes`);
        if (!current || request !== sequence) return;
        setChanges(value);
        setChangesState("ready");
      } catch {
        if (current && request === sequence) setChangesState("error");
      }
    };
    reloadChanges = () => void refresh();
    void refresh();
    const off = onMessage("thread.event", ({ envelope }) => {
      if (envelope.threadId === id && ["turn.changes", "turn.reverted"].includes(envelope.event.type)) void refresh();
    });
    onCleanup(() => { current = false; off(); reloadChanges = undefined; });
  });
  const rows = createMemo(() => {
    void props.thread?.updatedAt; // Recount when a run ends.
    return model()?.chunks().flatMap((chunk) => chunk.rows()) ?? [];
  });
  const stats = createMemo(() => {
    let messages = 0;
    let tools = 0;
    let last = "";
    const sources = new Map<string, Attachment>();
    for (const row of rows()) {
      if (row.kind === "user") {
        messages += 1;
        for (const a of row.attachments ?? []) sources.set(a.imageId ?? a.threadId ?? a.path ?? a.label, a);
      } else if (row.kind === "steps") tools += row.items().filter((i) => i.kind === "tool").length;
      else if (row.kind === "tool") tools += 1;
      else if (row.kind === "text" && row.text.trim()) last = row.text;
    }
    return { messages, tools, last: excerpt(last), sources: [...sources.values()] };
  });
  // The last change to each file, newest first. Reverted turns do not count.
  const results = createMemo(() => {
    const files = new Map<string, { path: string; change: string; additions: number; deletions: number; approximate: boolean; binary: boolean; text: boolean; turnId: string }>();
    for (const turn of changes()) {
      if (turn.reverted) continue;
      for (const file of turn.files) {
        const seen = files.get(file.path);
        files.delete(file.path);
        files.set(file.path, {
          path: file.path,
          change: seen?.change === "added" && file.change !== "deleted" ? "added" : file.change,
          additions: (seen?.additions ?? 0) + (file.binary ? 0 : file.additions),
          deletions: (seen?.deletions ?? 0) + (file.binary ? 0 : file.deletions),
          approximate: !!seen?.approximate || (!file.binary && file.countsExact !== true),
          binary: !!seen?.binary || file.binary === true,
          text: !!seen?.text || !file.binary,
          turnId: turn.turnId,
        });
      }
    }
    return [...files.values()].reverse();
  });
  const children = createMemo(() => Object.values(app.threads).filter((t) => t && props.thread && t.parentThreadId === props.thread.id && t.origin === "agent" && !t.archived).sort((a, b) => a.createdAt - b.createdAt));
  const childStatus = () => {
    const done = children().filter((t) => !t.running && t.lastStatus === "done").length;
    const running = children().filter((t) => t.running).length;
    return [done ? `${done} ${done === 1 ? "ferdig" : "ferdige"}` : "", running ? `${running} kjører` : ""].filter(Boolean).join(" · ") || "Venter";
  };
  const totals = createMemo(() => results().reduce((sum, file) => ({
    additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions,
    approximate: sum.approximate || file.approximate, binary: sum.binary || file.binary, text: sum.text || file.text,
  }), { additions: 0, deletions: 0, approximate: false, binary: false, text: false }));
  const [allFiles, setAllFiles] = createSignal(false);
  const [allSources, setAllSources] = createSignal(false);

  return (
    <Popover
      open={open() && !settingsOpen()} onClose={close} align="right" below fixed portal returnFocus class="code-summary-anchor"
      trigger={<button type="button" class="icon-button pinned-head" ref={trigger} data-testid="pinned-summary" aria-label="Festet sammendrag" title="Festet sammendrag" aria-haspopup="dialog" aria-expanded={open()} onClick={() => setOpen(!open())}><IconPin /></button>}
    >
      <section class="code-summary" role="dialog" aria-label="Festet sammendrag" tabindex="-1" ref={(element) => queueMicrotask(() => element.focus({ preventScroll: true }))}>
        <header class="code-summary-head">
          <span title={project()?.path}>{project()?.name ?? "Denne datamaskinen"}</span>
          <button type="button" class="icon-button" aria-label="Lukk sammendrag" onClick={closeAndFocus}><IconClose size={14} /></button>
        </header>
        <button type="button" class="code-summary-row" data-testid="changes-chip" disabled={!results().length} title="Endringer i tråden" onClick={() => run(() => { peekPanelActions().showTurn(results()[0].turnId); })}>
          <IconFile size={15} /><span class="code-summary-name">Endringer</span>
          <Show when={results().length} fallback={<span class="code-summary-meta">{changesState() === "loading" ? "Henter endringer…" : changesState() === "error" ? "Kunne ikke hente" : "Ingen endringer"}</span>}>
            <Show when={totals().text}>
              <Show when={totals().approximate}><span title="Anslåtte linjetall">≈</span></Show>
              <span class="diff-add">+{totals().additions}</span><span class="diff-del">−{totals().deletions}</span>
            </Show>
            <Show when={totals().binary}><span class="code-summary-meta" title="Binærfiler er ikke med i linjetallene">binærfil</span></Show>
            <span class="code-summary-meta">· {results().length} {results().length === 1 ? "fil" : "filer"}</span>
          </Show>
        </button>
        <Show when={changesState() === "error"}><button type="button" class="pinned-more" onClick={() => reloadChanges?.()}>Hent endringene på nytt</button></Show>
        <section class="code-summary-section" data-testid="pinned-agents">
          <h3>Underagenter</h3>
          <Show when={children().length} fallback={<p class="code-summary-empty">Ingen underagenter i tråden.</p>}>
            <p class="pinned-agents-line"><span class="agents-faces" aria-hidden="true"><For each={children().slice(0, 4)}>{(_, i) => <span class="agent-face" data-tone={i() % 3}><IconAgent size={13} /></span>}</For></span>{childStatus()}</p>
            <ul class="pinned-list"><For each={children()}>{(child) => <li><button type="button" class="pinned-item" onClick={() => run(() => openThread(child))}><IconAgent size={14} /><span class="pinned-item-text">{child.title}</span><span class="pinned-item-meta">{child.running ? "kjører" : child.lastStatus === "done" ? "ferdig" : child.lastStatus === "error" ? "feilet" : child.lastStatus ? "stoppet" : "venter"}</span></button></li>}</For></ul>
          </Show>
        </section>
        <section class="code-summary-section" data-testid="pinned-terminals">
          <h3>Bakgrunnsprosesser</h3>
          <p class="code-summary-scope">Terminaler i {project()?.name ?? "Denne datamaskinen"}</p>
          <Show when={terminalState() !== "error"} fallback={<><p class="code-summary-empty" role="status">Kunne ikke hente terminalene.</p><button type="button" class="pinned-more" onClick={() => reloadTerminals?.()}>Prøv igjen</button></>}>
            <Show when={terminalState() === "ready"} fallback={<p class="code-summary-empty" role="status">Henter terminaler…</p>}>
              <Show when={terminals().length} fallback={<p class="code-summary-empty">Ingen åpne bakgrunnsterminaler.</p>}>
                <button type="button" class="code-summary-row" onClick={() => run(() => showPanel("terminal"))}><IconTerminal size={15} /><span class="code-summary-name">Bakgrunnsterminal{terminals().length > 1 ? "er" : ""}</span><span class="code-summary-meta">{terminals().length} åpne</span></button>
              </Show>
            </Show>
          </Show>
        </section>
        <Show when={props.thread}>
          {(thread) => <details class="code-summary-details">
            <summary>Mål, plan og resultater<IconChevron size={12} /></summary>
            <div class="pinned-body">
          <Section title="Mål" testid="pinned-goal-section">
            <Show when={thread().goal} fallback={<p class="pinned-empty">Ingen mål ennå. Skriv /goal og målet i meldingsfeltet.</p>}>
              <GoalLine thread={thread()} variant="pinned" />
            </Show>
          </Section>
          <Show when={thread().plan}>
            <div class="pinned-plan">
              <span class="pinned-label"><IconList size={12} />Plan</span>
              <p>{excerpt(thread().plan!, 400)}</p>
            </div>
          </Show>
          <Show when={thread().chapters.length}>
            <Section title="Kapitler" testid="pinned-chapters">
              <ul class="pinned-list">
                <For each={thread().chapters}>
                  {(chapter) => (
                    <li class="pinned-chapter">
                      <button type="button" class="pinned-item" title="Gå til kapittelet" onClick={() => run(() => jumpToMessage(thread().id, chapter.messageId))}>
                        <IconBookmark size={14} />
                        <span class="pinned-item-text">{chapter.title}</span>
                      </button>
                      <button
                        type="button"
                        class="goal-button"
                        title={`Fjern kapittelet «${chapter.title}»`}
                        aria-label={`Fjern kapittelet ${chapter.title}`}
                        onClick={() => patch(`/api/threads/${thread().id}`, { chapter: { messageId: chapter.messageId, title: null } }).catch(report)}
                      >
                        <IconClose size={12} />
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Section>
          </Show>
          <Section title="Resultater" testid="pinned-results">
            <Show when={results().length} fallback={<p class="pinned-empty">Ingen filer laget eller endret ennå.</p>}>
              <ul class="pinned-list">
                <For each={allFiles() ? results() : results().slice(0, SHOWN)}>
                  {(file) => (
                    <li>
                      <button type="button" class="pinned-item" title={file.path} onClick={() => run(() => peekPanelActions().showTurn(file.turnId))}>
                        <IconFile size={14} />
                        <span class="pinned-item-text">{file.path}</span>
                        <span class="pinned-item-meta">{file.change === "added" ? "ny" : file.change === "deleted" ? "slettet" : ""}</span>
                        <Show when={file.approximate}><span title="Anslåtte linjetall">≈</span></Show>
                        <Show when={file.text}><span class="diff-add">+{file.additions}</span><span class="diff-del">−{file.deletions}</span></Show>
                        <Show when={file.binary}><span class="pinned-item-meta">binærfil</span></Show>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
              <Show when={results().length > SHOWN}>
                <button type="button" class="pinned-more" onClick={() => setAllFiles(!allFiles())}>{allFiles() ? "Vis færre" : `Vis alle ${results().length}`}</button>
              </Show>
            </Show>
          </Section>
          <Section title="Kilder" testid="pinned-sources">
            <Show when={stats().sources.length} fallback={<p class="pinned-empty">Ingen vedlegg ennå. Legg ved bilder med + eller filer med @.</p>}>
              <ul class="pinned-list">
                <For each={allSources() ? stats().sources : stats().sources.slice(0, SHOWN)}>
                  {(source) => (
                    <li>
                      <Show
                        when={source.kind === "image" && source.imageId}
                        fallback={
                          <span class="pinned-item static" title={source.path ?? source.label}>
                            {source.kind === "thread" ? <IconAt size={14} /> : source.kind === "dir" ? <IconFolder size={14} /> : <IconFile size={14} />}
                            <span class="pinned-item-text">{source.label}</span>
                          </span>
                        }
                      >
                        <button type="button" class="pinned-item" onClick={() => showImage(imageUrl(source.imageId!), source.label)}>
                          <IconImage size={14} />
                          <span class="pinned-item-text">{source.label}</span>
                        </button>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
              <Show when={stats().sources.length > SHOWN}>
                <button type="button" class="pinned-more" onClick={() => setAllSources(!allSources())}>{allSources() ? "Vis færre" : `Vis alle ${stats().sources.length}`}</button>
              </Show>
            </Show>
          </Section>
          <p class="pinned-stats">
            {model()?.hasOlder() ? "I lastet samtale: " : ""}{stats().messages} {stats().messages === 1 ? "melding" : "meldinger"} · {stats().tools} verktøykall · {results().length} {results().length === 1 ? "fil" : "filer"} endret
          </p>
          <Show when={stats().last}><p class="pinned-last"><span class="pinned-label">Siste svar</span> {stats().last}</p></Show>
            </div>
          </details>}
        </Show>
      </section>
    </Popover>
  );
}
