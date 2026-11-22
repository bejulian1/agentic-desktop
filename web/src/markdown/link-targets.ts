// What a link in an agent's answer points at, when it is not a web address: a file in the project
// (v1.4.0) or another thread. Pure parsing without imports, so the tests can load it without a
// browser. The answer is untrusted, so anything unclear is refused and stays plain text.

export interface FileTarget {
  path: string; // as written, without file://, the line suffix or the fragment
  line?: number;
  ext: string; // lower case, "" for a known file without one (Makefile)
  absolute: boolean;
}

// Any scheme at the start (javascript:, data:, vbscript:, http:, C: …) except file:.
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// Letters, digits and the punctuation file names use. No control characters, no quotes, no
// backslashes, no < >, no ? (a query is a web address, not a file).
const PATH_CHARS = /^[\p{L}\p{N}_@.+\-/ ,()[\]~=]+$/u;
const BARE_NAMES = new Set(["makefile", "dockerfile", "license", "readme", "gemfile", "procfile", "rakefile", "justfile", "containerfile", "changelog", "codeowners"]);
const LINE_SUFFIX = /:(\d{1,7})(?::\d{1,5})?$/;
const LINE_FRAGMENT = /^L(\d{1,7})(?:C\d{1,5})?(?:-L?\d{1,7}(?:C\d{1,5})?)?$/i;

function decode(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

// A Markdown link target that names a file: README.md, ./src/app.tsx:42, docs/a.md#L10-L20,
// /abs/path/notes.md, file:///abs/path/http.ts:42. Never one that climbs out with .., never a
// scheme other than file:, and never a bare name that could be a word or a folder.
export function fileTarget(href: string): FileTarget | null {
  let raw = href.trim();
  if (!raw || raw.length > 1024 || /[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  let fromFileUrl = false;
  if (/^file:/i.test(raw)) {
    const rest = /^file:\/\/(?:localhost)?(\/.*)$/i.exec(raw);
    if (!rest) return null;
    raw = rest[1];
    fromFileUrl = true;
  } else if (SCHEME.test(raw) || raw.startsWith("//") || raw.startsWith("#") || raw.startsWith("?")) return null;

  let line: number | undefined;
  const hash = raw.indexOf("#");
  if (hash >= 0) {
    const fragment = raw.slice(hash + 1);
    raw = raw.slice(0, hash);
    const at = LINE_FRAGMENT.exec(fragment);
    if (at) line = Number(at[1]);
    else if (!/^[\w.-]{0,80}$/.test(fragment)) return null; // a heading anchor is fine, anything else is not
  }
  if (raw.includes("?")) return null;
  const decoded = decode(raw);
  if (decoded === null || /[\u0000-\u001f\u007f\\]/.test(decoded)) return null;
  let path = decoded;
  const suffix = LINE_SUFFIX.exec(path);
  if (suffix) {
    line ??= Number(suffix[1]);
    path = path.slice(0, suffix.index);
  }
  if (!path || path.length > 512 || !PATH_CHARS.test(path) || path.endsWith("/")) return null;
  const absolute = path.startsWith("/");
  if (fromFileUrl && !absolute) return null;
  if (path.startsWith("~")) return null;
  const segments = path.split("/");
  // No .., anywhere: a relative link must stay inside the folder it is read from.
  if (segments.some((segment) => segment === "..")) return null;
  if (segments.slice(absolute ? 1 : 0).some((segment, i, all) => segment === "" && i < all.length - 1)) return null;
  const name = segments.at(-1)!;
  if (!name || name === ".") return null;
  const dot = name.lastIndexOf(".");
  let ext = "";
  if (dot > 0 && dot < name.length - 1) {
    ext = name.slice(dot + 1).toLowerCase();
    if (!/^[a-z0-9]{1,8}$/.test(ext) || /^\d+$/.test(ext)) return null;
  } else if (dot === 0 && name.length > 1) {
    ext = name.slice(1).toLowerCase(); // .gitignore, .env
    if (!/^[a-z0-9_-]{1,20}$/.test(ext)) return null;
  } else if (!BARE_NAMES.has(name.toLowerCase())) return null;
  if (line !== undefined && (!Number.isSafeInteger(line) || line < 1)) line = undefined;
  return { path: path.replace(/^(\.\/)+/, ""), line, ext, absolute };
}

// The path and line in a `code` file name, as the file chips show it: src/app.ts:42 or README.md.
export function codeFileTarget(text: string): { path: string; line?: number } {
  const suffix = LINE_SUFFIX.exec(text);
  const path = (suffix ? text.slice(0, suffix.index) : text).replace(/^(\.\/)+/, "");
  return suffix ? { path, line: Number(suffix[1]) } : { path };
}

// The small label on a file's badge: TS, TSX, MD, JSON, DOC …
const BADGES: Record<string, string> = {
  mjs: "JS", cjs: "JS", mts: "TS", cts: "TS", yml: "YAML", htm: "HTML", markdown: "MD", mdx: "MDX",
  bash: "SH", zsh: "SH", fish: "SH", docx: "DOC", odt: "DOC", rtf: "DOC", xlsx: "XLS", ods: "XLS",
  pptx: "PPT", odp: "PPT", jpeg: "JPG", jsonc: "JSON", json5: "JSON", dockerfile: "DOCK", makefile: "MAKE",
};

export function fileBadge(ext: string, name = ""): string {
  if (!ext) return (BADGES[name.toLowerCase()] ?? name.slice(0, 4)).toUpperCase();
  if (name.startsWith(".") && name.slice(1).toLowerCase() === ext) return "CFG";
  return (BADGES[ext] ?? ext.slice(0, 4)).toUpperCase();
}

// The last part of a path, for a link whose text is the whole path.
export function baseName(path: string): string {
  return path.slice(path.replace(/\/+$/, "").lastIndexOf("/") + 1);
}

// A link to another thread: thread:<id>, agentic-thread://<id> or #thread:<id>.
const THREAD_LINK = /^(?:thread:|agentic-thread:\/\/|#thread:)([\w-]{1,80})\/?$/i;
export function threadTarget(href: string): string | null {
  return THREAD_LINK.exec(href.trim())?.[1] ?? null;
}

// The path to open in a project: a path inside the project folder loses the folder in front, a
// relative path stays as it is, and an absolute path elsewhere is not in the project (null).
export function projectRelative(path: string, projectRoot: string | null | undefined): string | null {
  if (!path.startsWith("/")) return path.replace(/^(\.\/)+/, "");
  if (!projectRoot) return null;
  const root = projectRoot.replace(/\/+$/, "");
  if (!root || !path.startsWith(`${root}/`)) return null;
  return path.slice(root.length + 1) || null;
}

// $skill-name in prose: a skill the answer mentions. Lower case, starting with a letter, at least
// three characters, with an optional plugin: prefix. Money ($5) and shell variables in capitals
// ($HOME) are not skills.
export const SKILL_MENTION = /(^|[\s(“"'«])\$([a-z][a-z0-9]*(?:[-_][a-z0-9]+)*(?::[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*)?)(?=$|[\s.,;:!?)”"'»])/g;
