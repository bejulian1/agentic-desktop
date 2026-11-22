// SQLite storage. Everything sync and in one place, so a read and a subscribe can happen in the
// same tick. `events` is what the UI replays; `messages` is what the model sees and can be
// rewritten by compaction.
import type { Schedule } from '../../shared/schedules.ts';
import type { HistorySource, ImportedToolNote } from "../../shared/history-import.ts";
import { historyFrom } from "./agent/fork.ts";
import { randomUUID } from "node:crypto";
import { chmodSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type {
  AnswerModel,
  ArtifactSummary,
  Chapter,
  ForkOrigin,
  ChatProject,
  ChatProjectMemory,
  ChatProjectMemoryMode,
  ChatMemoryProposal,
  ChatTools,
  ChangedFile,
  SummaryTurnChanges,
  SidebarSection,
  HomeStats,
  ModelConfig,
  Mode,
  ProfileStats,
  StatsRange,
  TeamTask,
  TeamTaskStatus,
  PermissionMode,
  Project,
  ReasoningEffort,
  ProviderKind,
  RunStatus,
  Settings,
  Thread,
  ThreadEvent,
  ThreadEventEnvelope,
  Usage,
  ArtifactLang,
} from "../../shared/protocol.ts";
import type { Message } from "./providers/types.ts";
import { agentSettingsOf, modelContextOf, searchEngineOf, threadNotificationsOf } from "../../shared/protocol.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, permission_mode TEXT NOT NULL,
  created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chat_projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, icon TEXT, pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chat_project_memories (
  chat_project_id TEXT NOT NULL REFERENCES chat_projects(id) ON DELETE CASCADE,
  id TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_project_id, id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sidebar_sections (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, mode TEXT NOT NULL, position INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, mode TEXT NOT NULL,
  title TEXT NOT NULL, model_id TEXT, archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, usage TEXT,
  parent_thread_id TEXT, origin TEXT NOT NULL DEFAULT 'user', permission_cap TEXT);
CREATE TABLE IF NOT EXISTS chat_memory_proposals (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  context TEXT NOT NULL, text TEXT NOT NULL, previous_id TEXT, previous_text TEXT,
  UNIQUE(thread_id, context, text));
CREATE TABLE IF NOT EXISTS events (
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, seq INTEGER NOT NULL,
  at INTEGER NOT NULL, event TEXT NOT NULL, PRIMARY KEY (thread_id, seq)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS messages (
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, idx INTEGER NOT NULL,
  role TEXT NOT NULL, content TEXT NOT NULL, PRIMARY KEY (thread_id, idx)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL, turn_id TEXT NOT NULL, status TEXT NOT NULL, start_seq INTEGER NOT NULL,
  started_at INTEGER NOT NULL, finished_at INTEGER, error TEXT);
CREATE INDEX IF NOT EXISTS runs_status ON runs(status);
CREATE TABLE IF NOT EXISTS queue (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  payload TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS queue_drafts (
  thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL, created_at INTEGER NOT NULL, reverted_at INTEGER);
CREATE TABLE IF NOT EXISTS turn_files (
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE, path TEXT NOT NULL,
  before BLOB, after BLOB, change TEXT, additions INTEGER, deletions INTEGER,
  after_captured INTEGER NOT NULL DEFAULT 0,
  interleaved INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (turn_id, path)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, base_url TEXT, api_key_env TEXT, preset_id TEXT);
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  name TEXT NOT NULL, model TEXT NOT NULL, context_window INTEGER NOT NULL,
  input_price REAL, output_price REAL, options TEXT);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, status TEXT NOT NULL, owner_thread_id TEXT, created_by_thread_id TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, html TEXT NOT NULL, previous_html TEXT,
  thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL, message_id TEXT, source_key TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS artifacts_updated ON artifacts(updated_at);
CREATE TABLE IF NOT EXISTS allow_rules (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, kind TEXT NOT NULL,
  value TEXT NOT NULL, PRIMARY KEY (project_id, kind, value)) WITHOUT ROWID;
-- Every thread in the sidebar asks for its last run, and deleting a thread cascades to runs, turns
-- and the queue. Without these, each of those was a scan of the whole table.
CREATE INDEX IF NOT EXISTS runs_thread ON runs(thread_id, start_seq);
CREATE INDEX IF NOT EXISTS turns_thread ON turns(thread_id);
CREATE INDEX IF NOT EXISTS queue_thread ON queue(thread_id);
-- The few event types that statistics and forks look for across threads. The WHERE matches the
-- queries word for word, which is what lets SQLite use them instead of reading every event.
CREATE INDEX IF NOT EXISTS events_turn ON events(thread_id, seq) WHERE event LIKE '{"type":"turn.%';
CREATE INDEX IF NOT EXISTS events_usage ON events(thread_id, seq) WHERE event LIKE '{"type":"usage"%';
CREATE INDEX IF NOT EXISTS events_user_message ON events(thread_id, seq) WHERE event LIKE '{"type":"user.message"%';
CREATE INDEX IF NOT EXISTS events_run_finished ON events(thread_id, seq) WHERE event LIKE '{"type":"run.finished"%';
`;

// Dates for statistics are YYYY-MM-DD in local time.
const dayOf = (at: number) => new Date(at).toLocaleDateString("sv-SE");

// dayOf for the statistics, which ask for the date of every run and every usage step. The local
// date can only change on a quarter hour (time zones and their daylight saving shifts are whole
// quarter hours today), so one lookup per quarter hour gives the same answer at a fraction of the time.
function dayLookup(): (at: number) => string {
  const days = new Map<number, string>();
  return (at) => {
    const quarter = Math.floor(at / 900_000);
    let day = days.get(quarter);
    if (day === undefined) days.set(quarter, (day = dayOf(at)));
    return day;
  };
}
const minusDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("sv-SE");
};

// Days in a row: the longest run among the active days, and the one that reaches today (or
// yesterday, so a streak does not break before the day is over).
function countStreaks(active: string[], today: string): { current: number; longest: number } {
  const set = new Set(active);
  let longest = 0;
  let run = 0;
  for (let i = 0; i < active.length; i++) {
    run = i > 0 && minusDays(active[i], 1) === active[i - 1] ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  let current = 0;
  let cursor = set.has(today) ? today : minusDays(today, 1);
  while (set.has(cursor)) {
    current += 1;
    cursor = minusDays(cursor, 1);
  }
  return { current, longest };
}

export const MOCK_PROVIDER_ID = "mock";
export const MOCK_MODEL_ID = "mock-demo";

const DEFAULT_SETTINGS: Settings = { theme: "system", defaultModelId: null, defaultPermissionMode: "ask", autoOpenAgentThreads: true };

// Round 11b (SPEC 25.2): the two old Kode start choices become one. Any "cards" (Prosjektkort, or
// Hilsen med prosjektkort) is Prosjektboks; otherwise a stored "greeting" is Tekst in Middels. Nothing
// stored is the new default. Read on every load, so it never has to run as a step of its own.
export function migrateCodeStart(settings: Settings): Settings {
  if (settings.codeStart) return settings;
  const old = [settings.codeStartEmpty, settings.codeStartProject];
  if (old.includes("cards")) return { ...settings, codeStart: "projects" };
  if (old.includes("greeting")) return { ...settings, codeStart: "text", codeStartSize: settings.codeStartSize ?? "medium" };
  return settings;
}

// Migrates legacy settings shapes on load without requiring a one-off migration step.
export function migrateSettings(raw: Settings): Settings {
  let settings = migrateCodeStart(raw);
  if (!settings.threadNotifications && (settings.soundOnDone === true || (settings.notifyOnDone && settings.notifyOnDone !== "off"))) {
    settings = { ...settings, threadNotifications: threadNotificationsOf(settings) };
  }
  if (!settings.searchEngine && settings.webSearchUrl) {
    settings = { ...settings, searchEngine: searchEngineOf(settings) };
  }
  return settings;
}

export interface StoredProvider {
  id: string;
  kind: ProviderKind;
  name: string;
  presetId?: string;
  credentialId?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
}

export interface ThreadPatch {
  title?: string;
  archived?: boolean;
  modelId?: string | null;
  goal?: string | null;
  goalPaused?: boolean; // stops or starts the goal's clock
  chapter?: { messageId: string; title: string | null }; // sets or removes one chapter
  planMode?: boolean;
  plan?: string | null;
  reasoning?: ReasoningEffort | null;
  personality?: string | null;
  pinned?: boolean;
  snoozedUntil?: number | null; // hidden under Utsatt in the smart sidebar until then
  chatTools?: ChatTools | null; // round 13: the tools of a chat; null follows the defaults again
}

export interface RunRow {
  id: string;
  threadId: string;
  turnId: string;
  status: RunStatus;
  startSeq: number;
}

export interface TurnFileRow {
  path: string;
  before: Uint8Array | null;
  after: Uint8Array | null;
  change: ChangedFile["change"] | null;
  additions: number;
  deletions: number;
  afterCaptured?: boolean; // distinguishes an actual deletion from a missing post-tool snapshot
  interleaved?: boolean; // an external edit was incorporated between successful writes of this turn
}

export type StoredArtifact = Omit<ArtifactSummary, "previewUrl">;

function folderExists(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

// Keys in the order toEnvelope gives them, so the text is the same as JSON.stringify of one.
const envelopeJson = (row: any): string => `{"seq":${row.seq},"threadId":${JSON.stringify(row.thread_id)},"at":${row.at},"event":${row.event}}`;

export function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, contextTokens: 0, costUsd: null };
}

export class Store {
  private db: DatabaseSync;
  private statements = new Map<string, StatementSync>();
  private seqs = new Map<string, number>();
  isRunning: (threadId: string) => boolean = () => false;
  pendingApprovals: (threadId: string) => number = () => 0;
  pendingQuestions: (threadId: string) => number = () => 0;

  constructor(dataDir: string) {
    const file = path.join(dataDir, "agentic-desktop.db");
    this.db = new DatabaseSync(file);
    try {
      chmodSync(file, 0o600);
      this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
      this.db.exec(SCHEMA);
      this.migrate();
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS discard_thread_memory_proposals AFTER UPDATE OF chat_context_revision ON threads
        WHEN NEW.chat_context_revision <> OLD.chat_context_revision BEGIN
          DELETE FROM chat_memory_proposals WHERE thread_id = NEW.id;
        END;
        CREATE TRIGGER IF NOT EXISTS discard_project_memory_proposals AFTER UPDATE OF context_revision ON chat_projects
        WHEN NEW.context_revision <> OLD.context_revision BEGIN
          DELETE FROM chat_memory_proposals WHERE thread_id IN (SELECT id FROM threads WHERE chat_project_id = NEW.id);
        END;`);
      this.q(`INSERT OR IGNORE INTO providers (id, kind, name) VALUES (?, 'mock', 'Demo')`).run(MOCK_PROVIDER_ID);
      this.q(`INSERT OR IGNORE INTO models (id, provider_id, name, model, context_window) VALUES (?, ?, 'Demo-modell (uten API)', 'mock', 200000)`)
        .run(MOCK_MODEL_ID, MOCK_PROVIDER_ID);
    } catch (err) {
      this.close();
      throw err;
    }
  }

  // Columns added after the first release. ADD COLUMN is cheap and keeps old databases working.
  private migrate(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE, data TEXT NOT NULL)`);
    const columns = (table: string) => new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
    const add = (table: string, column: string, type: string) => {
      if (!columns(table).has(column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    };
    add("turn_files", "after_captured", "INTEGER NOT NULL DEFAULT 0");
    add("turn_files", "interleaved", "INTEGER NOT NULL DEFAULT 0");
    add("threads", "goal", "TEXT");
    add('threads', 'schedule_notice', 'INTEGER NOT NULL DEFAULT 0');
    add("threads", "goal_set_at", "INTEGER");
    add("threads", "goal_resumed_at", "INTEGER");
    add("threads", "goal_paused_at", "INTEGER");
    add("threads", "goal_elapsed_ms", "INTEGER NOT NULL DEFAULT 0");
    add("threads", "chapters", "TEXT");
    add("threads", "plan_mode", "INTEGER NOT NULL DEFAULT 0");
    add("threads", "plan", "TEXT");
    add("threads", "reasoning", "TEXT");
    add("threads", "personality", "TEXT");
    add("projects", "color", "TEXT");
    add("projects", "icon", "TEXT");
    add("projects", "default_model_id", "TEXT");
    add("projects", "pinned", "INTEGER NOT NULL DEFAULT 0");
    add("projects", "agent_browser_access", "INTEGER");
    add("threads", "pinned", "INTEGER NOT NULL DEFAULT 0");
    add("threads", "snoozed_until", "INTEGER");
    add("threads", "temporary", "INTEGER NOT NULL DEFAULT 0");
    // Round 9: Chat projects. A chat whose project is removed stays, outside any project.
    add("threads", "chat_project_id", "TEXT REFERENCES chat_projects(id) ON DELETE SET NULL");
    add("chat_projects", "instructions", "TEXT NOT NULL DEFAULT ''");
    add("chat_projects", "memory_mode", "TEXT NOT NULL DEFAULT 'project'");
    add("chat_projects", "auto_memory", "INTEGER NOT NULL DEFAULT 0");
    add("chat_projects", "context_revision", "INTEGER NOT NULL DEFAULT 0");
    add("threads", "chat_context_revision", "INTEGER NOT NULL DEFAULT 0");
    add("threads", "chat_history_scope", "TEXT");
    // Round 11: sections in the sidebar. A thread whose section is deleted goes back where it was.
    add("threads", "section_id", "TEXT REFERENCES sidebar_sections(id) ON DELETE SET NULL");
    // Round 15 (SPEC 31): an artifact can be React in JSX or TSX; the ones before are HTML.
    add("artifacts", "lang", "TEXT NOT NULL DEFAULT 'html'");
    // Round 13 (SPEC 27.2): the tools chosen in a chat, as JSON. NULL follows the defaults in Settings.
    add("threads", "chat_tools", "TEXT");
    // Round 14 (SPEC 30.3): a fork's origin, as JSON (ForkOrigin).
    add("threads", "forked_from", "TEXT");
    // Monotonic revision bumped whenever rewindThread deletes/reuses event seq numbers.
    add("threads", "history_revision", "INTEGER NOT NULL DEFAULT 0");
    add("threads", "import_source", "TEXT");
    add("threads", "import_session", "TEXT");
    add("threads", "imported_at", "INTEGER");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS threads_import_session ON threads(import_source, import_session) WHERE import_source IS NOT NULL");
    add("providers", "preset_id", "TEXT");
    add("providers", "credential_id", "TEXT");
  }

  close(): void {
    this.statements.clear();
    this.db.close();
  }

  private q(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) this.statements.set(sql, (statement = this.db.prepare(sql)));
    return statement;
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  // Settings
  schedules(): Schedule[] {
    return this.q('SELECT data FROM schedules ORDER BY rowid').all().map(row => JSON.parse(String(row.data)));
  }

  saveSchedule(item: Schedule) {
    this.q('INSERT INTO schedules (id, project_id, model_id, data) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, model_id=excluded.model_id, data=excluded.data').run(item.id, item.projectId, item.modelId, JSON.stringify(item));
  }

  deleteSchedule(id: string) { this.q('DELETE FROM schedules WHERE id=?').run(id); }
  setScheduleNotice(id: string, unread: boolean) { this.q('UPDATE threads SET schedule_notice=? WHERE id=?').run(Number(unread), id); }

  private storedSettings(): Settings {
    const row = this.q("SELECT value FROM meta WHERE key = 'settings'").get() as { value: string } | undefined;
    const settings = migrateSettings({ ...DEFAULT_SETTINGS, ...(row ? JSON.parse(row.value) : {}) });
    return { ...settings, ...agentSettingsOf(settings), modelContext: { chat: modelContextOf(settings, "chat"), code: modelContextOf(settings, "code") } };
  }

  settings(): Settings {
    const settings = this.storedSettings();
    if (settings.promptAutocompleteModelId && !this.model(settings.promptAutocompleteModelId)) settings.promptAutocompleteModelId = null;
    // The demo model is preselected until another model is set up.
    if (!settings.defaultModelId || !this.model(settings.defaultModelId)) {
      const other = this.models().find((m) => m.id !== MOCK_MODEL_ID);
      settings.defaultModelId = other?.id ?? MOCK_MODEL_ID;
    }
    return settings;
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const current = this.storedSettings();
    const next = { ...current, ...patch };
    if (patch.modelContext) next.modelContext = {
      chat: modelContextOf({ modelContext: { chat: { ...modelContextOf(current, "chat"), ...patch.modelContext.chat } } }, "chat"),
      code: modelContextOf({ modelContext: { code: { ...modelContextOf(current, "code"), ...patch.modelContext.code } } }, "code"),
    };
    this.q("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(next));
    return this.settings();
  }

  // Projects

  private toProject = (row: any): Project => ({
    id: row.id,
    name: row.name,
    path: row.path,
    permissionMode: row.permission_mode,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    color: row.color ?? null,
    icon: row.icon ?? null,
    defaultModelId: row.default_model_id ?? null,
    pinned: row.pinned === 1,
    agentBrowserAccess: row.agent_browser_access === null || row.agent_browser_access === undefined ? null : row.agent_browser_access === 1,
    // Checked on every read, so a folder that was moved or deleted shows the next time anyone looks.
    ...(folderExists(row.path) ? {} : { folderMissing: true }),
  });

  projects(): Project[] {
    return this.q("SELECT * FROM projects ORDER BY last_used_at DESC").all().map(this.toProject);
  }

  project(id: string): Project | undefined {
    const row = this.q("SELECT * FROM projects WHERE id = ?").get(id);
    return row ? this.toProject(row) : undefined;
  }

  projectByPath(projectPath: string): Project | undefined {
    const row = this.q("SELECT * FROM projects WHERE path = ?").get(projectPath);
    return row ? this.toProject(row) : undefined;
  }

  createProject(name: string, projectPath: string, permissionMode: PermissionMode): Project {
    const id = randomUUID();
    const now = Date.now();
    this.q("INSERT INTO projects (id, name, path, permission_mode, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, name, projectPath, permissionMode, now, now);
    return this.project(id)!;
  }

  updateProject(id: string, patch: { name?: string; permissionMode?: PermissionMode; color?: string | null; icon?: string | null; defaultModelId?: string | null; path?: string; pinned?: boolean; agentBrowserAccess?: boolean | null }): void {
    if (patch.name !== undefined) this.q("UPDATE projects SET name = ? WHERE id = ?").run(patch.name, id);
    if (patch.permissionMode) this.q("UPDATE projects SET permission_mode = ? WHERE id = ?").run(patch.permissionMode, id);
    if (patch.color !== undefined) this.q("UPDATE projects SET color = ? WHERE id = ?").run(patch.color, id);
    if (patch.icon !== undefined) this.q("UPDATE projects SET icon = ? WHERE id = ?").run(patch.icon, id);
    if (patch.defaultModelId !== undefined) this.q("UPDATE projects SET default_model_id = ? WHERE id = ?").run(patch.defaultModelId, id);
    if (patch.path !== undefined) this.q("UPDATE projects SET path = ? WHERE id = ?").run(patch.path, id);
    if (patch.pinned !== undefined) this.q("UPDATE projects SET pinned = ? WHERE id = ?").run(patch.pinned ? 1 : 0, id);
    if (patch.agentBrowserAccess !== undefined) this.q("UPDATE projects SET agent_browser_access = ? WHERE id = ?").run(patch.agentBrowserAccess === null ? null : patch.agentBrowserAccess ? 1 : 0, id);
  }

  touchProject(id: string): void {
    this.q("UPDATE projects SET last_used_at = ? WHERE id = ?").run(Date.now(), id);
  }

  deleteProject(id: string): void {
    for (const thread of this.threads().filter((t) => t.projectId === id)) this.seqs.delete(thread.id);
    this.q("DELETE FROM projects WHERE id = ?").run(id);
  }

  // Chat projects (round 9): a name to gather chats under, with no folder on disk.

  private toChatProject = (row: any): ChatProject => ({
    id: row.id,
    name: row.name,
    color: row.color ?? null,
    icon: row.icon ?? null,
    pinned: row.pinned === 1,
    instructions: row.instructions ?? "",
    memoryMode: row.memory_mode === "shared" ? "shared" : "project",
    autoMemory: row.auto_memory === 1,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  });

  chatProjects(): ChatProject[] {
    return this.q("SELECT * FROM chat_projects ORDER BY last_used_at DESC").all().map(this.toChatProject);
  }

  chatProject(id: string): ChatProject | undefined {
    const row = this.q("SELECT * FROM chat_projects WHERE id = ?").get(id);
    return row ? this.toChatProject(row) : undefined;
  }

  createChatProject(name: string): ChatProject {
    const id = randomUUID();
    const now = Date.now();
    this.q("INSERT INTO chat_projects (id, name, created_at, last_used_at) VALUES (?, ?, ?, ?)").run(id, name, now, now);
    return this.chatProject(id)!;
  }

  updateChatProject(id: string, patch: { name?: string; pinned?: boolean; color?: string | null; icon?: string | null; instructions?: string; memoryMode?: ChatProjectMemoryMode; autoMemory?: boolean }): void {
    if (patch.name !== undefined) this.q("UPDATE chat_projects SET name = ? WHERE id = ?").run(patch.name, id);
    if (patch.pinned !== undefined) this.q("UPDATE chat_projects SET pinned = ? WHERE id = ?").run(patch.pinned ? 1 : 0, id);
    if (patch.color !== undefined) this.q("UPDATE chat_projects SET color = ? WHERE id = ?").run(patch.color, id);
    if (patch.icon !== undefined) this.q("UPDATE chat_projects SET icon = ? WHERE id = ?").run(patch.icon, id);
    // Monotonic scope identity detects A → B → A edits without rereading/hashing instruction
    // bodies for every provider chunk. Cosmetic and idempotent updates leave it unchanged.
    if (patch.instructions !== undefined) this.q("UPDATE chat_projects SET instructions = ?, context_revision = context_revision + 1 WHERE id = ? AND instructions IS NOT ?").run(patch.instructions, id, patch.instructions);
    if (patch.memoryMode !== undefined) this.q("UPDATE chat_projects SET memory_mode = ?, context_revision = context_revision + 1 WHERE id = ? AND memory_mode IS NOT ?").run(patch.memoryMode, id, patch.memoryMode);
    if (patch.autoMemory !== undefined) this.q("UPDATE chat_projects SET auto_memory = ?, context_revision = context_revision + 1 WHERE id = ? AND auto_memory IS NOT ?").run(patch.autoMemory ? 1 : 0, id, patch.autoMemory ? 1 : 0);
  }

  touchChatProject(id: string): void {
    this.q("UPDATE chat_projects SET last_used_at = ? WHERE id = ?").run(Date.now(), id);
  }

  // The chats stay; ON DELETE SET NULL takes them out of the project.
  deleteChatProject(id: string): string[] {
    const ids = (this.q("SELECT id FROM threads WHERE chat_project_id = ?").all(id) as { id: string }[]).map((r) => r.id);
    this.q("UPDATE threads SET chat_context_revision = chat_context_revision + 1 WHERE chat_project_id = ?").run(id);
    this.q("DELETE FROM chat_projects WHERE id = ?").run(id);
    return ids;
  }

  setThreadChatProject(threadId: string, chatProjectId: string | null): void {
    this.q("UPDATE threads SET chat_project_id = ?, chat_context_revision = chat_context_revision + 1 WHERE id = ? AND chat_project_id IS NOT ?").run(chatProjectId, threadId, chatProjectId);
  }

  chatContextRevision(threadId: string): number {
    return (this.q("SELECT chat_context_revision FROM threads WHERE id = ?").get(threadId) as { chat_context_revision: number } | undefined)?.chat_context_revision ?? 0;
  }

  // Authoritative lightweight identity for live streams, prepared dispatches and queued work.
  // One row with small scalars: no toThread(), history/chapters queries or instruction text.
  chatContextIdentity(threadId: string): string | null {
    const row = this.q(`SELECT t.mode, t.project_id, t.chat_project_id, t.temporary, t.chat_context_revision,
      cp.context_revision AS project_context_revision
      FROM threads t LEFT JOIN chat_projects cp ON cp.id = t.chat_project_id WHERE t.id = ?`).get(threadId) as
      { mode: string; project_id: string | null; chat_project_id: string | null; temporary: number; chat_context_revision: number; project_context_revision: number | null } | undefined;
    return row ? JSON.stringify([row.mode, row.project_id, row.chat_project_id, row.temporary, row.chat_context_revision, row.project_context_revision]) : null;
  }

  chatHistoryScope(threadId: string): string | null {
    return (this.q("SELECT chat_history_scope FROM threads WHERE id = ?").get(threadId) as { chat_history_scope: string | null } | undefined)?.chat_history_scope ?? null;
  }

  setChatHistoryScope(threadId: string, scope: string): void {
    this.q("UPDATE threads SET chat_history_scope = ? WHERE id = ?").run(scope, threadId);
  }

  memoryProposals(threadId: string, context: string): ChatMemoryProposal[] {
    return this.q("SELECT id, text, previous_id AS previousId, previous_text AS previousText FROM chat_memory_proposals WHERE thread_id = ? AND context = ? ORDER BY rowid").all(threadId, context) as unknown as ChatMemoryProposal[];
  }

  proposeMemory(threadId: string, context: string, text: string, old?: ChatProjectMemory): void {
    this.q("DELETE FROM chat_memory_proposals WHERE thread_id = ? AND context <> ?").run(threadId, context);
    if (this.memoryProposals(threadId, context).length >= 5) return;
    this.q("INSERT OR IGNORE INTO chat_memory_proposals (id, thread_id, context, text, previous_id, previous_text) VALUES (?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), threadId, context, text, old?.id ?? null, old?.text ?? null);
  }

  dismissMemoryProposal(threadId: string, id: string): void {
    this.q("DELETE FROM chat_memory_proposals WHERE thread_id = ? AND id = ?").run(threadId, id);
  }

  chatProjectMemories(projectId: string): ChatProjectMemory[] {
    return this.q("SELECT id, text FROM chat_project_memories WHERE chat_project_id = ? ORDER BY created_at, id").all(projectId) as unknown as ChatProjectMemory[];
  }

  putChatProjectMemory(projectId: string, item: ChatProjectMemory, previousId?: string): void {
    this.transaction(() => {
      if (previousId) this.q("DELETE FROM chat_project_memories WHERE chat_project_id = ? AND id = ?").run(projectId, previousId);
      this.q("INSERT OR IGNORE INTO chat_project_memories (chat_project_id, id, text, created_at) VALUES (?, ?, ?, ?)").run(projectId, item.id, item.text, Date.now());
    });
  }

  removeChatProjectMemory(projectId: string, id: string): void {
    this.q("DELETE FROM chat_project_memories WHERE chat_project_id = ? AND id = ?").run(projectId, id);
  }

  clearChatProjectMemories(projectId: string): number {
    return Number(this.q("DELETE FROM chat_project_memories WHERE chat_project_id = ?").run(projectId).changes);
  }

  // Sections in the sidebar (round 11): a name to put threads under, one mode each.

  private toSection = (row: any): SidebarSection => ({
    id: row.id,
    name: row.name,
    mode: row.mode,
    position: row.position,
    createdAt: row.created_at,
  });

  sections(): SidebarSection[] {
    return this.q("SELECT * FROM sidebar_sections ORDER BY position, created_at").all().map(this.toSection);
  }

  section(id: string): SidebarSection | undefined {
    const row = this.q("SELECT * FROM sidebar_sections WHERE id = ?").get(id);
    return row ? this.toSection(row) : undefined;
  }

  createSection(name: string, mode: Mode): SidebarSection {
    const id = randomUUID();
    const { last } = this.q("SELECT MAX(position) AS last FROM sidebar_sections WHERE mode = ?").get(mode) as { last: number | null };
    this.q("INSERT INTO sidebar_sections (id, name, mode, position, created_at) VALUES (?, ?, ?, ?, ?)").run(id, name, mode, (last ?? -1) + 1, Date.now());
    return this.section(id)!;
  }

  renameSection(id: string, name: string): void {
    this.q("UPDATE sidebar_sections SET name = ? WHERE id = ?").run(name, id);
  }

  // The threads stay; ON DELETE SET NULL takes them out of the section. Returns the ones that moved.
  deleteSection(id: string): string[] {
    const ids = (this.q("SELECT id FROM threads WHERE section_id = ?").all(id) as { id: string }[]).map((r) => r.id);
    this.q("DELETE FROM sidebar_sections WHERE id = ?").run(id);
    return ids;
  }

  setThreadSection(threadId: string, sectionId: string | null): void {
    this.q("UPDATE threads SET section_id = ? WHERE id = ?").run(sectionId, threadId);
  }

  // Read only conversation boundaries, not streamed tokens. Forked event logs work too.
  promptHistoryReady(threadId: string): boolean {
    let pending = false;
    let answered = 0;
    const rows = this.q(`SELECT seq, event FROM events WHERE thread_id = ? AND event LIKE '{"type":"user.message"%'
      UNION ALL SELECT seq, event FROM events WHERE thread_id = ? AND event LIKE '{"type":"run.finished"%' ORDER BY seq`).iterate(threadId, threadId);
    for (const row of rows) {
      const event = JSON.parse(String(row.event)) as ThreadEvent;
      if (event.type === "user.message") pending = true;
      else if (event.type === "run.finished") {
        if (pending && event.status === "done" && ++answered >= 2) return true;
        pending = false;
      }
    }
    return false;
  }

  recentMessages(threadId: string, limit = 12): Message[] {
    return (this.q("SELECT role, content FROM messages WHERE thread_id = ? ORDER BY idx DESC LIMIT ?").all(threadId, Math.min(32, Math.max(1, limit))) as Array<{ role: Message["role"]; content: string }>).reverse()
      .map((row) => ({ role: row.role, content: JSON.parse(row.content) }));
  }

  // Threads

  private toThread = (row: any): Thread => ({
    ...(row.schedule_notice ? { scheduleNotice: true } : {}),
    id: row.id,
    projectId: row.project_id,
    mode: row.mode,
    title: row.title,
    modelId: row.model_id,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    running: this.isRunning(row.id),
    promptHistoryReady: this.promptHistoryReady(row.id),
    parentThreadId: row.parent_thread_id,
    origin: row.origin,
    permissionCap: row.permission_cap,
    pendingApprovals: this.pendingApprovals(row.id),
    ...(this.pendingQuestions(row.id) ? { pendingQuestions: this.pendingQuestions(row.id) } : {}),
    goal: row.goal ?? null,
    goalSetAt: row.goal_set_at ?? null,
    goalResumedAt: row.goal_resumed_at ?? null,
    goalPausedAt: row.goal_paused_at ?? null,
    goalElapsedMs: row.goal_elapsed_ms ?? 0,
    chapters: row.chapters ? JSON.parse(row.chapters) : [],
    planMode: row.plan_mode === 1,
    plan: row.plan ?? null,
    reasoning: row.reasoning ?? null,
    personality: row.personality ?? null,
    lastStatus: this.lastRun(row.id)?.status ?? null,
    pinned: row.pinned === 1,
    snoozedUntil: row.snoozed_until ?? null,
    ...(row.temporary === 1 ? { temporary: true } : {}),
    ...(row.chat_project_id ? { chatProjectId: row.chat_project_id } : {}),
    ...(row.section_id ? { sectionId: row.section_id } : {}),
    ...(row.chat_tools ? { chatTools: JSON.parse(row.chat_tools) } : {}),
    ...(row.forked_from ? { forkedFrom: JSON.parse(row.forked_from) } : {}),
    ...(row.import_source ? { importedFrom: { source: row.import_source, importedAt: row.imported_at } } : {}),
  });

  threads(): Thread[] {
    return this.q("SELECT * FROM threads ORDER BY updated_at DESC").all().map(this.toThread);
  }

  thread(id: string): Thread | undefined {
    const row = this.q("SELECT * FROM threads WHERE id = ?").get(id);
    return row ? this.toThread(row) : undefined;
  }

  createThread(
    projectId: string | null,
    mode: Mode,
    modelId: string | null,
    options: { title?: string; parentThreadId?: string; permissionCap?: PermissionMode; origin?: "user" | "agent" } = {},
  ): Thread {
    const id = randomUUID();
    const now = Date.now();
    this.q(
      `INSERT INTO threads (id, project_id, mode, title, model_id, created_at, updated_at, parent_thread_id, origin, permission_cap)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, projectId, mode, options.title ?? "Ny tråd", modelId, now, now, options.parentThreadId ?? null,
      options.origin ?? (options.parentThreadId ? "agent" : "user"), options.permissionCap ?? null);
    return this.thread(id)!;
  }

  hasImportedSession(source: HistorySource, session: string): boolean {
    return !!this.q("SELECT 1 FROM threads WHERE import_source = ? AND import_session = ?").get(source, session);
  }

  // The caller commits the project, thread, and both kinds of history in one transaction.
  createImportedThread(projectId: string, session: {
    source: HistorySource;
    sessionId: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: { role: "user" | "assistant"; text: string; at: number; note?: ImportedToolNote }[];
  }, modelId: string | null): string {
    const threadId = randomUUID();
    this.q(`INSERT INTO threads (id, project_id, mode, title, model_id, created_at, updated_at, import_source, import_session, imported_at)
      VALUES (?, ?, 'code', ?, ?, ?, ?, ?, ?, ?)`).run(threadId, projectId, session.title, modelId, session.createdAt, session.updatedAt, session.source, session.sessionId, Date.now());
    const events = session.messages.map(({ role, at, text, note }, index): ThreadEventEnvelope => {
      const messageId = randomUUID();
      const event: ThreadEvent = role === "user" ? { type: "user.message", messageId, text }
        : { type: "history.answer", messageId, text, ...(note ? { note } : {}) };
      return { threadId, seq: index + 1, at, event };
    });
    for (const { seq, at, event } of events) {
      this.q("INSERT INTO events (thread_id, seq, at, event) VALUES (?, ?, ?, ?)").run(threadId, seq, at, JSON.stringify(event));
    }
    for (const message of historyFrom(events)) this.appendMessage(threadId, message);
    return threadId;
  }

  updateThread(id: string, patch: ThreadPatch): void {
    if (patch.title !== undefined) this.q("UPDATE threads SET title = ? WHERE id = ?").run(patch.title, id);
    if (patch.archived !== undefined) this.q("UPDATE threads SET archived = ? WHERE id = ?").run(patch.archived ? 1 : 0, id);
    if (patch.modelId !== undefined) this.q("UPDATE threads SET model_id = ? WHERE id = ?").run(patch.modelId, id);
    if (patch.goal !== undefined) this.setGoal(id, patch.goal);
    if (patch.goalPaused !== undefined) this.pauseGoal(id, patch.goalPaused);
    if (patch.chapter) this.setChapter(id, patch.chapter.messageId, patch.chapter.title);
    if (patch.planMode !== undefined) this.q("UPDATE threads SET plan_mode = ? WHERE id = ?").run(patch.planMode ? 1 : 0, id);
    if (patch.plan !== undefined) this.q("UPDATE threads SET plan = ? WHERE id = ?").run(patch.plan, id);
    if (patch.reasoning !== undefined) this.q("UPDATE threads SET reasoning = ? WHERE id = ?").run(patch.reasoning, id);
    if (patch.personality !== undefined) this.q("UPDATE threads SET personality = ? WHERE id = ?").run(patch.personality, id);
    if (patch.pinned !== undefined) this.q("UPDATE threads SET pinned = ? WHERE id = ?").run(patch.pinned ? 1 : 0, id);
    if (patch.snoozedUntil !== undefined) this.q("UPDATE threads SET snoozed_until = ? WHERE id = ?").run(patch.snoozedUntil, id);
    if (patch.chatTools !== undefined) this.q("UPDATE threads SET chat_tools = ? WHERE id = ?").run(patch.chatTools ? JSON.stringify(patch.chatTools) : null, id);
  }

  // A new goal starts its clock. Editing the text of a running goal keeps the time it has run.
  private setGoal(id: string, goal: string | null): void {
    if (goal === null) {
      this.q("UPDATE threads SET goal = NULL, goal_set_at = NULL, goal_resumed_at = NULL, goal_paused_at = NULL, goal_elapsed_ms = 0 WHERE id = ?").run(id);
      return;
    }
    const had = (this.q("SELECT goal FROM threads WHERE id = ?").get(id) as { goal: string | null } | undefined)?.goal;
    if (had) this.q("UPDATE threads SET goal = ? WHERE id = ?").run(goal, id);
    else {
      const now = Date.now();
      this.q("UPDATE threads SET goal = ?, goal_set_at = ?, goal_resumed_at = ?, goal_paused_at = NULL, goal_elapsed_ms = 0 WHERE id = ?").run(goal, now, now, id);
    }
  }

  private setChapter(id: string, messageId: string, title: string | null): void {
    const row = this.q("SELECT chapters FROM threads WHERE id = ?").get(id) as { chapters: string | null } | undefined;
    const chapters: Chapter[] = (row?.chapters ? JSON.parse(row.chapters) : []).filter((c: Chapter) => c.messageId !== messageId);
    if (title) chapters.push({ messageId, title });
    this.q("UPDATE threads SET chapters = ? WHERE id = ?").run(chapters.length ? JSON.stringify(chapters) : null, id);
  }

  // Round 14 (SPEC 30.3): marks a new thread as a fork of another.
  setForkedFrom(id: string, origin: ForkOrigin): void {
    this.q("UPDATE threads SET forked_from = ? WHERE id = ?").run(JSON.stringify(origin), id);
  }

  // The titles in use, for a fork's default name.
  threadTitles(): Set<string> {
    return new Set((this.q("SELECT title FROM threads").all() as Array<{ title: string }>).map((row) => row.title));
  }

  // A branch up to a message: the events up to seq with their times, and a history for the model
  // rebuilt from them. close ends a run the cut leaves open.
  forkUpTo(sourceId: string, title: string, seq: number, messages: Message[], close: ThreadEvent | null, options: { parentThreadId?: string; permissionCap?: PermissionMode; origin?: "user" | "agent" } = {}): Thread {
    const source = this.thread(sourceId)!;
    const copy = this.createThread(source.projectId, source.mode, source.modelId, { title, ...options });
    if (source.chatProjectId) this.setThreadChatProject(copy.id, source.chatProjectId); // a copy stays in the Chat project
    if (source.temporary) this.markTemporary(copy.id);
    if (source.sectionId) this.setThreadSection(copy.id, source.sectionId); // and in its section
    if (source.chatTools) this.updateThread(copy.id, { chatTools: source.chatTools }); // and keeps the tools chosen
    this.transaction(() => {
      this.q("INSERT INTO events (thread_id, seq, at, event) SELECT ?, seq, at, event FROM events WHERE thread_id = ? AND seq <= ?").run(copy.id, sourceId, seq);
      for (const message of messages) this.appendMessage(copy.id, message);
      this.q("UPDATE threads SET reasoning = ?, personality = ? WHERE id = ?").run(source.reasoning, source.personality, copy.id);
    });
    this.seqs.delete(copy.id);
    if (close) this.appendEvent(copy.id, close);
    return this.thread(copy.id)!;
  }

  private pauseGoal(id: string, paused: boolean): void {
    const row = this.q("SELECT goal, goal_resumed_at, goal_paused_at FROM threads WHERE id = ?").get(id) as
      | { goal: string | null; goal_resumed_at: number | null; goal_paused_at: number | null }
      | undefined;
    if (!row?.goal) return;
    const now = Date.now();
    if (paused && row.goal_paused_at === null) {
      this.q("UPDATE threads SET goal_elapsed_ms = goal_elapsed_ms + ?, goal_paused_at = ?, goal_resumed_at = NULL WHERE id = ?")
        .run(Math.max(0, now - (row.goal_resumed_at ?? now)), now, id);
    } else if (!paused && row.goal_paused_at !== null) {
      this.q("UPDATE threads SET goal_resumed_at = ?, goal_paused_at = NULL WHERE id = ?").run(now, id);
    }
  }

  // A copy with the same history, events and model state. Runs, turns and the queue stay behind:
  // the copy starts idle, and Angre tur only works in the original.
  forkThread(sourceId: string, title: string): Thread {
    const source = this.thread(sourceId)!;
    const copy = this.createThread(source.projectId, source.mode, source.modelId, { title });
    if (source.chatProjectId) this.setThreadChatProject(copy.id, source.chatProjectId); // a copy stays in the Chat project
    if (source.temporary) this.markTemporary(copy.id);
    if (source.sectionId) this.setThreadSection(copy.id, source.sectionId); // and in its section
    if (source.chatTools) this.updateThread(copy.id, { chatTools: source.chatTools }); // and keeps the tools chosen
    this.transaction(() => {
      this.q("INSERT INTO events (thread_id, seq, at, event) SELECT ?, seq, at, event FROM events WHERE thread_id = ?").run(copy.id, sourceId);
      this.q("INSERT INTO messages (thread_id, idx, role, content) SELECT ?, idx, role, content FROM messages WHERE thread_id = ?").run(copy.id, sourceId);
      this.q("UPDATE threads SET usage = (SELECT usage FROM threads WHERE id = ?), goal = ?, plan_mode = ?, plan = ?, reasoning = ?, personality = ? WHERE id = ?")
        .run(sourceId, source.goal, source.planMode ? 1 : 0, source.plan, source.reasoning, source.personality, copy.id);
      this.q("UPDATE threads SET goal_set_at = ?, goal_resumed_at = ?, goal_paused_at = ?, goal_elapsed_ms = ? WHERE id = ?")
        .run(source.goalSetAt, source.goalResumedAt, source.goalPausedAt, source.goalElapsedMs, copy.id);
    });
    this.seqs.delete(copy.id);
    return this.thread(copy.id)!;
  }

  // A branch from the last message: only the last user message and what followed it, renumbered
  // from 1, so the copy starts small. Usage starts again, since the context is new.
  forkFromLast(sourceId: string, title: string): Thread {
    const source = this.thread(sourceId)!;
    const copy = this.createThread(source.projectId, source.mode, source.modelId, { title });
    if (source.chatProjectId) this.setThreadChatProject(copy.id, source.chatProjectId); // a copy stays in the Chat project
    if (source.temporary) this.markTemporary(copy.id);
    if (source.sectionId) this.setThreadSection(copy.id, source.sectionId); // and in its section
    if (source.chatTools) this.updateThread(copy.id, { chatTools: source.chatTools }); // and keeps the tools chosen
    const firstSeq = (this.q(`SELECT MAX(seq) AS seq FROM events WHERE thread_id = ? AND event LIKE '{"type":"user.message"%'`).get(sourceId) as { seq: number | null }).seq;
    const rows = this.q("SELECT idx, role, content FROM messages WHERE thread_id = ? ORDER BY idx").all(sourceId) as Array<{ idx: number; role: string; content: string }>;
    let from = rows.length;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].role === "user" && (JSON.parse(rows[i].content) as Array<{ type: string }>).some((b) => b.type === "text")) {
        from = i;
        break;
      }
    }
    this.transaction(() => {
      if (firstSeq !== null) {
        this.q("INSERT INTO events (thread_id, seq, at, event) SELECT ?, seq - ? + 1, at, event FROM events WHERE thread_id = ? AND seq >= ?").run(copy.id, firstSeq, sourceId, firstSeq);
      }
      rows.slice(from).forEach((row, i) => this.q("INSERT INTO messages (thread_id, idx, role, content) VALUES (?, ?, ?, ?)").run(copy.id, i, row.role, row.content));
      this.q("UPDATE threads SET reasoning = ?, personality = ? WHERE id = ?").run(source.reasoning, source.personality, copy.id);
    });
    this.seqs.delete(copy.id);
    return this.thread(copy.id)!;
  }

  // Lines added and removed per thread, from the changes of turns that are not reverted. For the
  // cards in the smart sidebar.
  threadDiffStats(): Record<string, { additions: number; deletions: number }> {
    const out: Record<string, { additions: number; deletions: number }> = {};
    const reverted = new Set<string>();
    const rows = this.q(`SELECT thread_id, event FROM events WHERE event LIKE '{"type":"turn.%' ORDER BY thread_id, seq`).all() as Array<{ thread_id: string; event: string }>;
    for (const row of rows) {
      const event = JSON.parse(row.event) as ThreadEvent;
      if (event.type === "turn.reverted") reverted.add(event.turnId);
    }
    for (const row of rows) {
      const event = JSON.parse(row.event) as ThreadEvent;
      if (event.type !== "turn.changes" || reverted.has(event.turnId)) continue;
      const stat = (out[row.thread_id] ??= { additions: 0, deletions: 0 });
      for (const file of event.files) {
        stat.additions += file.additions;
        stat.deletions += file.deletions;
      }
    }
    return out;
  }

  // Only indexed turn metadata, including forked history; no message text or file snapshots.
  summaryChanges(threadId: string): SummaryTurnChanges[] {
    const turns = new Map<string, SummaryTurnChanges>();
    const reverted = new Set<string>();
    const rows = this.q(`SELECT event FROM events WHERE thread_id = ? AND event LIKE '{"type":"turn.%' ORDER BY seq`).all(threadId) as Array<{ event: string }>;
    for (const row of rows) {
      const event = JSON.parse(row.event) as ThreadEvent;
      if (event.type === "turn.changes") turns.set(event.turnId, { turnId: event.turnId, files: event.files, reverted: reverted.has(event.turnId) });
      if (event.type === "turn.reverted") {
        reverted.add(event.turnId);
        const turn = turns.get(event.turnId);
        if (turn) turn.reverted = true;
      }
    }
    return [...turns.values()];
  }

  touchThread(id: string): void {
    this.q("UPDATE threads SET updated_at = ? WHERE id = ?").run(Date.now(), id);
  }

  deleteThread(id: string): void {
    this.seqs.delete(id);
    this.q("DELETE FROM threads WHERE id = ?").run(id);
  }

  // Chat: a temporary chat is left out of search and deleted when it is closed or left idle.
  markTemporary(id: string): void {
    this.q("UPDATE threads SET temporary = 1 WHERE id = ?").run(id);
  }

  hasTemporaryThreads(): boolean {
    return this.q("SELECT 1 FROM threads WHERE temporary = 1 LIMIT 1").get() !== undefined;
  }

  temporaryThreadsIdleSince(before: number): string[] {
    return (this.q("SELECT id FROM threads WHERE temporary = 1 AND updated_at < ?").all(before) as Array<{ id: string }>).map((row) => row.id);
  }

  archivedThreads(): Thread[] {
    return this.q("SELECT * FROM threads WHERE archived = 1 ORDER BY updated_at DESC").all().map(this.toThread);
  }

  searchThreads(query: string): Thread[] {
    const like = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    return this.q(
      `SELECT * FROM threads t WHERE t.temporary = 0 AND (t.title LIKE ? ESCAPE '\\'
         OR EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id AND m.content LIKE ? ESCAPE '\\'))
       ORDER BY t.updated_at DESC LIMIT 100`,
    ).all(like, like).map(this.toThread);
  }

  projectThreads(projectId: string): Thread[] {
    return this.q("SELECT * FROM threads WHERE project_id = ? ORDER BY updated_at DESC").all(projectId).map(this.toThread);
  }

  projectUsage(projectId: string): Usage {
    const total = emptyUsage();
    const rows = this.q("SELECT usage FROM threads WHERE project_id = ? AND usage IS NOT NULL").all(projectId) as { usage: string }[];
    for (const row of rows) {
      const usage: Usage = JSON.parse(row.usage);
      total.inputTokens += usage.inputTokens;
      total.outputTokens += usage.outputTokens;
      total.cachedInputTokens += usage.cachedInputTokens;
      if (usage.costUsd !== null) total.costUsd = (total.costUsd ?? 0) + usage.costUsd;
    }
    return total;
  }

  layout(key: string): unknown {
    const row = this.q("SELECT value FROM meta WHERE key = ?").get(`layout:${key}`) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }

  setLayout(key: string, layout: unknown): void {
    this.q("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(`layout:${key}`, JSON.stringify(layout));
  }

  // A JSON value of the app's own, such as the MCP servers (mcp/manager.ts). Never from the API.
  metaValue(key: string): unknown {
    const row = this.q("SELECT value FROM meta WHERE key = ?").get(`app:${key}`) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }

  setMetaValue(key: string, value: unknown): void {
    this.q("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(`app:${key}`, JSON.stringify(value));
  }

  usage(threadId: string): Usage {
    const row = this.q("SELECT usage FROM threads WHERE id = ?").get(threadId) as { usage: string | null } | undefined;
    return row?.usage ? JSON.parse(row.usage) : emptyUsage();
  }

  setUsage(threadId: string, usage: Usage): void {
    this.q("UPDATE threads SET usage = ? WHERE id = ?").run(JSON.stringify(usage), threadId);
  }

  // Events

  appendEvent(threadId: string, event: ThreadEvent): ThreadEventEnvelope {
    const seq = this.lastSeq(threadId) + 1;
    const at = Date.now();
    this.q("INSERT INTO events (thread_id, seq, at, event) VALUES (?, ?, ?, ?)").run(threadId, seq, at, JSON.stringify(event));
    this.seqs.set(threadId, seq);
    return { seq, threadId, at, event };
  }

  lastSeq(threadId: string): number {
    const known = this.seqs.get(threadId);
    if (known !== undefined) return known;
    const row = this.q("SELECT MAX(seq) AS seq FROM events WHERE thread_id = ?").get(threadId) as { seq: number | null };
    return row.seq ?? 0;
  }

  private toEnvelope = (row: any): ThreadEventEnvelope => ({
    seq: row.seq,
    threadId: row.thread_id,
    at: row.at,
    event: JSON.parse(row.event),
  });

  events(threadId: string, after: number, limit: number): ThreadEventEnvelope[] {
    return this.q("SELECT * FROM events WHERE thread_id = ? AND seq > ? ORDER BY seq LIMIT ?")
      .all(threadId, after, limit).map(this.toEnvelope);
  }

  eventsTail(threadId: string, limit: number): ThreadEventEnvelope[] {
    return this.q("SELECT * FROM events WHERE thread_id = ? ORDER BY seq DESC LIMIT ?")
      .all(threadId, limit).map(this.toEnvelope).reverse();
  }

  // The same envelopes as events() and eventsTail(), as the JSON text JSON.stringify would give.
  // A stored event is already that text, so opening a long thread does not parse and serialize
  // every event again only to send it on.
  eventsJson(threadId: string, after: number, limit: number): string[] {
    return this.q("SELECT * FROM events WHERE thread_id = ? AND seq > ? ORDER BY seq LIMIT ?")
      .all(threadId, after, limit).map(envelopeJson);
  }

  eventsTailJson(threadId: string, limit: number): string[] {
    return this.q("SELECT * FROM events WHERE thread_id = ? ORDER BY seq DESC LIMIT ?")
      .all(threadId, limit).map(envelopeJson).reverse();
  }

  // Model-visible history

  messages(threadId: string): Message[] {
    return this.q("SELECT role, content FROM messages WHERE thread_id = ? ORDER BY idx").all(threadId)
      .map((row: any) => ({ role: row.role, content: JSON.parse(row.content) }));
  }

  hasMessages(threadId: string): boolean {
    return this.q("SELECT 1 FROM messages WHERE thread_id = ? LIMIT 1").get(threadId) !== undefined;
  }

  appendMessage(threadId: string, message: Message): void {
    this.q("INSERT INTO messages (thread_id, idx, role, content) SELECT ?, COALESCE(MAX(idx), -1) + 1, ?, ? FROM messages WHERE thread_id = ?")
      .run(threadId, message.role, JSON.stringify(message.content), threadId);
  }

  replaceMessages(threadId: string, messages: Message[]): void {
    this.transaction(() => {
      this.q("DELETE FROM messages WHERE thread_id = ?").run(threadId);
      for (const message of messages) this.appendMessage(threadId, message);
    });
  }

  historyRevision(threadId: string): number {
    const row = this.q("SELECT history_revision FROM threads WHERE id = ?").get(threadId) as { history_revision: number } | undefined;
    return Number(row?.history_revision ?? 0);
  }

  // Chat: back to just before seq, to edit a message or make an answer again. The events and runs
  // from there on go, and the model's history is replaced. seq numbers are used again afterwards.
  rewindThread(threadId: string, seq: number, messages: Message[]): void {
    this.transaction(() => {
      this.q("DELETE FROM events WHERE thread_id = ? AND seq >= ?").run(threadId, seq);
      this.q("DELETE FROM turns WHERE run_id IN (SELECT id FROM runs WHERE thread_id = ? AND start_seq >= ?)").run(threadId, seq);
      this.q("DELETE FROM runs WHERE thread_id = ? AND start_seq >= ?").run(threadId, seq);
      this.q("DELETE FROM messages WHERE thread_id = ?").run(threadId);
      for (const message of messages) this.appendMessage(threadId, message);
      this.q("UPDATE threads SET history_revision = history_revision + 1 WHERE id = ?").run(threadId);
    });
    this.seqs.delete(threadId);
  }

  // Runs and queue

  createRun(run: { id: string; threadId: string; modelId: string; turnId: string; startSeq: number }): void {
    this.q("INSERT INTO runs (id, thread_id, model_id, turn_id, status, start_seq, started_at) VALUES (?, ?, ?, ?, 'running', ?, ?)")
      .run(run.id, run.threadId, run.modelId, run.turnId, run.startSeq, Date.now());
    this.q("INSERT INTO turns (id, thread_id, run_id, created_at) VALUES (?, ?, ?, ?)").run(run.turnId, run.threadId, run.id, Date.now());
  }

  finishRun(id: string, status: RunStatus, error?: string): void {
    this.q("UPDATE runs SET status = ?, finished_at = ?, error = ? WHERE id = ?").run(status, Date.now(), error ?? null, id);
  }

  activeRuns(): RunRow[] {
    return this.q("SELECT id, thread_id, turn_id, status, start_seq FROM runs WHERE status = 'running'").all()
      .map((row: any) => ({ id: row.id, threadId: row.thread_id, turnId: row.turn_id, status: row.status, startSeq: row.start_seq }));
  }

  runWatchStatus(threadId: string, runId: string | null): { id: string; status: RunStatus } | null {
    const row = runId
      ? this.q("SELECT id, status FROM runs WHERE thread_id = ? AND id = ?").get(threadId, runId)
      : this.q("SELECT id, status FROM runs WHERE thread_id = ? ORDER BY start_seq DESC, rowid DESC LIMIT 1").get(threadId);
    return row ? { id: String(row.id), status: row.status as RunStatus } : null;
  }

  lastRun(threadId: string): { status: RunStatus; error: string | null } | undefined {
    const row = this.q("SELECT status, error, MAX(start_seq) FROM runs WHERE thread_id = ?").get(threadId) as any;
    return row?.status ? { status: row.status, error: row.error } : undefined;
  }

  // Round 12 (SPEC 26.2): when the thread's last run started and ended, for Økt's background tasks.
  lastRunTimes(threadId: string): { startedAt: number; finishedAt: number | null } | undefined {
    const row = this.q("SELECT started_at, finished_at, MAX(start_seq) FROM runs WHERE thread_id = ?").get(threadId) as any;
    return row?.started_at ? { startedAt: row.started_at, finishedAt: row.finished_at ?? null } : undefined;
  }

  enqueue(threadId: string, id: string, payload: unknown): void {
    this.q("INSERT INTO queue (id, thread_id, payload, created_at) VALUES (?, ?, ?, ?)").run(id, threadId, JSON.stringify(payload), Date.now());
  }

  dequeue<T>(threadId: string): T | undefined {
    const row = this.q("SELECT id, payload FROM queue WHERE thread_id = ? ORDER BY created_at, rowid LIMIT 1").get(threadId) as
      | { id: string; payload: string }
      | undefined;
    if (!row) return undefined;
    this.q("DELETE FROM queue WHERE id = ?").run(row.id);
    return JSON.parse(row.payload);
  }

  // Round 6: steered messages leave the queue at a step of the running turn, in order.
  takeQueued<T>(threadId: string, pick: (payload: T) => boolean): T[] {
    const rows = this.q("SELECT id, payload FROM queue WHERE thread_id = ? ORDER BY created_at, rowid").all(threadId) as Array<{ id: string; payload: string }>;
    const taken: T[] = [];
    for (const row of rows) {
      const payload = JSON.parse(row.payload) as T;
      if (!pick(payload)) continue;
      this.q("DELETE FROM queue WHERE id = ?").run(row.id);
      taken.push(payload);
    }
    return taken;
  }

  // Changes a queued message in place. False when it is no longer in the queue.
  updateQueued<T>(threadId: string, id: string, change: (payload: T) => T): boolean {
    const row = this.q("SELECT payload FROM queue WHERE id = ? AND thread_id = ?").get(id, threadId) as { payload: string } | undefined;
    if (!row) return false;
    this.q("UPDATE queue SET payload = ? WHERE id = ?").run(JSON.stringify(change(JSON.parse(row.payload) as T)), id);
    return true;
  }

  setQueuedDraft(threadId: string, payload: unknown): void {
    this.q("INSERT OR REPLACE INTO queue_drafts (thread_id, payload) VALUES (?, ?)").run(threadId, JSON.stringify(payload));
  }

  queuedDraft<T>(threadId: string): T | null {
    const row = this.q("SELECT payload FROM queue_drafts WHERE thread_id = ?").get(threadId) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as T : null;
  }

  clearQueuedDraft(threadId: string): void {
    this.q("DELETE FROM queue_drafts WHERE thread_id = ?").run(threadId);
  }

  queuedJobs<T>(threadId: string): T[] {
    return (this.q("SELECT payload FROM queue WHERE thread_id = ? ORDER BY created_at, rowid").all(threadId) as Array<{ payload: string }>).map((row) => JSON.parse(row.payload) as T);
  }

  // Claim one queued item synchronously, with validation before removal. A runner that has
  // already consumed it wins: callers receive undefined and must not create a duplicate draft.
  removeQueued<T>(threadId: string, id: string, validate: (payload: T) => void): T | undefined {
    return this.transaction(() => {
      const row = this.q("SELECT payload FROM queue WHERE id = ? AND thread_id = ?").get(id, threadId) as { payload: string } | undefined;
      if (!row) return undefined;
      const payload = JSON.parse(row.payload) as T;
      validate(payload);
      this.q("DELETE FROM queue WHERE id = ? AND thread_id = ?").run(id, threadId);
      return payload;
    });
  }

  hasQueued(threadId: string): boolean {
    return this.q("SELECT 1 FROM queue WHERE thread_id = ? LIMIT 1").get(threadId) !== undefined;
  }

  queuedThreads(): string[] {
    return this.q("SELECT DISTINCT thread_id FROM queue").all().map((row: any) => row.thread_id);
  }

  // Turns

  turnThread(turnId: string): { threadId: string; runId: string; revertedAt: number | null } | undefined {
    const row = this.q("SELECT thread_id, run_id, reverted_at FROM turns WHERE id = ?").get(turnId) as any;
    return row ? { threadId: row.thread_id, runId: row.run_id, revertedAt: row.reverted_at } : undefined;
  }

  markTurnReverted(turnId: string): void {
    this.q("UPDATE turns SET reverted_at = ? WHERE id = ?").run(Date.now(), turnId);
  }

  hasTurnFile(turnId: string, file: string): boolean {
    return this.q("SELECT 1 FROM turn_files WHERE turn_id = ? AND path = ?").get(turnId, file) !== undefined;
  }

  addTurnFile(turnId: string, file: string, before: Uint8Array | null): void {
    this.q("INSERT INTO turn_files (turn_id, path, before) VALUES (?, ?, ?)").run(turnId, file, before);
  }

  recordTurnFileAfter(turnId: string, file: string, after: Uint8Array | null): void {
    this.q("UPDATE turn_files SET after = ?, after_captured = 1 WHERE turn_id = ? AND path = ?")
      .run(after, turnId, file);
  }

  updateUncapturedTurnFileBefore(turnId: string, file: string, before: Uint8Array | null): void {
    this.q("UPDATE turn_files SET before = ? WHERE turn_id = ? AND path = ? AND after_captured = 0")
      .run(before, turnId, file);
  }

  markTurnFileInterleaved(turnId: string, file: string): void {
    this.q("UPDATE turn_files SET interleaved = 1 WHERE turn_id = ? AND path = ?").run(turnId, file);
  }

  finishTurnFile(turnId: string, file: TurnFileRow): void {
    this.q("UPDATE turn_files SET after = ?, change = ?, additions = ?, deletions = ? WHERE turn_id = ? AND path = ?")
      .run(file.after, file.change, file.additions, file.deletions, turnId, file.path);
  }

  turnFiles(turnId: string): TurnFileRow[] {
    return this.q("SELECT path, before, after, change, additions, deletions, after_captured, interleaved FROM turn_files WHERE turn_id = ? ORDER BY path")
      .all(turnId).map((row: any) => ({ path: row.path, before: row.before, after: row.after, change: row.change, additions: row.additions, deletions: row.deletions, afterCaptured: row.after_captured === 1, interleaved: row.interleaved === 1 }));
  }

  // Providers and models

  private toProvider = (row: any): StoredProvider => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    presetId: row.preset_id ?? undefined,
    credentialId: row.credential_id ?? undefined,
    baseUrl: row.base_url ?? undefined,
    apiKeyEnv: row.api_key_env ?? undefined,
  });

  providers(): StoredProvider[] {
    return this.q("SELECT * FROM providers ORDER BY name").all().map(this.toProvider);
  }

  provider(id: string): StoredProvider | undefined {
    const row = this.q("SELECT * FROM providers WHERE id = ?").get(id);
    return row ? this.toProvider(row) : undefined;
  }

  createProvider(provider: Omit<StoredProvider, "id">): StoredProvider {
    const id = randomUUID();
    this.q("INSERT INTO providers (id, kind, name, base_url, api_key_env, preset_id) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, provider.kind, provider.name, provider.baseUrl ?? null, provider.apiKeyEnv ?? null, provider.presetId ?? null);
    return this.provider(id)!;
  }

  updateProvider(id: string, patch: Partial<Omit<StoredProvider, "id" | "kind">>): void {
    this.transaction(() => {
      if (patch.name !== undefined) this.q("UPDATE providers SET name = ? WHERE id = ?").run(patch.name, id);
      if (patch.baseUrl !== undefined) this.q("UPDATE providers SET base_url = ? WHERE id = ?").run(patch.baseUrl || null, id);
      if (patch.apiKeyEnv !== undefined) this.q("UPDATE providers SET api_key_env = ? WHERE id = ?").run(patch.apiKeyEnv || null, id);
      if (patch.credentialId !== undefined) this.q("UPDATE providers SET credential_id = ? WHERE id = ?").run(patch.credentialId, id);
    });
  }

  deleteProvider(id: string): void {
    this.q("DELETE FROM providers WHERE id = ?").run(id);
  }

  private toModel = (row: any): ModelConfig => {
    const model: ModelConfig = {
      id: row.id,
      providerId: row.provider_id,
      name: row.name,
      model: row.model,
      contextWindow: row.context_window,
      ...(row.options ? JSON.parse(row.options) : {}),
    };
    if (row.input_price !== null) model.inputPricePerMTok = row.input_price;
    if (row.output_price !== null) model.outputPricePerMTok = row.output_price;
    return model;
  };

  answerModel(model: ModelConfig): AnswerModel {
    const provider = this.provider(model.providerId);
    return { modelId: model.id, modelName: model.name, model: model.model, providerId: model.providerId, ...(provider ? { providerName: provider.name } : {}) };
  }

  models(): ModelConfig[] {
    return this.q("SELECT * FROM models ORDER BY name").all().map(this.toModel);
  }

  model(id: string): ModelConfig | undefined {
    const row = this.q("SELECT * FROM models WHERE id = ?").get(id);
    return row ? this.toModel(row) : undefined;
  }

  saveModel(model: ModelConfig): ModelConfig {
    const { id, providerId, name, model: modelName, contextWindow, inputPricePerMTok, outputPricePerMTok, ...options } = model;
    this.q(
      `INSERT INTO models (id, provider_id, name, model, context_window, input_price, output_price, options)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET provider_id = excluded.provider_id, name = excluded.name, model = excluded.model,
         context_window = excluded.context_window, input_price = excluded.input_price,
         output_price = excluded.output_price, options = excluded.options`,
    ).run(id, providerId, name, modelName, contextWindow, inputPricePerMTok ?? null, outputPricePerMTok ?? null, JSON.stringify(options));
    return this.model(id)!;
  }

  deleteModel(id: string): void {
    this.q("DELETE FROM models WHERE id = ?").run(id);
  }

  // Each usage event holds the thread's running total, so the difference to the previous one is
  // what that step used. Shared by the profile and the start page.
  private usageSteps(): Array<{ at: number; tokens: number; input: number; output: number; modelId: string; threadId: string }> {
    const runModel = new Map<string, string>();
    for (const row of this.q("SELECT id, model_id FROM runs").all() as Array<{ id: string; model_id: string }>) runModel.set(row.id, row.model_id);
    const steps: Array<{ at: number; tokens: number; input: number; output: number; modelId: string; threadId: string }> = [];
    let lastThread = "";
    let previous = { in: 0, out: 0 };
    const rows = this.q(`SELECT thread_id, at, event FROM events WHERE event LIKE '{"type":"usage"%' ORDER BY thread_id, seq`).all() as Array<{ thread_id: string; at: number; event: string }>;
    for (const row of rows) {
      if (row.thread_id !== lastThread) {
        lastThread = row.thread_id;
        previous = { in: 0, out: 0 };
      }
      const event = JSON.parse(row.event) as Extract<ThreadEvent, { type: "usage" }>;
      // A fork starts from the original's totals, so a step can never count below zero.
      const dIn = Math.max(0, event.usage.inputTokens - previous.in);
      const dOut = Math.max(0, event.usage.outputTokens - previous.out);
      previous = { in: event.usage.inputTokens, out: event.usage.outputTokens };
      steps.push({ at: row.at, tokens: dIn + dOut, input: dIn, output: dOut, modelId: runModel.get(event.runId) ?? "ukjent", threadId: row.thread_id });
    }
    return steps;
  }

  // Profile: token use per day and per model, from the usage events.
  profileStats(now = Date.now()): ProfileStats {
    const dayAt = dayLookup();
    const days = new Map<string, { tokens: number; runs: number }>();
    const models = new Map<string, { tokens: number; runs: number }>();
    const day = (date: string) => days.get(date) ?? days.set(date, { tokens: 0, runs: 0 }).get(date)!;
    const model = (id: string) => models.get(id) ?? models.set(id, { tokens: 0, runs: 0 }).get(id)!;
    let input = 0;
    let output = 0;
    for (const step of this.usageSteps()) {
      input += step.input;
      output += step.output;
      day(dayAt(step.at)).tokens += step.tokens;
      model(step.modelId).tokens += step.tokens;
    }
    const runs = this.q("SELECT model_id, started_at FROM runs").all() as Array<{ model_id: string; started_at: number }>;
    for (const run of runs) {
      day(dayAt(run.started_at)).runs += 1;
      model(run.model_id).runs += 1;
    }

    const active = [...days.entries()].filter(([, d]) => d.tokens > 0 || d.runs > 0).map(([date]) => date).sort();
    const streaks = countStreaks(active, dayOf(now));
    let peak: ProfileStats["peakDay"] = null;
    for (const [date, d] of days) if (d.tokens > 0 && (!peak || d.tokens > peak.tokens)) peak = { date, tokens: d.tokens };
    const today = dayOf(now);
    const recent: ProfileStats["days"] = [];
    for (let i = 27; i >= 0; i--) {
      const date = minusDays(today, i);
      recent.push({ date, tokens: days.get(date)?.tokens ?? 0, runs: days.get(date)?.runs ?? 0 });
    }
    return {
      totalTokens: input + output,
      inputTokens: input,
      outputTokens: output,
      threads: (this.q("SELECT COUNT(*) AS n FROM threads").get() as { n: number }).n,
      runs: runs.length,
      activeDays: active.length,
      currentStreak: streaks.current,
      longestStreak: streaks.longest,
      peakDay: peak,
      days: recent,
      byModel: this.namedModels(models),
      costUsd: this.totalCost(),
      longestRunMs: (this.q("SELECT MAX(finished_at - started_at) AS ms FROM runs WHERE finished_at IS NOT NULL").get() as { ms: number | null }).ms ?? null,
      year: this.yearGrid(days, today),
    };
  }

  // 52 whole weeks back to a Monday, through today: the token map on the profile page.
  private yearGrid(days: Map<string, { tokens: number; runs: number }>, today: string): ProfileStats["year"] {
    const weekday = (new Date(`${today}T12:00:00`).getDay() + 6) % 7; // Monday is 0
    const grid: ProfileStats["year"] = [];
    for (let date = minusDays(today, 52 * 7 + weekday); date <= today; date = minusDays(date, -1)) {
      grid.push({ date, tokens: days.get(date)?.tokens ?? 0, runs: days.get(date)?.runs ?? 0 });
    }
    return grid;
  }

  // The start page: the same numbers over all time, the last 30 days or the last 7, with today
  // counted as one of them. The heat map always covers 26 whole weeks, Monday first.
  homeStats(range: StatsRange, now = Date.now()): HomeStats {
    const dayAt = dayLookup();
    const today = dayOf(now);
    const first = range === "all" ? "" : minusDays(today, range === "30d" ? 29 : 6);
    const inRange = (at: number) => dayAt(at) >= first;
    const days = new Map<string, { tokens: number; runs: number }>();
    const models = new Map<string, { tokens: number; runs: number }>();
    const day = (date: string) => days.get(date) ?? days.set(date, { tokens: 0, runs: 0 }).get(date)!;
    const model = (id: string) => models.get(id) ?? models.set(id, { tokens: 0, runs: 0 }).get(id)!;
    const heat = new Map<string, { tokens: number; runs: number }>();
    const heatDay = (date: string) => heat.get(date) ?? heat.set(date, { tokens: 0, runs: 0 }).get(date)!;
    let total = 0;
    for (const step of this.usageSteps()) {
      heatDay(dayAt(step.at)).tokens += step.tokens;
      if (!inRange(step.at)) continue;
      total += step.tokens;
      day(dayAt(step.at)).tokens += step.tokens;
      model(step.modelId).tokens += step.tokens;
    }
    const sessions = new Set<string>();
    const hours = new Array<number>(24).fill(0);
    const runs = this.q("SELECT thread_id, model_id, started_at FROM runs").all() as Array<{ thread_id: string; model_id: string; started_at: number }>;
    for (const run of runs) {
      heatDay(dayAt(run.started_at)).runs += 1;
      if (!inRange(run.started_at)) continue;
      sessions.add(run.thread_id);
      day(dayAt(run.started_at)).runs += 1;
      model(run.model_id).runs += 1;
      hours[new Date(run.started_at).getHours()] += 1;
    }
    let messages = 0;
    const messageRows = this.q(`SELECT at FROM events WHERE event LIKE '{"type":"user.message"%'`).all() as Array<{ at: number }>;
    for (const row of messageRows) if (inRange(row.at)) messages += 1;

    const active = [...days.entries()].filter(([, d]) => d.tokens > 0 || d.runs > 0).map(([date]) => date).sort();
    const streaks = countStreaks(active, today);
    const peakRuns = Math.max(...hours);
    const byModel = this.namedModels(models);
    const favorite = byModel.find((m) => m.tokens > 0 || m.runs > 0);

    // 26 weeks back to a Monday, through today.
    const weekday = (new Date(`${today}T12:00:00`).getDay() + 6) % 7; // Monday is 0
    const start = minusDays(today, 25 * 7 + weekday);
    const grid: HomeStats["heat"] = [];
    for (let date = start; date <= today; date = minusDays(date, -1)) grid.push({ date, tokens: heat.get(date)?.tokens ?? 0, runs: heat.get(date)?.runs ?? 0 });

    return {
      range,
      sessions: sessions.size,
      messages,
      totalTokens: total,
      activeDays: active.length,
      currentStreak: streaks.current,
      longestStreak: streaks.longest,
      peakHour: peakRuns > 0 ? hours.indexOf(peakRuns) : null,
      favoriteModel: favorite ? { modelId: favorite.modelId, name: favorite.name } : null,
      byModel,
      heat: grid,
    };
  }

  // Cost is only known where a price was set, so threads without one are left out, not counted as 0.
  private totalCost(): number | null {
    let total: number | null = null;
    for (const row of this.q("SELECT usage FROM threads WHERE usage IS NOT NULL").all() as Array<{ usage: string }>) {
      const cost = (JSON.parse(row.usage) as Usage).costUsd;
      if (typeof cost === "number") total = (total ?? 0) + cost;
    }
    return total;
  }

  private namedModels(models: Map<string, { tokens: number; runs: number }>): ProfileStats["byModel"] {
    const names = new Map(this.models().map((m) => [m.id, m.name]));
    return [...models.entries()]
      .map(([modelId, m]) => ({ modelId, name: names.get(modelId) ?? "Slettet modell", tokens: m.tokens, runs: m.runs }))
      .sort((a, b) => b.tokens - a.tokens || b.runs - a.runs);
  }

  // Agent Teams task list

  private toTask = (row: any): TeamTask => ({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    ownerThreadId: row.owner_thread_id,
    createdByThreadId: row.created_by_thread_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  tasks(projectId: string): TeamTask[] {
    return this.q("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at, rowid").all(projectId).map(this.toTask);
  }

  task(id: string): TeamTask | undefined {
    const row = this.q("SELECT * FROM tasks WHERE id = ?").get(id);
    return row ? this.toTask(row) : undefined;
  }

  addTask(projectId: string, title: string, createdBy: string | null, owner: string | null): TeamTask {
    const id = randomUUID().slice(0, 8);
    const now = Date.now();
    this.q("INSERT INTO tasks (id, project_id, title, status, owner_thread_id, created_by_thread_id, created_at, updated_at) VALUES (?, ?, ?, 'todo', ?, ?, ?, ?)")
      .run(id, projectId, title, owner, createdBy, now, now);
    return this.task(id)!;
  }

  updateTask(id: string, patch: { status?: TeamTaskStatus; title?: string; ownerThreadId?: string | null }): void {
    if (patch.status) this.q("UPDATE tasks SET status = ? WHERE id = ?").run(patch.status, id);
    if (patch.title !== undefined) this.q("UPDATE tasks SET title = ? WHERE id = ?").run(patch.title, id);
    if (patch.ownerThreadId !== undefined) this.q("UPDATE tasks SET owner_thread_id = ? WHERE id = ?").run(patch.ownerThreadId, id);
    this.q("UPDATE tasks SET updated_at = ? WHERE id = ?").run(Date.now(), id);
  }

  deleteTask(id: string): void {
    this.q("DELETE FROM tasks WHERE id = ?").run(id);
  }

  // Turns of a thread that changed files and are not reverted, oldest first, for /review.
  reviewTurns(threadId: string): string[] {
    return (this.q(
      "SELECT t.id FROM turns t WHERE t.thread_id = ? AND t.reverted_at IS NULL AND EXISTS (SELECT 1 FROM turn_files f WHERE f.turn_id = t.id AND f.change IS NOT NULL) ORDER BY t.created_at",
    ).all(threadId) as Array<{ id: string }>).map((r) => r.id);
  }

  // Only for tests and the seed script: moves a thread's history back in time.
  shiftThreadTime(threadId: string, ms: number): void {
    this.q("UPDATE events SET at = at - ? WHERE thread_id = ?").run(ms, threadId);
    this.q("UPDATE runs SET started_at = started_at - ? WHERE thread_id = ?").run(ms, threadId);
  }

  // Artifacts. The list never carries the HTML, so the gallery stays cheap however big they are.

  private toArtifact = (row: any): StoredArtifact => ({
    id: row.id,
    title: row.title,
    lang: row.lang === "jsx" || row.lang === "tsx" ? row.lang : "html",
    threadId: row.thread_id ?? null,
    threadTitle: row.thread_title ?? null,
    messageId: row.message_id ?? null,
    sourceKey: row.source_key ?? null,
    projectId: row.project_id ?? null,
    size: row.size,
    hasPrevious: row.has_previous === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  private static ARTIFACT_COLUMNS = `a.id, a.title, a.lang, a.thread_id, a.message_id, a.source_key, a.project_id, a.created_at, a.updated_at,
    length(a.html) AS size, (a.previous_html IS NOT NULL) AS has_previous, t.title AS thread_title`;

  artifacts(): StoredArtifact[] {
    return this.q(`SELECT ${Store.ARTIFACT_COLUMNS} FROM artifacts a LEFT JOIN threads t ON t.id = a.thread_id ORDER BY a.updated_at DESC, a.rowid DESC`)
      .all().map(this.toArtifact);
  }

  artifactSummary(id: string): StoredArtifact | undefined {
    const row = this.q(`SELECT ${Store.ARTIFACT_COLUMNS} FROM artifacts a LEFT JOIN threads t ON t.id = a.thread_id WHERE a.id = ?`).get(id);
    return row ? this.toArtifact(row) : undefined;
  }

  artifactHtml(id: string): { html: string; previousHtml: string | null; lang: ArtifactLang } | undefined {
    const row = this.q("SELECT html, previous_html, lang FROM artifacts WHERE id = ?").get(id) as { html: string; previous_html: string | null; lang: string } | undefined;
    return row ? { html: row.html, previousHtml: row.previous_html, lang: row.lang === "jsx" || row.lang === "tsx" ? row.lang : "html" } : undefined;
  }

  createArtifact(input: { title: string; html: string; lang?: ArtifactLang; threadId: string | null; messageId: string | null; sourceKey: string | null; projectId: string | null }): string {
    const id = randomUUID();
    const now = Date.now();
    this.q("INSERT INTO artifacts (id, title, html, lang, thread_id, message_id, source_key, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, input.title, input.html, input.lang ?? "html", input.threadId, input.messageId, input.sourceKey, input.projectId, now, now);
    return id;
  }

  // New HTML pushes the current one into previous_html: one earlier version is enough for now.
  updateArtifact(id: string, patch: { title?: string; html?: string }): void {
    this.transaction(() => {
      if (patch.title !== undefined) this.q("UPDATE artifacts SET title = ? WHERE id = ?").run(patch.title, id);
      if (patch.html !== undefined) this.q("UPDATE artifacts SET previous_html = html, html = ? WHERE id = ? AND html IS NOT ?").run(patch.html, id, patch.html);
      this.q("UPDATE artifacts SET updated_at = ? WHERE id = ?").run(Date.now(), id);
    });
  }

  restoreArtifact(id: string): void {
    this.q("UPDATE artifacts SET html = previous_html, previous_html = html, updated_at = ? WHERE id = ? AND previous_html IS NOT NULL").run(Date.now(), id);
  }

  deleteArtifact(id: string): void {
    this.q("DELETE FROM artifacts WHERE id = ?").run(id);
  }

  // "Allow always" rules

  isAllowed(projectId: string, kind: "command" | "prefix" | "tool", value: string): boolean {
    return this.q("SELECT 1 FROM allow_rules WHERE project_id = ? AND kind = ? AND value = ?").get(projectId, kind, value) !== undefined;
  }

  allow(projectId: string, kind: "command" | "prefix" | "tool", value: string): void {
    this.q("INSERT OR IGNORE INTO allow_rules (project_id, kind, value) VALUES (?, ?, ?)").run(projectId, kind, value);
  }

  // Innstillinger → Tillatelser: every saved "allow always", and taking them back.
  allowRules(): Array<{ projectId: string; kind: "command" | "prefix" | "tool"; value: string }> {
    return (this.q("SELECT project_id, kind, value FROM allow_rules ORDER BY project_id, kind, value").all() as Array<{ project_id: string; kind: string; value: string }>)
      .filter((row) => row.kind === "command" || row.kind === "prefix" || row.kind === "tool")
      .map((row) => ({ projectId: row.project_id, kind: row.kind as "command" | "prefix" | "tool", value: row.value }));
  }

  removeAllowRule(projectId: string, kind: string, value: string): boolean {
    return Number(this.q("DELETE FROM allow_rules WHERE project_id = ? AND kind = ? AND value = ?").run(projectId, kind, value).changes) > 0;
  }

  clearAllowRules(projectId?: string): number {
    return Number((projectId === undefined ? this.q("DELETE FROM allow_rules").run() : this.q("DELETE FROM allow_rules WHERE project_id = ?").run(projectId)).changes);
  }

  // Every project's "allow always" tool rules that start with prefix: an MCP server that is
  // removed or renamed takes its rules with it, so another server never inherits them.
  removeToolRulesWithPrefix(prefix: string): number {
    return Number(this.q("DELETE FROM allow_rules WHERE kind = 'tool' AND substr(value, 1, ?) = ?").run(prefix.length, prefix).changes);
  }

  // Lagring (Innstillinger). What the storage page needs from the database.

  // The HTML of all artifacts, current and previous version, in bytes.
  artifactBytes(): number {
    const row = this.q("SELECT COALESCE(SUM(length(CAST(html AS BLOB)) + COALESCE(length(CAST(previous_html AS BLOB)), 0)), 0) AS n FROM artifacts").get() as { n: number };
    return row.n;
  }

  // Every id (UUID) the log, the model's history, the queue or an artifact mentions. An image,
  // upload or screenshot is in use while one of them names it. Read row by row, never all at once.
  referencedIds(): Set<string> {
    const ids = new Set<string>();
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
    const scan = (sql: string) => {
      for (const row of this.db.prepare(sql).iterate() as Iterable<{ t: string | null }>) {
        if (row.t) for (const match of row.t.matchAll(uuid)) ids.add(match[0]);
      }
    };
    scan("SELECT event AS t FROM events");
    scan("SELECT content AS t FROM messages");
    scan("SELECT payload AS t FROM queue");
    scan("SELECT payload AS t FROM queue_drafts");
    scan("SELECT html AS t FROM artifacts");
    return ids;
  }

  // Archived threads last changed before the cutoff, with roughly how much of the database they use.
  archivedBefore(cutoff: number): Array<{ id: string; bytes: number }> {
    return this.q(
      `SELECT t.id AS id,
         COALESCE((SELECT SUM(length(CAST(event AS BLOB))) FROM events e WHERE e.thread_id = t.id), 0)
         + COALESCE((SELECT SUM(length(CAST(content AS BLOB))) FROM messages m WHERE m.thread_id = t.id), 0)
         + COALESCE((SELECT SUM(COALESCE(length(f.before), 0) + COALESCE(length(f.after), 0)) FROM turn_files f JOIN turns u ON u.id = f.turn_id WHERE u.thread_id = t.id), 0) AS bytes
       FROM threads t WHERE t.archived = 1 AND t.updated_at < ?`,
    ).all(cutoff) as Array<{ id: string; bytes: number }>;
  }

  // Free pages inside the file, which VACUUM gives back to the disk.
  freeBytes(): number {
    const pages = (this.db.prepare("PRAGMA freelist_count").get() as { freelist_count: number }).freelist_count;
    const size = (this.db.prepare("PRAGMA page_size").get() as { page_size: number }).page_size;
    return pages * size;
  }

  // Rewrites the file without free pages, and empties the write-ahead log.
  vacuum(): void {
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.db.exec("VACUUM");
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }
}
