// Contract between server and web. Change it here first, then on both sides.

export type Mode = "chat" | "code";
export type ThemeSetting = "light" | "dark" | "system";
// Round 8 (agent G): a colour theme on top of light/dark. Each one has a light and a dark variant,
// so Lys, Mørk and System still choose which. "standard" is the app's own palette.
export const THEME_PRESETS = ["standard", "kontrast", "varm", "kald", "fjord", "solbleket"] as const;
export type ThemePreset = (typeof THEME_PRESETS)[number];
export type PermissionMode = "ask" | "accept-edits" | "full";
export type ProviderKind = "openai-compatible" | "anthropic" | "mock";
export type ToolStatus = "pending" | "awaiting-approval" | "running" | "done" | "error" | "denied" | "cancelled";
export type RunStatus = "running" | "done" | "stopped" | "error" | "interrupted";
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max"; // none: no thinking (round 9)

export interface SummaryTurnChanges {
  turnId: string;
  files: ChangedFile[];
  reverted: boolean;
}

export interface QueueSnapshot {
  seq: number;
  items: Array<{ messageId: string; text: string; from?: ThreadRef; attachments?: Attachment[]; steer: boolean; editable: boolean; steerable?: boolean }>;
}

// OpenRouter accepts its own reasoning object; other compatible servers retain the conservative scale.
export function isOpenRouter(baseUrl?: string): boolean {
  try { return new URL(baseUrl ?? "").hostname === "openrouter.ai"; } catch { return false; }
}
export const EFFORT_STEPS: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh", "max"];
export function effortSteps(kind: ProviderKind | undefined, model?: Pick<ModelConfig, "thinking">, baseUrl?: string): ReasoningEffort[] {
  if (kind === "anthropic") return model?.thinking === false ? EFFORT_STEPS.filter((step) => step !== "none") : EFFORT_STEPS;
  if (kind === "mock") return EFFORT_STEPS;
  if (kind === "openai-compatible" && isOpenRouter(baseUrl)) return EFFORT_STEPS.filter((step) => step !== "none");
  if (kind === "openai-compatible") return ["low", "medium", "high"];
  return [];
}

// Words are separated by whitespace, consistently in the editor and on the server.
export const MAX_CHAT_WORDS = 10_000;
export const MAX_CHAT_FIELD = 200_000; // secondary bound for unusually long words and pasted data
export const countChatWords = (text: string): number => text.match(/\S+/gu)?.length ?? 0;
export function truncateChatField(text: string): string {
  const bounded = text.slice(0, MAX_CHAT_FIELD);
  let words = 0;
  for (const match of bounded.matchAll(/\S+/gu)) {
    if (++words > MAX_CHAT_WORDS) return bounded.slice(0, match.index).trimEnd();
  }
  return bounded;
}

export interface BuildInfo {
  name: "Agentic Desktop";
  version: string;
  build: number;
  builtAt: string;
  signature: "Code Pro";
}

export interface Project {
  id: string;
  name: string;
  path: string;
  permissionMode: PermissionMode;
  createdAt: number;
  lastUsedAt: number;
  color: string | null; // id from PROJECT_COLORS
  icon: string | null; // id from PROJECT_ICONS
  defaultModelId: string | null; // for new threads in the project
  pinned: boolean; // shown under Festede prosjekter in the sidebar
  folderMissing?: boolean; // round 9: the folder is gone or moved; set only when true, checked on every read
}

export interface GitWorkspaceState {
  repository: boolean;
  root: string;
  commonDir: string | null;
  branch: string | null;
  detached: boolean;
  hasCommits: boolean;
  dirty: boolean;
  branches: string[];
  worktrees: Array<{ path: string; branch: string | null; detached: boolean; locked: boolean; prunable: boolean }>;
  suggestedParent: string;
  message?: string;
}

// Round 9 (SPEC 21.2): a project in Chat, to gather chats. It has no folder on disk, so it is not a
// Project at all: tools for files and commands only ever see Project, and never this.
export interface ChatProject {
  id: string;
  name: string;
  color: string | null; // id from PROJECT_COLORS
  icon: string | null; // id from PROJECT_ICONS, or "emoji:…"
  pinned: boolean;
  createdAt: number;
  lastUsedAt: number;
}

// Round 11 (SPEC 24.6): a named section in the sidebar, made with ⋯ → Ny seksjon. Threads are put in
// it by dragging or from the thread menu, and only threads of its own mode. Deleting it leaves the
// threads where they were before.
export interface SidebarSection {
  id: string;
  name: string;
  mode: Mode;
  position: number; // lower first
  createdAt: number;
}

export const PROJECT_COLORS: Array<{ id: string; label: string; value: string }> = [
  { id: "orange", label: "Oransje", value: "#c8663a" },
  { id: "red", label: "Rød", value: "#c2453d" },
  { id: "yellow", label: "Gul", value: "#b8860b" },
  { id: "green", label: "Grønn", value: "#3a8a5c" },
  { id: "teal", label: "Blågrønn", value: "#2f8a8a" },
  { id: "blue", label: "Blå", value: "#3b6fc4" },
  { id: "purple", label: "Lilla", value: "#8259b8" },
  { id: "gray", label: "Grå", value: "#7a766e" },
];

export const PROJECT_ICONS = ["folder", "code", "globe", "terminal", "spark", "game", "branch", "team",
  // v0.5: the icon picker in Rediger prosjekt.
  "dollar", "book", "school", "pencil", "pen", "braces", "music", "cup", "brush", "palette", "health", "flower", "bag", "chart",
  "dumbbell", "notes", "scale", "planet", "plane", "wrench", "paw", "flask", "brain", "heart", "gift", "rocket", "camera", "home",
  "star", "bug", "database", "lock", "leaf", "puzzle", "cloud", "map"];

// A project icon is an id from PROJECT_ICONS, or "emoji:" and one short emoji.
export function isProjectIcon(icon: string): boolean {
  if (PROJECT_ICONS.includes(icon)) return true;
  const emoji = icon.startsWith("emoji:") ? icon.slice(6) : "";
  return emoji.length > 0 && emoji.length <= 16 && /^\p{Extended_Pictographic}/u.test(emoji) && !/[\s<>"'&]/.test(emoji);
}

export interface ProjectConfig {
  global: GlobalConfig;
  project: { dir: string; agentsMd: string | null; settings: GlobalConfig["settings"]; settingsError?: string };
  effective: GlobalConfig["settings"];
  instructionFiles: string[]; // what the model reads, in order
}

export interface Thread {
  promptHistoryReady?: boolean; // at least two earlier answered user turns; server-computed
  id: string;
  projectId: string | null;
  mode: Mode;
  title: string;
  modelId: string | null;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  running: boolean;
  parentThreadId: string | null; // the thread that created this one
  origin: "user" | "agent";
  permissionCap: PermissionMode | null; // never runs above this, set on agent-made threads
  pendingApprovals: number; // for the badge in the sidebar
  // Per-thread choices made with /goal, /plan, /reasoning and /personality.
  goal: string | null;
  // How long the goal has run: goalElapsedMs plus now - goalResumedAt while not paused.
  goalSetAt: number | null;
  goalResumedAt: number | null; // start of the current running stretch, null while paused
  goalPausedAt: number | null;
  goalElapsedMs: number; // finished stretches
  chapters: Chapter[]; // messages pinned as chapters, in the timeline map and the pinned summary
  planMode: boolean; // read-only tools, and the model is asked for a plan
  plan: string | null; // the last answer given in plan mode
  reasoning: ReasoningEffort | null; // overrides the model's effort
  personality: string | null; // id from PERSONALITIES
  lastStatus: RunStatus | null; // how the last run ended, for the sidebar
  pinned?: boolean; // shown under Festet in the sidebar
  snoozedUntil?: number | null; // Utsatt in the smart sidebar until this time
  temporary?: boolean; // Chat: not in the history, deleted when closed or after a while idle
  chatProjectId?: string | null; // round 9: Chat only, the ChatProject it is gathered in
  sectionId?: string | null; // round 11: the SidebarSection it is put in, set only when it is in one
  chatTools?: ChatTools | null; // round 13 (SPEC 27.2): Chat only, the tools chosen in this thread; unset follows Settings.chatTools
  forkedFrom?: ForkOrigin; // round 14 (SPEC 30.3): set on a fork, the thread it came from
}

// Round 14 (SPEC 30.3): where a fork came from. The title is the source's title when the fork was
// made, for when the source is deleted later. messageId: forked from that message; null: from the
// whole thread or from its last message (from says which).
export interface ForkOrigin {
  threadId: string;
  title: string;
  messageId: string | null;
  from: "message" | "last" | "whole";
}

// A message given a name, so it can be found again. messageId is the row's key in the thread.
export interface Chapter {
  messageId: string;
  title: string;
}

export const PERSONALITIES: Array<{ id: string; label: string; prompt: string }> = [
  { id: "standard", label: "Standard", prompt: "" },
  { id: "kort", label: "Kort", prompt: "Be brief. Answer in as few words as the task allows." },
  { id: "grundig", label: "Grundig", prompt: "Be thorough. Explain your reasoning and mention trade-offs." },
  { id: "vennlig", label: "Vennlig", prompt: "Be warm and encouraging, and explain things in plain words." },
  { id: "lærer", label: "Lærer", prompt: "Teach as you go: explain why, and suggest what the user can try next." },
];

export interface ModelConfig {
  id: string;
  providerId: string;
  name: string;
  model: string;
  contextWindow: number;
  inputPricePerMTok?: number;
  outputPricePerMTok?: number;
  // Optional tuning. Left out means the provider default.
  maxOutputTokens?: number;
  supportsImages?: boolean; // openai-compatible only; anthropic always sends images
  thinking?: boolean; // anthropic only; default true, set false for models without adaptive thinking
  effort?: ReasoningEffort; // anthropic output_config.effort, openai-compatible reasoning_effort
  webSearch?: boolean; // round 13: the provider's own web search; default on for anthropic, off for openai-compatible
}

// The key itself never leaves the server.
export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  hasKey: boolean;
}

export interface Settings {
  promptAutocompleteModelId?: string | null; // null follows the conversation model
  promptAutocomplete?: boolean; // opt-in model-backed prompt suggestions, default off
  theme: ThemeSetting;
  defaultModelId: string | null;
  defaultPermissionMode: PermissionMode;
  autoOpenAgentThreads: boolean; // open threads made by an agent in a new pane
  autoCompact?: boolean; // shorten old context automatically, default true; manual /compact is always available
  maxStepsPerTurn?: number; // model/tool loop steps in a turn, default 50; see shared bounds below
  modelContext?: ModelContextSettingsPatch; // optional context, independently configured for Chat and Kode
  shortcuts?: Record<string, string>; // rebinds, shortcut id to keys like "Mod+J"
  profileName?: string; // the profile card in Settings → Profil
  memories?: boolean; // the model saves and loads memories (MEMORY.md files), default true; false is no saving and no loading
  alwaysOnTop?: boolean; // placeholder for the Electron version
  artifactPreview?: boolean; // open a new artifact in the panel when the model has written it, default true
  homeStats?: boolean; // the statistics card on the start page, default true
  thinkingSummary?: boolean; // show the model's thinking summary in the thread, when it has one; default true
  thinkingView?: "standard" | "premium"; // round 10 (SPEC 23.11): how thinking looks in Chat; default "standard"
  expandShell?: boolean; // shell tool output starts expanded in the thread; default false
  sidebarLayout?: "standard" | "smart"; // smart: thread cards for what needs you, default "standard"
  sidebarCollapsed?: "rail" | "hidden"; // round 10 (SPEC 23.9): a hidden sidebar is a thin row of icons, or gone; default "rail"
  downloadDir?: string; // where the Browser panel saves downloads, an absolute path; unset is the default folder
  // Round 12 (SPEC 26.4): imported cookies. Left out means the default noted on each line.
  browserAskSignedIn?: boolean; // ask before an agent acts on a site with imported cookies, default true
  cookieOffer?: "never" | "done"; // the cookie dialog the first time the Browser panel opens: never again, or imported; unset offers it
  // Round 5, Innstillinger. Left out means the default noted on each line; null in a PATCH resets.
  startMode?: StartMode; // the mode the app opens in, default "last"
  startConversation?: "new" | "resume"; // default new; reload and explicit detached-thread links keep their view
  panelTabLayout?: "unified" | "grouped"; // default unified: sessions share the tool tab row
  panelNewTab?: "tools" | "browser"; // + creates a tool start-page tab or a browser tab; default tools
  notifyOnDone?: TurnNotify; // a system notification when a turn ends, default "off"
  soundOnDone?: boolean; // a short sound when a turn ends, default false
  confirmQuit?: boolean; // ask before the tab closes while a thread runs, default false
  accent?: AccentColor; // default "blue"
  uiFontSize?: number; // 13-16 px, the base text size, default 14
  codeFontSize?: number; // 11-18 px, code blocks and tool output, default as in the stylesheet
  density?: Density; // default "normal"
  reduceMotion?: boolean; // no animations even when the system allows them, default false
  codeFont?: CodeFont; // default "system", the stylesheet's monospace stack
  codeFontCustom?: string; // optional installed font family, no download; empty follows codeFont
  codeThemeLight?: "app" | "clear" | "warm" | "contrast";
  codeThemeDark?: "app" | "clear" | "warm" | "contrast";
  codeTranscriptView?: "normal" | "thinking" | "detailed"; // default folds when code rows mount; Chat independent
  tabSize?: number; // 2, 4 or 8, for code in the thread, default 4
  wrapCode?: boolean; // wrap long lines in code blocks instead of scrolling, default false
  // Round 6, agent E: skills and messages sent while a run is active.
  autoSkills?: AutoSkills; // what propose_skill does, default "ask"
  disabledSkills?: string[]; // skill folders (absolute paths) the agent does not see
  busyMessages?: BusyMessages; // a message sent while the agent works: queued until the turn ends, or steered into it; default "queue"
  themePreset?: ThemePreset; // round 8: colour theme, default "standard"
  // Round 9 (SPEC 21.1): the Kode start page. Left out means the default.
  // Round 11b (SPEC 25.2): replaced by codeStart. Still read, and moved over: greeting is Tekst (Middels), cards is Prosjektboks.
  codeStartEmpty?: CodeStartEmpty; // without a project, default "greeting"
  codeStartProject?: CodeStartProject; // with a project, default "cards"
  codeStart?: CodeStart; // round 11b (SPEC 25.2): the Kode start page, with and without a project; default "text"
  codeStartSize?: CodeStartSize; // round 11b: the size of the mark and the question with Tekst; default "medium"
  enterKey?: EnterKey; // round 9 (SPEC 21.8): what Enter does in the message field, default "send"
  // Round 11 (SPEC 24.2 and 24.3), Innstillinger → Utseende.
  panelButtons?: PanelButtons; // the panel buttons at the top right, default "together" (Samlet)
  panelStart?: PanelStart; // the side panel: a start page with tools, or tabs at the top; default "tools"
  // Round 13 (SPEC 27.2), Innstillinger → Chat.
  chatTools?: ChatTools; // the tools a new chat starts with, default DEFAULT_CHAT_TOOLS
  webSearchUrl?: string; // the search page the app's own browser opens when the model has no web search of its own; {q} is the query
  // Round 14 (SPEC 30.2), Innstillinger → Utseende: the app's icon, for the window, the status area,
  // the browser tab and (installed with install-local) the app library. Default "boble".
  appIcon?: AppIconId;
}

export interface ModelContextModeSettings {
  dateTime: boolean;
  model: boolean;
  location: boolean;
  locationText: string;
  locationSource: "manual" | "ip";
  locationUpdatedAt?: string;
}
export type ModelContextModePatch = Partial<Omit<ModelContextModeSettings, "locationUpdatedAt">> & { locationUpdatedAt?: string | null };
export type ModelContextSettingsPatch = Partial<Record<Mode, ModelContextModePatch>>;
export const MAX_MODEL_CONTEXT_LOCATION = 160;
export const DEFAULT_MODEL_CONTEXT: Readonly<ModelContextModeSettings> = Object.freeze({
  dateTime: true, model: true, location: false, locationText: "", locationSource: "manual",
});
// Normalize older profiles and malformed stored values without sharing mutable defaults.
export function modelContextOf(settings: Pick<Settings, "modelContext">, mode: Mode): ModelContextModeSettings {
  const value = settings.modelContext?.[mode];
  const text = typeof value?.locationText === "string" ? value.locationText.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").trim().slice(0, MAX_MODEL_CONTEXT_LOCATION) : "";
  return {
    dateTime: typeof value?.dateTime === "boolean" ? value.dateTime : true,
    model: typeof value?.model === "boolean" ? value.model : true,
    location: typeof value?.location === "boolean" ? value.location : false,
    locationText: text,
    locationSource: value?.locationSource === "ip" ? "ip" : "manual",
    ...(value?.locationSource === "ip" && typeof value?.locationUpdatedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.locationUpdatedAt) && Number.isFinite(Date.parse(value.locationUpdatedAt)) ? { locationUpdatedAt: value.locationUpdatedAt } : {}),
  };
}

export const DEFAULT_MAX_STEPS_PER_TURN = 50;
export const MIN_STEPS_PER_TURN = 1;
export const MAX_STEPS_PER_TURN = 1000;
export function isMaxStepsPerTurn(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_STEPS_PER_TURN && value <= MAX_STEPS_PER_TURN;
}

// Shared by the runner, storage and settings UI, including profiles saved before these options.
export function agentSettingsOf(settings: Pick<Settings, "autoCompact" | "maxStepsPerTurn">): { autoCompact: boolean; maxStepsPerTurn: number } {
  return {
    autoCompact: typeof settings.autoCompact === "boolean" ? settings.autoCompact : true,
    maxStepsPerTurn: isMaxStepsPerTurn(settings.maxStepsPerTurn) ? settings.maxStepsPerTurn : DEFAULT_MAX_STEPS_PER_TURN,
  };
}

// Round 14 (SPEC 30.2): the app icons to choose from. The files are drawn by desktop/icons/render.ts
// (desktop/icons/variants.ts says which SVG each one is drawn from).
export type AppIconId = "boble" | "boble-lys" | "monogram" | "terminal";
export const DEFAULT_APP_ICON: AppIconId = "boble";
export const APP_ICONS: Array<{ id: AppIconId; name: string; note: string }> = [
  { id: "boble", name: "Snakkeboble", note: "Merket fra Kode-startsiden: en samtale med en ledetekst i." },
  { id: "boble-lys", name: "Snakkeboble, lys", note: "Det samme merket som strek, slik det står på startsiden." },
  { id: "monogram", name: "Monogram", note: "A-en, med tverrstreken som en markør i rav." },
  { id: "terminal", name: "Terminal", note: "Et mørkt vindu med en ledetekst." },
];
export const isAppIcon = (value: unknown): value is AppIconId => APP_ICONS.some((icon) => icon.id === value);

// Round 13 (SPEC 27.2): the tools of a chat, switched in the tool menu by the message field.
export type ChatToolId = "web" | "fetch" | "artifacts" | "memory";
export type ChatTools = Record<ChatToolId, boolean>;
export const CHAT_TOOL_IDS: ChatToolId[] = ["web", "fetch", "artifacts", "memory"];
export const DEFAULT_CHAT_TOOLS: ChatTools = { web: false, fetch: false, artifacts: true, memory: true };

export function chatToolsOf(thread: (Pick<Thread, "chatTools"> & Partial<Pick<Thread, "temporary">>) | undefined, settings: Pick<Settings, "chatTools">): ChatTools {
  const tools = { ...DEFAULT_CHAT_TOOLS, ...settings.chatTools, ...thread?.chatTools };
  if (thread?.temporary) tools.memory = false;
  return tools;
}

// How a web search is made, or why it cannot be: the provider's own search when the model has it,
// otherwise the app's browser on the search page from Settings. The demo model shows marked demo
// sources until a search page is set.
export type WebSearchRoute = "provider" | "browser" | "demo";
export function webSearchRoute(model: Pick<ModelConfig, "webSearch"> | undefined, kind: ProviderKind | undefined, settings: Pick<Settings, "webSearchUrl">): WebSearchRoute | null {
  if (kind === "mock") return settings.webSearchUrl ? "browser" : "demo";
  if (model && kind && (model.webSearch ?? kind === "anthropic")) return "provider";
  return settings.webSearchUrl ? "browser" : null;
}

// A source a web search or a read page gave, as a small card under the step.
export interface WebSource {
  title: string;
  url: string;
  snippet?: string;
  favicon?: string; // a data URL, when the app could read the site's icon
  demo?: boolean; // made up by the demo model, not a real page
}

export type PanelButtons = "together" | "separate";
export type PanelStart = "tools" | "tabs";

// "newline": Enter makes a new line, and Ctrl+Enter (Cmd+Enter) sends.
export type EnterKey = "send" | "newline";

export type CodeStartEmpty = "greeting" | "cards";
export type CodeStartProject = "cards" | "greeting";
// Round 11b (SPEC 25.2): Tekst, Token-historikk or Prosjektboks, and the size of Tekst.
export type CodeStart = "text" | "tokens" | "projects";
export type CodeStartSize = "small" | "medium" | "large";

export type AutoSkills = "ask" | "auto" | "off";
export type BusyMessages = "queue" | "steer";

// Memories: one line each, in MEMORY.md in the global config folder or in .agentic/ in a project.
export type MemoryScope = "global" | "project";

export interface MemoryItem {
  id: string; // a hash of the text, so it changes when the text does
  scope: MemoryScope;
  projectId?: string;
  text: string;
  flagged?: boolean; // looks like a secret: shown so it can be removed, never given to the model
}

export interface MemoryList {
  enabled: boolean; // Settings.memories
  global: { file: string; items: MemoryItem[] };
  projects: Array<{ projectId: string; name: string; file: string; items: MemoryItem[]; error?: string }>;
}

// A skill as Innstillinger → Skills shows it. Opaque ids: u:<folder>, p:<projectId>:<root>:<folder>, or read-only a:<folder>.
export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  source: "user" | "project" | "app";
  projectId: string | null;
  projectName: string | null;
  path: string; // the skill folder
  enabled: boolean;
  createdByAgent: boolean; // created-by: agent in the frontmatter
  editable: boolean; // false for app assets and symlinks outside the skills folder
  shadowed: boolean; // a project/user skill with the same name wins over this global/app skill
}

export interface SkillDetail extends SkillInfo {
  body: string; // SKILL.md without the frontmatter
}

export type StartMode = "last" | "chat" | "code";
export type TurnNotify = "off" | "unfocused" | "always";
export type AccentColor = "blue" | "violet" | "green" | "orange" | "pink" | "red" | "graphite";
export type Density = "compact" | "normal" | "comfortable";
export type CodeFont = "system" | "jetbrains" | "fira" | "cascadia" | "dejavu" | "ubuntu";

// The branch chip above the message field. Read from .git/HEAD, never by running git.
export interface GitInfo {
  branch: string | null; // null when the folder is not a git checkout
  detached: boolean; // HEAD is a commit, and branch is its short hash
}

export type StatsRange = "all" | "30d" | "7d";

// The statistics card on the start page. Counted from the same usage events as ProfileStats.
export interface HomeStats {
  range: StatsRange;
  sessions: number; // threads with at least one run in the range
  messages: number; // user messages in the range
  totalTokens: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number; // within the range
  peakHour: number | null; // 0-23, local time, the hour with the most runs
  favoriteModel: { modelId: string; name: string } | null;
  byModel: Array<{ modelId: string; name: string; tokens: number; runs: number }>;
  heat: Array<{ date: string; tokens: number; runs: number }>; // 25 whole weeks and this one up to today, Monday first, oldest first
}

// Artifacts: single-file programs, in HTML or (round 15, SPEC 31) a React component in JSX or
// TSX. They are untrusted, and only ever run on the preview server's origin, in a sandboxed
// iframe or in the Browser panel.
export type ArtifactLang = "html" | "jsx" | "tsx";
export const ARTIFACT_LANGS: readonly ArtifactLang[] = ["html", "jsx", "tsx"];

export interface ArtifactSummary {
  id: string;
  title: string;
  lang: ArtifactLang; // what the file is; html holds the source whatever it is
  threadId: string | null; // the thread it came from, null when made by hand or the thread is gone
  threadTitle: string | null;
  messageId: string | null;
  sourceKey: string | null; // identifies the code block within the message, set by the UI
  projectId: string | null;
  size: number; // characters of source
  hasPrevious: boolean; // one earlier version is kept
  previewUrl: string; // on the preview origin, with a key that only this run of the server knows
  createdAt: number;
  updatedAt: number;
}

export interface Artifact extends ArtifactSummary {
  html: string;
  previousHtml: string | null;
}

export const MAX_ARTIFACT_HTML = 2 * 1024 * 1024;

export interface ProfileStats {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  threads: number;
  runs: number;
  activeDays: number;
  currentStreak: number; // days in a row up to today (or yesterday)
  longestStreak: number;
  peakDay: { date: string; tokens: number } | null; // date is YYYY-MM-DD, local time
  days: Array<{ date: string; tokens: number; runs: number }>; // the last 28 days, oldest first
  byModel: Array<{ modelId: string; name: string; tokens: number; runs: number }>;
  costUsd: number | null; // summed over threads with a price set, null when none has one
  // v0.5, the profile page.
  longestRunMs: number | null; // the longest finished run, start to end
  year: Array<{ date: string; tokens: number; runs: number }>; // 52 whole weeks and this one up to today, Monday first, oldest first
}

// How full a thread's context window is, split by what fills it. Estimated from the stored
// messages, the system prompt and the tool list at about four characters a token, and scaled to
// the provider's own count from the last step when there is one.
export interface ContextUsage {
  threadId: string;
  contextWindow: number;
  usedTokens: number;
  measured: boolean; // usedTokens is the provider's count, not only the estimate
  parts: { messages: number; system: number; tools: number; compactBuffer: number; free: number };
  tools: number; // how many tool definitions are sent
  skills: number; // how many skills are listed in the system prompt
}

export interface ProviderPreset {
  id: string;
  name: string;
  kind: "openai-compatible" | "anthropic";
  baseUrl: string;
  apiKeyEnv?: string;
  keyRequired: boolean;
  local?: boolean;
  docsUrl?: string;
  checked: boolean; // base URL confirmed in the provider's own docs
  beta?: boolean; // not yet tried with a real key
  note?: string;
}

export interface ListedModel {
  id: string;
  name: string;
  contextWindow: number;
  contextSource: "api" | "table" | "default"; // where the context size came from
}

export interface GlobalConfig {
  dir: string;
  agentsMd: string | null;
  settings: { model?: string; permissionMode?: PermissionMode; personality?: string };
  settingsError?: string;
}

// Lagring (Innstillinger): what the app's own data folder holds, and what can be cleaned up.
// Sizes are bytes as the files report them. Nothing outside the data folder is ever deleted.
export type StorageCategoryId = "database" | "artifacts" | "images" | "uploads" | "screenshots" | "browser" | "logs" | "temp" | "other";
export type StorageActionId = "browser-cache" | "browser-all" | "orphans" | "archived" | "vacuum" | "logs";

export interface StorageCategory {
  id: StorageCategoryId;
  bytes: number;
  files: number;
}

export interface StorageAction {
  id: StorageActionId;
  bytes: number; // estimate of what it frees
  count: number; // files or threads it touches
  available: boolean;
  reason?: string; // why it cannot run now
}

export interface StorageReport {
  dataDir: string;
  total: number; // the categories added up; the downloads are not part of it
  categories: StorageCategory[];
  actions: StorageAction[];
  archivedDays: number;
  downloads: { dir: string; bytes: number; files: number; capped: boolean } | null; // the user's folder, counted only
  at: number;
}

export interface StorageCleanResult {
  freed: number; // the total before minus the total after
  done: Array<{ id: StorageActionId; count: number; error?: string }>;
  report: StorageReport;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  contextTokens: number;
  costUsd: number | null;
}

// Stored per thread with an increasing seq. Replaying them rebuilds the conversation.
export type ThreadEvent =
  // from: set when another thread sent it. attachments: what @ added; contents go to the model only.
  | { type: "user.message"; messageId: string; text: string; from?: ThreadRef; attachments?: Attachment[] }
  // Sent while a run is active. A later user.message with the same messageId means it left the queue.
  // steer: goes into the running turn at the next step instead of waiting for the turn to end.
  | { type: "user.queue-removed"; messageId: string }
  | { type: "user.queued"; messageId: string; text: string; from?: ThreadRef; attachments?: Attachment[]; steer?: boolean; editable?: boolean; steerable?: boolean }
  | { type: "run.started"; runId: string; modelId: string }
  | { type: "text.delta"; runId: string; messageId: string; text: string }
  | { type: "thinking.delta"; runId: string; blockId: string; text: string }
  | { type: "thinking.done"; runId: string; blockId: string; durationMs: number }
  | { type: "tool.started"; runId: string; callId: string; tool: string; summary: string; input: unknown; status: ToolStatus }
  | { type: "tool.output"; runId: string; callId: string; text: string }
  // screenshotId, when set, is served by GET /api/screenshots/:id.
  // sources: what a web search found or the page a web read gave (round 13).
  | { type: "tool.finished"; runId: string; callId: string; status: ToolStatus; result?: string; durationMs: number; screenshotId?: string; sources?: WebSource[] }
  | { type: "approval.requested"; runId: string; approvalId: string; callId: string; title: string; detail: string; canAllowAlways: boolean }
  | { type: "approval.resolved"; runId: string; approvalId: string; decision: ApprovalDecision }
  | { type: "thread.spawned"; runId: string; childThreadId: string; title: string }
  | { type: "turn.changes"; runId: string; turnId: string; files: ChangedFile[] }
  | { type: "turn.reverted"; turnId: string }
  | { type: "context.compacted"; runId: string; beforeTokens: number; afterTokens: number }
  | { type: "usage"; runId: string; usage: Usage }
  // The provider said wait (429, 5xx): the run tries again after waitMs. attempt counts from 1.
  | { type: "run.retrying"; runId: string; attempt: number; maxAttempts: number; waitMs: number; reason: string }
  | { type: "run.finished"; runId: string; status: RunStatus; error?: string };

export type TeamTaskStatus = "todo" | "doing" | "done";

export interface TeamTask {
  id: string;
  projectId: string;
  title: string;
  status: TeamTaskStatus;
  ownerThreadId: string | null;
  createdByThreadId: string | null; // null when the user added it
  createdAt: number;
  updatedAt: number;
}

export interface ThreadRef {
  threadId: string;
  title: string;
}

export type AttachmentRef =
  | { kind: "file" | "dir"; path: string }
  | { kind: "thread"; threadId: string }
  | { kind: "image"; imageId: string; name?: string } // uploaded with POST /api/images
  | { kind: "upload"; uploadId: string; name?: string }; // a text file from the disk, uploaded with POST /api/uploads

// Images and files together, per message.
export const MAX_ATTACHMENTS = 20;
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_TEXT_UPLOAD_BYTES = 512 * 1024; // UTF-8 bytes per text file from the disk

export interface Attachment {
  kind: "file" | "dir" | "thread" | "image" | "upload";
  label: string;
  path?: string;
  threadId?: string;
  imageId?: string; // served by GET /api/images/:id
  uploadId?: string; // a text file from the disk, kept in the data folder
  truncated?: boolean;
}

export interface CommandInfo {
  name: string; // without the slash
  description: string;
  kind: "builtin" | "skill";
  source?: "project" | "user" | "app"; // skills only
  aliases?: string[]; // other names, e.g. the Norwegian ones from before
  args?: string; // hint shown after the name, e.g. "<mål>"
  demo?: boolean; // a placeholder: it explains what it will do, and does nothing
}

export interface MentionItem {
  kind: "file" | "dir" | "thread";
  label: string;
  path?: string;
  threadId?: string;
  running?: boolean; // threads only
}

export type ThreadEventEnvelope = { seq: number; threadId: string; at: number; event: ThreadEvent };

export type ApprovalDecision = "allow" | "allow-always" | "deny";

export interface ChangedFile {
  path: string;
  change: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  /** Binary/invalid UTF-8 is never presented as an empty text diff. */
  binary?: boolean;
  /** False for bounded large-file replacement; absent on older saved events. */
  countsExact?: boolean;
  /** Another writer changed this file between this turn's file-tool writes. Undo needs consent. */
  overlapping?: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  kind: "file" | "dir";
  size?: number;
}

export interface FileContent {
  path: string;
  text: string | null;
  size: number;
  binary: boolean;
  truncated: boolean;
}

export interface TurnDiff {
  turnId: string;
  files: Array<ChangedFile & { before: string | null; after: string | null }>;
}

export interface Bootstrap {
  build: BuildInfo;
  settings: Settings;
  projects: Project[];
  threads: Thread[];
  providers: ProviderConfig[];
  models: ModelConfig[];
  artifacts: ArtifactSummary[]; // newest first, without the HTML
  chatProjects?: ChatProject[]; // round 9
  sections?: SidebarSection[]; // round 11
  keyring?: KeyringStatus; // round 14 (SPEC 30.1)
}

// Round 14 (SPEC 30.1): where API keys and the GitHub token are kept. "keyring": the system keyring
// (Secret Service). "session": it could not be used, so keys set now last until the app closes.
// "pending": the keyring has not answered yet, right after start. legacy: keys.json from before 0.10
// is still in the data folder, and why it was not moved.
export type KeyringReason = "no-service" | "locked" | "error";
export interface KeyringStatus {
  store: "keyring" | "session" | "pending";
  reason?: KeyringReason;
  legacy: { reason: KeyringReason | "pending" | "readback" | "unreadable" | "delete" } | null;
}

export interface PlaytestState {
  projectId: string;
  status: "stopped" | "starting" | "running" | "error";
  url?: string;
  terminalId?: string;
  error?: string;
}

export interface BrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  native?: boolean; // SPEC 29.3: the page is a real view in the Electron window, not frames
}

// Read-only, bounded metadata for manual annotation of a frozen viewport. No form values.
export interface AnnotationElement {
  tag: string;
  selector: string;
  text: string;
  color: string;
  font: string;
  rect: { x: number; y: number; w: number; h: number };
}
export interface BrowserAnnotationSnapshot {
  pngBase64: string;
  url: string;
  width: number;
  height: number;
  elements: AnnotationElement[];
}

// Round 10 (SPEC 23.1): a tab in the Browser panel. The first tab has the id "".
export interface BrowserTabInfo {
  id: string;
  threadId?: string; // owned by this thread; panel selection does not retarget its tools
  url: string;
  title: string;
  loading: boolean;
  favicon?: string; // a data URL of at most 64 KB, read from the page's own icon
}

// Round 10 (SPEC 23.1): bookmarks and history imported from a Chrome profile on this machine. Only
// Bookmarks and History are read, only when the user asks, and never cookies, passwords, cards or
// sessions.
export type ChromeBrowserKind = "chrome" | "chromium";
export interface ChromeProfileInfo {
  browser: ChromeBrowserKind;
  profile: string; // the folder name, like "Default" or "Profile 1"
  label: string; // «Google Chrome · Standard»
  bookmarks: boolean; // a Bookmarks file is there
  history: boolean; // a History file is there
}
export interface ImportedBookmark {
  title: string;
  url: string;
  folder: string; // «Bokmerkelinjen / Jobb», empty at the top
}
export interface ImportedVisit {
  title: string;
  url: string;
  visitedAt: number; // ms since 1970
  visits: number;
}
export interface ChromeImportPreview {
  source: { browser: ChromeBrowserKind; profile: string; label: string };
  bookmarks: number;
  history: number;
  sampleBookmarks: ImportedBookmark[];
  sampleHistory: ImportedVisit[];
}
export interface BrowserImported {
  importedAt: number | null;
  source: { browser: ChromeBrowserKind; profile: string; label: string } | null;
  bookmarks: ImportedBookmark[];
  history: ImportedVisit[];
}

// REST, all under /api, cookie auth, JSON. Mutations require an allowed Origin.
//
// POST   /api/auth/exchange                 { token }, sets the cookie
// GET    /api/bootstrap                     Bootstrap
// POST   /api/ws-ticket                     { ticket }
//
// POST   /api/projects                      { name, path }  (creates the folder if missing)
// PATCH  /api/projects/:id                  Partial<Pick<Project, "name" | "permissionMode" | "color" | "icon" | "defaultModelId" | "path">>
//                                            path moves the project to another folder, 409 while a thread runs
// GET    /api/projects/:id/config           ProjectConfig  global and .agentic/ layers, the project wins
// PUT    /api/projects/:id/instructions     { text }  writes .agentic/AGENTS.md
// DELETE /api/projects/:id                  removes it from the app, never the folder
// GET    /api/fs/browse?path=               { path, parent, dirs: FileEntry[] }  for the folder picker
// POST   /api/fs/pick-folder                { start?, title? } => { path: string | null }, native Ubuntu chooser
//
// POST   /api/threads                       { projectId, mode, modelId? }
// PATCH  /api/threads/:id                   Partial<Pick<Thread, "title" | "archived" | "modelId">>
// DELETE /api/threads/:id
// GET    /api/threads/search?q=             Thread[]
// GET    /api/threads/:id/events?after=&limit=   ThreadEventEnvelope[]  oldest first
// GET    /api/threads/:id/events?tail=N          the last N events, oldest first
// POST   /api/threads/:id/messages          { text, attachments?: AttachmentRef[], skill?, shell?, review? }
//                                            review: true sends the thread's file changes for a code review.
//                                            => { messageId, queued }  queues if a run is active.
//                                            skill: name from /commands, text is its arguments.
//                                            shell: command for !, needs no model and uses normal approvals.
// POST   /api/threads/:id/compact           runs compaction now, 409 while a run is active
// POST   /api/threads/:id/stop
// POST   /api/approvals/:id                 { decision: ApprovalDecision }
//
// GET    /api/projects/:id/tree?path=       FileEntry[]
// GET    /api/projects/:id/file?path=       FileContent
// GET    /api/local/files/root             { path: absoluteHome } manual file panel only
// GET    /api/local/files/tree?path=       FileEntry[] (absolute paths, read only)
// GET    /api/local/files/file?path=       FileContent (absolute path, read only)
// POST   /api/projects/:id/stop-all         { stopped: number }
// GET    /api/projects/:id/usage            Usage summed over the project's threads, contextTokens is 0
// GET    /api/projects/:id/commands         CommandInfo[]  built-ins and skills
// GET    /api/commands                      CommandInfo[]  for threads without a project
// GET    /api/projects/:id/mentions?q=      MentionItem[]
// GET    /api/projects/:id/layout           { layout: unknown }  pane grid, opaque to the server
// PUT    /api/projects/:id/layout           { layout }  use "chat" as id for threads without a project
// POST   /api/projects/:id/init             { path }  writes an AGENTS.md template, 409 if it exists
// GET    /api/projects/:id/terminals        { terminalId, title, exited }[]  to reattach after a reload
// GET    /api/projects/:id/playtest         PlaytestState
// GET    /api/screenshots/:id               image/png
// GET    /api/turns/:id/diff                TurnDiff
// POST   /api/turns/:id/revert              { force? }  409 { error, conflicts: string[] } if files changed since
// POST   /api/projects/:id/open-vscode
// POST   /api/projects/:id/playtest/start   PlaytestState
// POST   /api/projects/:id/playtest/stop    PlaytestState
//
// POST   /api/model-context/location        { mode: "chat" | "code" } -> Settings; explicit IP lookup only
// PATCH  /api/settings                      Partial<Settings>; modelContext deep-merges each mode
// POST   /api/providers                     ProviderConfig fields + apiKey?
// PATCH  /api/providers/:id
// DELETE /api/providers/:id
// POST   /api/providers/:id/test            { ok, message }
// GET    /api/provider-presets              ProviderPreset[]
// POST   /api/providers/:id/models/fetch    ListedModel[]  reads the provider's /models with the stored key
// POST   /api/providers/:id/models          { models: Array<{ model, name?, contextWindow? }> } => ModelConfig[]  adds many
// GET    /api/projects/:id/tasks            TeamTask[]  the shared task list for Agent Teams
// POST   /api/projects/:id/tasks            { title, ownerThreadId? } => TeamTask
// PATCH  /api/tasks/:id                     { status?, title?, ownerThreadId? } => TeamTask
// DELETE /api/tasks/:id
// GET    /api/profile                       ProfileStats  counted from the database
// GET    /api/stats?range=all|30d|7d        HomeStats  for the start page
// GET    /api/projects/:id/git              GitInfo  from .git/HEAD, no git command
// GET    /api/threads/archived              Thread[]  archived threads, newest first
// GET    /api/config                        GlobalConfig  the global folder
// PUT    /api/config/agents-md              { text }  writes the global AGENTS.md
// GET    /api/storage?days=30               StorageReport  sizes per category and cleanup estimates
// POST   /api/storage/clean                 { actions: StorageActionId[], archivedDays? } => StorageCleanResult
// POST   /api/models, PATCH|DELETE /api/models/:id
//
// PATCH  /api/projects/:id                  also { pinned: boolean }
// GET    /api/artifacts                     ArtifactSummary[]  newest first
// POST   /api/artifacts                     { html, lang?, title?, threadId?, messageId?, sourceKey? } => Artifact
// GET    /api/artifacts/:id                 Artifact
// PATCH  /api/artifacts/:id                 { title?, html? } => Artifact  new html keeps the old as previousHtml
// POST   /api/artifacts/:id/duplicate       Artifact
// POST   /api/artifacts/:id/restore         Artifact  swaps html and previousHtml
// DELETE /api/artifacts/:id
// GET    /api/artifacts/:id/download        the file as an attachment: .html, or .jsx/.tsx as text
// POST   /api/previews                      { html, lang? } => { url }  a snapshot on the preview origin, for the artifact panel
//
// v0.5 (navigation):
// PATCH  /api/threads/:id                   also { pinned: boolean }
// POST   /api/threads                       also { sideOf: threadId }  a side chat in the same project, linked back
//
// Round 9 (SPEC 21):
// POST   /api/threads                       also { mode: "code", projectId: null }  Kode on Denne datamaskinen, without tools
//                                            also { chatProjectId }  a chat in a Chat project
// GET    /api/projects/:id                  Project  read again, with folderMissing checked now
// POST   /api/projects/:id/relink           { path }  connects the project to an existing folder: realpath, a directory,
//                                            the same checks as a new project; 409 while a thread runs
// POST   /api/chat-projects                 { name } => ChatProject
// PATCH  /api/chat-projects/:id             { name?, pinned?, color?, icon? } => ChatProject
// DELETE /api/chat-projects/:id             the chats stay, outside any project
// PATCH  /api/threads/:id                   also { chatProjectId: string | null }  Chat threads only
// PUT    /api/projects/local/layout         the pane grid of Kode without a project, like "chat"
// POST   /api/threads/:id/fork              { from?: "last" }  "last" copies only the last message and its answer
// GET    /api/threads/:id/context           ContextUsage
// PATCH  /api/projects/:id                  icon may also be "emoji:<emoji>", see isProjectIcon
//
// Round 11 (SPEC 24.6):
// POST   /api/sections                      { name, mode } => SidebarSection  last in its mode
// PATCH  /api/sections/:id                  { name } => SidebarSection
// DELETE /api/sections/:id                  the threads stay, back where they were
// PATCH  /api/threads/:id                   also { sectionId: string | null }  a section of the thread's own mode
//
// v0.6 (downloads in the Browser panel):
// GET    /api/downloads                     { dir, defaultDir, items: DownloadItem[] }  newest first
// POST   /api/downloads/:id/cancel          stops a download under way
// DELETE /api/downloads/:id?file=1          off the list; file=1 also deletes the file (the UI asks first)

// Round 10 (import from Chrome, SPEC 23.1; only Bookmarks and History are ever read):
// GET    /api/browser/chrome-profiles                         ChromeProfileInfo[]
// POST   /api/browser/chrome-import/preview  { browser, profile, history? }  ChromeImportPreview, nothing is kept
// POST   /api/browser/chrome-import          { browser, profile, history? }  { bookmarks, history, source, importedAt }
// GET    /api/browser/imported                                BrowserImported
// DELETE /api/browser/imported                                removes what was imported

// v0.6 (servers the app's own processes started):
// GET    /api/servers                       RunningServer[]
// POST   /api/servers/:id/stop              stops the process that listens, only one the app started

// A local server seen in the output of a command, terminal or Playtest that the app started, and
// confirmed to listen. Never a scan of the machine's ports.
export interface RunningServer {
  id: string;
  port: number;
  url: string; // http://localhost:<port>
  projectId: string;
  threadId: string | null; // the thread whose command started it
  source: "command" | "terminal" | "playtest";
  command: string; // the command, or the terminal's title
  startedAt: number; // when it was seen first
  pid: number | null; // the process that listens, when it is known
}

// A file downloaded in the Browser panel. Nothing is ever opened or run.
export interface DownloadItem {
  id: string;
  projectId: string;
  url: string;
  filename: string; // made safe, and numbered if the name was taken
  path: string | null; // where it is, once done
  state: "progress" | "done" | "canceled" | "error";
  receivedBytes: number;
  totalBytes: number; // 0 when the server did not say
  startedAt: number;
  finishedAt: number | null;
  error?: string;
}
// PATCH  /api/threads/:id                   also { goalPaused: boolean }  pauses or resumes the goal's clock
// PATCH  /api/threads/:id                   also { chapter: { messageId, title: string | null } }  null removes it
// POST   /api/threads/:id/fork               also { messageId }  a new thread with the conversation up to and with that message
// POST   /api/images                        { name, mime, data } data is base64 => { id }  png, jpeg, webp or gif
// POST   /api/uploads                       { name, text } => { id }  a text file from the disk, max MAX_TEXT_UPLOAD_BYTES, no binary
// GET    /api/projects/:id/mentions?q=&kind=dir   folders only, for Legg til mappe
// GET    /api/images/:id                    the image, for attachments of kind "image"
//
// Round 6, agent E (memories, skills, steering):
// POST   /api/threads/:id/messages          also { steer?: boolean }  while a run is active: true sends the message into
//                                            the running turn at the next step (between tool calls, or when the model
//                                            stops writing), false queues it. Left out: Settings.busyMessages decides.
//                                            => { messageId, queued, steer }  a steered message is logged as user.queued
//                                            with steer: true, and as user.message when the turn takes it in.
// PATCH  /api/threads/:id/queue/:messageId  { steer: boolean } => { messageId, steer }  turns a queued message into a
//                                            steered one or back; 404 when it has left the queue
// GET    /api/memories                      MemoryList  global and every project's
// POST   /api/memories                      { scope, projectId?, text } => MemoryItem  400 for secrets
// PUT    /api/memories/:id                  { scope, projectId?, text } => MemoryItem
// DELETE /api/memories/:id?scope=&projectId=
// POST   /api/memories/clear                { scope?: MemoryScope, projectId? }  no scope clears all => { removed }
// GET    /api/skills                        { userDir, skills: SkillInfo[] }
// GET    /api/skills/:id                    SkillDetail
// POST   /api/skills                        { scope: "user" | "project", projectId?, name, description, body } => SkillDetail
// PUT    /api/skills/:id                    { description, body } => SkillDetail
// PATCH  /api/skills/:id                    { enabled } => SkillInfo
// DELETE /api/skills/:id                    removes the skill folder

// WebSocket on /ws?ticket=. One socket, multiplexed. Terminal and screencast
// payloads stay out of the event log.
export type ClientMessage =
  | { type: "thread.subscribe"; threadId: string; afterSeq: number }
  | { type: "thread.unsubscribe"; threadId: string }
  | { type: "terminal.open"; projectId: string; terminalId?: string; cols: number; rows: number }
  | { type: "terminal.input"; terminalId: string; data: string }
  | { type: "terminal.resize"; terminalId: string; cols: number; rows: number }
  | { type: "terminal.close"; terminalId: string }
  // Round 10: tabId is the tab in the panel ("" or left out is the first tab; left out on navigate is
  // the tab the panel showed last). browser.open shows a tab, and opens it when it is new.
  | { type: "browser.open"; projectId: string; width: number; height: number; tabId?: string; native?: boolean; requestId?: string } // native: the Electron window can show the page itself (SPEC 29.3)
  | { type: "browser.close"; projectId: string }
  | { type: "browser.close-tab"; projectId: string; tabId: string }
  | { type: "browser.navigate"; projectId: string; url: string; tabId?: string; requestId?: string }
  | { type: "browser.history"; projectId: string; action: "back" | "forward" | "reload"; tabId?: string; requestId?: string }
  | { type: "browser.resize"; projectId: string; width: number; height: number; tabId?: string }
  | { type: "browser.input"; projectId: string; event: BrowserInput; tabId?: string }
  | { type: "browser.frame-ack"; projectId: string; sessionId: number; tabId?: string }
  // v0.5: the ⋯ menu in the Browser panel.
  | { type: "browser.find"; projectId: string; text: string; backwards: boolean; tabId?: string }
  | { type: "browser.clear-data"; projectId: string };

export type BrowserInput =
  | { kind: "mouse"; action: "move" | "down" | "up"; x: number; y: number; button: "left" | "middle" | "right" | "none"; clicks: number; modifiers: number }
  | { kind: "wheel"; x: number; y: number; deltaX: number; deltaY: number; modifiers: number }
  | { kind: "key"; action: "down" | "up" | "char"; key: string; code: string; text?: string; modifiers: number };

export type ServerMessage =
  | { type: "thread.event"; envelope: ThreadEventEnvelope }
  | { type: "thread.changed"; thread: Thread } // also sent for new threads
  | { type: "thread.deleted"; threadId: string }
  | { type: "thread.reset"; threadId: string } // Chat: the log was cut back (edit or new answer), so load it again
  | { type: "project.changed"; project: Project }
  | { type: "git.changed"; projectId: string } // also sent for new projects
  | { type: "project.deleted"; projectId: string }
  | { type: "chat-project.changed"; project: ChatProject } // round 9, also sent for new ones
  | { type: "chat-project.deleted"; projectId: string }
  | { type: "section.changed"; section: SidebarSection } // round 11, also sent for new ones
  | { type: "section.deleted"; sectionId: string }
  | { type: "project.layout"; projectId: string; layout: unknown; clientId?: string } // clientId: the window that saved it, so it can skip its own echo
  | { type: "project.usage"; projectId: string; usage: Usage }
  | { type: "project.tasks"; projectId: string; tasks: TeamTask[] }
  | { type: "artifact.changed"; artifact: ArtifactSummary } // also sent for new ones
  | { type: "artifact.deleted"; artifactId: string }
  | { type: "skills.changed" } // a SKILL.md changed; refresh command menus
  | { type: "settings.changed"; settings: Settings; providers: ProviderConfig[]; models: ModelConfig[] }
  | { type: "project.files-changed"; projectId: string; paths: string[] }
  | { type: "playtest.state"; state: PlaytestState }
  | { type: "terminal.opened"; terminalId: string; projectId: string; title: string; replay: string }
  | { type: "terminal.output"; terminalId: string; data: string }
  | { type: "terminal.exit"; terminalId: string; code: number | null }
  | { type: "browser.state"; projectId: string; tabId?: string; state: BrowserState }
  | { type: "browser.error"; projectId: string; tabId?: string; message: string; command?: string; requestId?: string }
  | { type: "browser.frame"; projectId: string; tabId?: string; sessionId: number; jpegBase64: string; width: number; height: number }
  | { type: "browser.closed"; projectId: string; tabId?: string; reason: string }
  | { type: "browser.found"; projectId: string; tabId?: string; text: string; found: boolean }
  | { type: "browser.tabs"; projectId: string; tabs: BrowserTabInfo[]; active: string } // round 10: the project's tabs, in order
  | { type: "browser.cleared"; projectId: string }
  | { type: "download.changed"; download: DownloadItem } // also sent for new ones
  | { type: "download.removed"; id: string }
  | { type: "servers.changed"; servers: RunningServer[] }
  | { type: "keyring.changed"; keyring: KeyringStatus } // round 14 (SPEC 30.1)
  | { type: "error"; message: string };

// Round 8 (agent G): GitHub, read only. The token stays on the server, like the provider keys.
export type GitHubErrorCode = "bad-token" | "rate-limit" | "not-found" | "offline" | "not-connected" | "other";

export interface GitHubStatus {
  connected: boolean;
  login?: string; // the account the token belongs to
  name?: string | null;
  scopes?: string | null; // X-OAuth-Scopes for a classic token, null for a fine-grained one
}

// Read from .git/config, never by running git.
export interface GitHubRemote {
  owner: string;
  repo: string;
  remote: string; // the remote's name, usually "origin"
  url: string; // the html address of the repo
}

export interface GitHubItem {
  number: number;
  title: string;
  url: string; // checked to be the repo's own address on GitHub
  author: string | null;
  createdAt: string;
  updatedAt: string;
  comments: number;
  labels: Array<{ name: string; color: string }>;
  draft?: boolean; // pull requests
  head?: string; // pull requests: the branch
}

export interface GitHubProject {
  remote: GitHubRemote | null;
  reason?: string; // why remote is null: no .git, no remote, or not on GitHub
  status: GitHubStatus;
  repo?: { description: string | null; private: boolean; defaultBranch: string; stars: number; url: string };
  pulls?: GitHubItem[];
  issues?: GitHubItem[];
  error?: { code: GitHubErrorCode; message: string; resetAt?: number };
  fetchedAt?: number;
}

// The mini editor: a project file with what the editor needs to save it safely.
export interface EditableFile extends FileContent {
  hash: string | null; // sha256 of the bytes on disk, sent back with a save
  editable: boolean;
  reason?: string; // why it is read only
  eol: "lf" | "crlf";
}

// GET    /api/github                        GitHubStatus
// PUT    /api/github/token                  { token } => GitHubStatus  (checked against GitHub first)
// DELETE /api/github/token                  GitHubStatus
// GET    /api/projects/:id/github?refresh=1 GitHubProject
// GET    /api/projects/:id/file/edit?path=  EditableFile
// PUT    /api/projects/:id/file             { path, text, hash, force? } => EditableFile, 409 when the file changed on disk

// Round 9b (SPEC 22): the standard harness for Kode, Chat's own personalisation, the memory upgrade
// and import of many skills. Routes in server/src/http/harness-routes.ts.

export interface HarnessPartInfo {
  id: string;
  title: string;
  text: string;
  locked: boolean; // always on
  default: boolean;
  on: boolean;
}

export interface PromptLayerInfo {
  id: string;
  title: string;
  source: string;
  text: string;
  tokens: number; // estimated, about four characters per token
}

export interface HarnessInfo {
  version: string; // the built-in harness
  parts: HarnessPartInfo[];
  partsAreDefault: boolean;
  agents: {
    file: string; // the global AGENTS.md
    text: string | null; // null when there is none
    hash: string; // of text, sent back with a restore
    isDefault: boolean;
    backups: Array<{ name: string; path: string; size: number; at: number }>;
  };
  autoUpgrade: boolean;
  lastUpgradeAt: number | null;
  pending: UpgradeProposal[];
}

export interface DiffLineInfo {
  kind: "same" | "add" | "del";
  text: string;
}

export type ChatTone = "standard" | "kort" | "vennlig" | "grundig" | "uformell" | "formell";

export interface ChatPersonal {
  instructions: string;
  about: string;
  tone: ChatTone;
  autoMemory: boolean; // «Oppdater minnet av seg selv»
  memories: boolean; // Chat memories reach the model
}

export interface UpgradeOp {
  kind: "merge" | "remove" | "shorten";
  ids: string[];
  texts: string[];
  result: string | null;
  reason: string;
}

export interface UpgradeProposal {
  scope: "global" | "project" | "chat";
  projectId?: string;
  source: "regler" | "modell";
  createdAt: number;
  ops: UpgradeOp[];
  note?: string;
}

export interface SkillImportFile {
  name: string; // the file name
  path?: string; // relative path inside a chosen or dropped folder
  text: string;
}

export interface SkillImportRow {
  key: string;
  file: string;
  name: string;
  description: string;
  status: "ok" | "conflict" | "invalid" | "ignored";
  error?: string;
  note?: string;
  conflictWith?: string; // where the skill with the same name is
  conflictId?: string;
  suggested?: string; // the name «Behold begge» gives the new one
}

export interface SkillImportResult {
  key: string;
  file: string;
  status: "created" | "replaced" | "skipped" | "error";
  name?: string;
  id?: string;
  message?: string;
}

// GET    /api/harness                               HarnessInfo
// PATCH  /api/harness                               { parts?, autoUpgrade? } => HarnessInfo
// GET    /api/harness/preview?mode=&projectId=      { layers: PromptLayerInfo[], tokens, tools }
// GET    /api/harness/agents-md/default             { text, diff: DiffLineInfo[], hash }
// POST   /api/harness/restore                       { agents?: hash, parts?: true } => { harness, backup? }
// GET    /api/chat-personal                         { personal: ChatPersonal, memories: MemoryItem[], file, tones }
// PUT    /api/chat-personal                         Partial<ChatPersonal> => ChatPersonal
// POST   /api/chat-personal/reset                   ChatPersonal
// POST|PUT|DELETE /api/chat-personal/memories[/:id]  Chat memories
// POST   /api/memories/upgrade                      { scope, projectId?, useModel? } => UpgradeProposal
// POST   /api/memories/upgrade/apply                { proposal, selected: number[] } => { changed }
// POST   /api/memories/upgrade/dismiss              { scope, projectId? }
// POST   /api/skills/import/preview                 { files, scope, projectId? } => { rows: SkillImportRow[] }
// POST   /api/skills/import                         { files, scope, projectId?, decisions, enabled } => { results: SkillImportResult[] }

// Round 12 (SPEC 26.4): cookies from a browser on this machine into the app's own Browser panel.
// Only the cookie database of the chosen profile is read, and only when the user asks for it.
export type CookieBrowserKind = "chrome" | "chromium" | "firefox";
export interface CookieProfileInfo {
  browser: CookieBrowserKind;
  profile: string; // the folder name, like "Default" or "abcd1234.default-release"
  label: string; // «Chrome · Standard», «Firefox · default-release»
}
export interface CookieSiteInfo {
  site: string; // the registrable domain, like "example.com"
  cookies: number; // cookies that have not expired
  lastUsed: number | null; // ms since 1970, the newest last access of its cookies
}
export interface CookieSiteList {
  source: { browser: CookieBrowserKind; profile: string; label: string };
  sites: CookieSiteInfo[];
  keyring: "not-needed" | "needed" | "missing"; // Chrome's v11 cookies need the key from the system keyring through secret-tool
}
export interface CookieImportResult {
  sites: number;
  cookies: number;
  skipped: number; // could not be decrypted or were refused by the browser
  keyringMissing: boolean; // some were skipped because secret-tool is not there
}
export interface ImportedCookieSite {
  site: string;
  cookies: number;
  importedAt: number;
  source: string; // the profile's label
}

// GET    /api/browser/cookie-profiles                 CookieProfileInfo[]  Chrome, Chromium and Firefox profiles with a cookie database
// POST   /api/browser/cookie-sites    { browser, profile }            CookieSiteList  names and counts only, nothing is decrypted
// POST   /api/browser/cookie-import   { browser, profile, sites }     CookieImportResult  only the chosen sites
// GET    /api/browser/cookies                         ImportedCookieSite[]  what has been imported, per site
// DELETE /api/browser/cookies/:site                   forgets one site's cookies in the app's browser
// DELETE /api/browser/cookies                         forgets every imported cookie

// Round 12 (SPEC 26.2): Økt, what the panel shows for the thread in focus. Only what is there.
export interface SessionContextPart {
  id: "system" | "agents" | "memories" | "skills" | "tools" | "messages";
  label: string;
  tokens: number;
}
export interface SessionConnection {
  id: string;
  kind: "model" | "github" | "browser";
  label: string;
  detail: string;
  status: "ok" | "warn" | "off";
}
export interface SessionTask {
  id: string; // "agent:<threadId>", "terminal:<id>" or "server:<id>"
  kind: "agent" | "terminal" | "server";
  title: string;
  detail: string;
  startedAt: number;
  finishedAt: number | null;
  running: boolean;
  threadId?: string; // for an agent, the thread to open
}
export interface SessionInfo {
  threadId: string;
  environment: {
    kind: "local";
    host: string; // the machine's name
    project: { id: string; name: string; path: string; folderMissing: boolean } | null;
  };
  context: {
    contextWindow: number;
    usedTokens: number;
    percent: number; // 0-100, rounded
    measured: boolean; // the total is the provider's own count
    parts: SessionContextPart[]; // estimated, about four characters a token
  };
  connections: SessionConnection[];
  tasks: SessionTask[]; // running, newest first
  finished: SessionTask[]; // ended, newest first
}
// GET    /api/threads/:id/session                     SessionInfo
// POST   /api/threads/:id/session/stop  { taskId }    stops a running task of the thread

