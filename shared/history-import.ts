export const historySources = {
  claude: "Claude Code",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
  pi: "Pi",
} as const;

export type HistorySource = keyof typeof historySources;

export interface ImportedOrigin {
  source: HistorySource;
  importedAt: number;
}

export interface ImportedToolNote {
  kind: "call" | "result";
  tool: string;
  summary?: string;
}

export interface ImportThreadPreview {
  id: string; // Opaque selection ID, scoped to the scan.
  source: HistorySource;
  title: string;
  updatedAt: number;
  imported: boolean;
}

export interface ImportProjectPreview {
  path: string;
  updatedAt: number;
  threads: ImportThreadPreview[];
}

export interface HistoryScan {
  id: string;
  projects: ImportProjectPreview[];
  files: number;
  invalidLines: number;
  missingFolders: number;
  skippedFiles: number;
  limited: boolean;
}

export interface HistoryImportResult {
  projectsCreated: number;
  projectsReused: number;
  threadsImported: number;
  threadsSkipped: number;
  problems: number;
}
