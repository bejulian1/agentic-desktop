// Round 13 (SPEC 27.2): the tools of a chat. A button by + opens a small menu with a switch per
// tool, and the tools that are on stand as chips in the message field, each with × to turn it off.
// The choice belongs to the thread; a new chat starts with the defaults from Innstillinger → Chat.
// Nettsøk is dimmed, with the reason, when the model cannot search and no search page is set up.
import { createMemo, createResource, createSignal, For, Show, type Accessor, type JSX } from "solid-js";
import { CHAT_TOOL_IDS, chatToolsOf, webSearchRoute, type ChatToolId, type ChatTools, type WebSearchRoute } from "../../../shared/protocol";
import { get, patch } from "../lib/api";
import { app, modelFor, modelName, report, setSettingsOpen } from "../state/app";
import { IconArtifact, IconBookmark, IconClose, IconGlobe, IconTools } from "./icons";
import { IconLink } from "./nav-icons";
import { Popover } from "./Popover";

interface ChatPersonalState {
  personal: { memories: boolean; autoMemory: boolean };
}

export interface ChatToolState {
  tools: Accessor<ChatTools>;
  set: (id: ChatToolId, on: boolean) => void;
  route: Accessor<WebSearchRoute | null>;
  model: Accessor<string>;
  draft: Accessor<ChatTools | null>; // chosen before the chat exists, for when it is made
}

// threadId and modelId as the composer knows them; before the first message there is no thread.
export function useChatTools(threadId: Accessor<string | null>, modelId: Accessor<string | null>): ChatToolState {
  const [draft, setDraft] = createSignal<ChatTools | null>(null);
  const thread = () => {
    const id = threadId();
    return id ? app.threads[id] : undefined;
  };
  const tools = createMemo(() => (thread() ? chatToolsOf(thread(), app.settings) : (draft() ?? chatToolsOf(undefined, app.settings))));
  const route = createMemo(() => {
    const model = modelFor(modelId() ?? app.settings.defaultModelId);
    const kind = model ? app.providers.find((p) => p.id === model.providerId)?.kind : undefined;
    return webSearchRoute(model, kind, app.settings);
  });
  const set = (id: ChatToolId, on: boolean) => {
    const current = thread();
    if (current) {
      patch(`/api/threads/${current.id}`, { chatTools: { [id]: on } }).catch(report);
      return;
    }
    setDraft({ ...tools(), [id]: on });
  };
  return { tools, set, route, model: () => modelName(modelId() ?? app.settings.defaultModelId), draft };
}

interface ToolInfo {
  id: ChatToolId;
  name: string;
  icon: (p: { size?: number }) => JSX.Element;
}

const TOOLS: ToolInfo[] = [
  { id: "web", name: "Nettsøk", icon: IconGlobe },
  { id: "fetch", name: "Les nettsider", icon: IconLink }, // a link: it reads the address you paste (SPEC 28)
  { id: "artifacts", name: "Artifacts", icon: IconArtifact },
  { id: "memory", name: "Minne", icon: IconBookmark },
];

const ROUTE_TEXT: Record<WebSearchRoute, string> = {
  provider: "Med leverandørens eget nettsøk",
  browser: "Appens nettleser søker på søkesiden din",
  demo: "Demo-kilder, tydelig merket",
};

export function ChatToolButton(props: { state: ChatToolState }) {
  const [open, setOpen] = createSignal(false);
  // Read when the menu opens: whether Chat memories are on, and whether new ones are saved.
  const [personal] = createResource(open, () => get<ChatPersonalState>("/api/chat-personal").catch(() => null));
  const memoriesOff = () => personal()?.personal.memories === false;
  const anyOn = () => CHAT_TOOL_IDS.some((id) => props.state.tools()[id]);
  let menu: HTMLDivElement | undefined;

  const describe = (id: ChatToolId): { text: string; off?: string } => {
    switch (id) {
      case "web": {
        const route = props.state.route();
        return route ? { text: ROUTE_TEXT[route] } : { text: "", off: `${props.state.model()} har ikke eget nettsøk, og ingen søkeside er satt opp i Innstillinger → Chat` };
      }
      case "fetch":
        return { text: "Leser en adresse du limer inn" };
      case "artifacts":
        return { text: "Små HTML-programmer i chatten" };
      case "memory":
        if (memoriesOff()) return { text: "", off: "Slått av i Chat-personalisering" };
        return { text: personal()?.personal.autoMemory ? "Bruker og oppdaterer Chat-minnene" : "Bruker Chat-minnene dine" };
    }
  };

  const keys = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <Popover
      open={open()}
      onClose={() => setOpen(false)}
      trigger={
        <button
          type="button"
          class="foot-icon tools-button"
          data-on={anyOn() ? "" : undefined}
          data-testid="chat-tools-button"
          title="Verktøy for denne chatten: nettsøk, nettsider, artifacts og minne"
          aria-label="Verktøy"
          aria-haspopup="menu"
          aria-expanded={open()}
          onClick={() => setOpen(!open())}
        >
          <IconTools size={17} />
        </button>
      }
    >
      <div
        class="menu-list chat-tools-menu"
        role="menu"
        aria-label="Verktøy"
        ref={(el) => {
          menu = el;
          requestAnimationFrame(() => el.querySelector<HTMLElement>('[role="menuitemcheckbox"]:not([aria-disabled="true"])')?.focus());
        }}
        onKeyDown={keys}
      >
        <div class="menu-heading">Verktøy i denne chatten</div>
        <For each={TOOLS}>
          {(tool) => {
            const info = createMemo(() => describe(tool.id));
            const disabled = () => !!info().off;
            const on = () => !disabled() && props.state.tools()[tool.id];
            const Icon = tool.icon;
            return (
              <button
                type="button"
                role="menuitemcheckbox"
                class="menu-item menu-item-tall chat-tool-item"
                aria-checked={on()}
                aria-disabled={disabled() ? "true" : undefined}
                data-tool={tool.id}
                title={info().off ?? undefined}
                onClick={() => !disabled() && props.state.set(tool.id, !props.state.tools()[tool.id])}
              >
                <Icon size={15} />
                <span class="menu-stack">
                  <span class="menu-name">{tool.name}</span>
                  <span class="menu-desc chat-tool-why">{info().off ?? info().text}</span>
                </span>
                <span class="chat-tool-switch" aria-hidden="true" />
              </button>
            );
          }}
        </For>
        <div class="chat-tools-foot">
          Gjelder denne chatten. Standard for nye chatter:{" "}
          <button type="button" onClick={() => { setOpen(false); setSettingsOpen("chat"); }}>Innstillinger → Chat</button>
        </div>
      </div>
    </Popover>
  );
}

// The tools that are on, as chips. × turns one off for this chat.
export function ChatToolChips(props: { state: ChatToolState }) {
  const on = createMemo(() => TOOLS.filter((t) => props.state.tools()[t.id] && !(t.id === "web" && !props.state.route())));
  return (
    <Show when={on().length}>
      <span class="tool-chips" role="group" aria-label="Verktøy som er på" data-testid="tool-chips">
        <For each={on()}>
          {(tool) => {
            const Icon = tool.icon;
            return (
              <span class="tool-chip" data-tool={tool.id} title={`${tool.name} er på i denne chatten`}>
                <Icon size={13} />
                <span class="tool-chip-name sr-only">{tool.name}</span>
                <button type="button" class="tool-chip-x" aria-label={`Slå av ${tool.name}`} title={`Slå av ${tool.name}`} onClick={() => props.state.set(tool.id, false)}>
                  <IconClose size={11} />
                </button>
              </span>
            );
          }}
        </For>
      </span>
    </Show>
  );
}
