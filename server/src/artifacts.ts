// Artifacts: single-file programs, saved from a chat block or made by hand. They are global, not
// per project, and keep one earlier version. Since round 15 (SPEC 31) an artifact can be a React
// component in JSX or TSX as well as HTML; the column is still called html and holds the source.
// The source is only ever served by the preview server or as a download; the app's own origin
// never renders it.
import { ARTIFACT_LANGS, MAX_ARTIFACT_HTML, type Artifact, type ArtifactLang, type ArtifactSummary, type ServerMessage } from "../../shared/protocol.ts";
import type { Store, StoredArtifact } from "./db.ts";
import { HttpError } from "./errors.ts";
import type { PreviewServer } from "./preview.ts";

const MAX_TITLE = 120;
const MAX_KEY = 200;

export const BLANK_ARTIFACT = `<!doctype html>
<html lang="no">
<head>
  <meta charset="utf-8">
  <title>Ny artifact</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; }
  </style>
</head>
<body>
  <h1>Ny artifact</h1>
  <p>Skriv HTML, CSS og JavaScript her, og trykk Lagre.</p>
  <script>
    document.querySelector("h1").addEventListener("click", () => alert("Hei!"));
  </script>
</body>
</html>
`;

// <title>, else the first heading, else a plain name.
export function titleFromHtml(html: string): string {
  const pick = (re: RegExp) => re.exec(html)?.[1]?.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  return (pick(/<title[^>]*>([\s\S]*?)<\/title>/i) || pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || "Uten tittel").slice(0, MAX_TITLE);
}

function cleanTitle(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, "Tittelen er tom");
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
}

function cleanHtml(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "html mangler");
  if (value.length > MAX_ARTIFACT_HTML) throw new HttpError(413, "Artifacten er for stor (maks 2 MB)");
  return value;
}

function optionalKey(value: unknown, name: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > MAX_KEY) throw new HttpError(400, `Ugyldig ${name}`);
  return value;
}

function cleanLang(value: unknown): ArtifactLang {
  if (value === undefined || value === null) return "html";
  if (typeof value !== "string" || !ARTIFACT_LANGS.includes(value as ArtifactLang)) throw new HttpError(400, "Ugyldig type, bare html, jsx og tsx");
  return value as ArtifactLang;
}

// The name of a React artifact: the component the file exports by default, else the one called
// App, spaced out a little («TodoListe» stays, «App» becomes «React-app»).
export function titleFromReact(source: string): string {
  const named = /\bexport\s+default\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/.exec(source)?.[1]
    ?? /\bexport\s+default\s+([A-Z][\w$]*)\s*;?\s*$/m.exec(source)?.[1];
  if (!named || named === "App") return "React-app";
  return named.slice(0, MAX_TITLE);
}

// A file name that is safe in Content-Disposition and on any disk.
export function downloadName(title: string, lang: ArtifactLang = "html"): string {
  const ascii = title.normalize("NFKD").replace(/[^\w .-]+/g, "").replace(/\s+/g, "-").replace(/^[.-]+/, "").replace(/\.(html?|jsx|tsx)$/i, "").slice(0, 60);
  return `${ascii || "artifact"}.${lang}`;
}

export class Artifacts {
  private store: Store;
  private preview: PreviewServer;
  private publish: (message: ServerMessage) => void;

  constructor(store: Store, preview: PreviewServer, publish: (message: ServerMessage) => void) {
    this.store = store;
    this.preview = preview;
    this.publish = publish;
  }

  private summary(row: StoredArtifact): ArtifactSummary {
    return { ...row, previewUrl: this.preview.artifactUrl(row.id) };
  }

  list(): ArtifactSummary[] {
    return this.store.artifacts().map((row) => this.summary(row));
  }

  get(id: string): Artifact {
    const row = this.store.artifactSummary(id);
    const content = this.store.artifactHtml(id);
    if (!row || !content) throw new HttpError(404, "Fant ikke artifacten");
    return { ...this.summary(row), ...content };
  }

  private changed(id: string): Artifact {
    const artifact = this.get(id);
    const { html: _html, previousHtml: _previous, ...summary } = artifact;
    this.publish({ type: "artifact.changed", artifact: summary });
    return artifact;
  }

  create(body: { html?: unknown; lang?: unknown; title?: unknown; threadId?: unknown; messageId?: unknown; sourceKey?: unknown }): Artifact {
    const lang = cleanLang(body.lang);
    if (lang !== "html" && body.html === undefined) throw new HttpError(400, "html mangler");
    const html = cleanHtml(body.html ?? BLANK_ARTIFACT);
    const threadId = optionalKey(body.threadId, "threadId");
    const thread = threadId ? this.store.thread(threadId) : undefined;
    if (threadId && !thread) throw new HttpError(404, "Fant ikke tråden");
    const id = this.store.createArtifact({
      title: body.title === undefined ? (lang === "html" ? titleFromHtml(html) : titleFromReact(html)) : cleanTitle(body.title),
      html,
      lang,
      threadId,
      messageId: optionalKey(body.messageId, "messageId"),
      sourceKey: optionalKey(body.sourceKey, "sourceKey"),
      projectId: thread?.projectId ?? null,
    });
    return this.changed(id);
  }

  update(id: string, body: { title?: unknown; html?: unknown }): Artifact {
    this.get(id);
    this.store.updateArtifact(id, {
      title: body.title === undefined ? undefined : cleanTitle(body.title),
      html: body.html === undefined ? undefined : cleanHtml(body.html),
    });
    return this.changed(id);
  }

  // A copy belongs to the same thread and project, but not to the chat block: the box there
  // keeps pointing at the original.
  duplicate(id: string): Artifact {
    const source = this.get(id);
    const copy = this.store.createArtifact({
      title: `Kopi av ${source.title}`.slice(0, MAX_TITLE),
      html: source.html,
      lang: source.lang,
      threadId: source.threadId,
      messageId: null,
      sourceKey: null,
      projectId: source.projectId,
    });
    return this.changed(copy);
  }

  restore(id: string): Artifact {
    if (!this.get(id).hasPrevious) throw new HttpError(409, "Det finnes ingen tidligere versjon");
    this.store.restoreArtifact(id);
    return this.changed(id);
  }

  remove(id: string): void {
    this.get(id);
    this.store.deleteArtifact(id);
    this.publish({ type: "artifact.deleted", artifactId: id });
  }
}
