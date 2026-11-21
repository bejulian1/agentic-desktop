// Round 15 (SPEC 31.1): which code blocks in an answer are whole one-file apps, what they are
// called, and which of them in a thread are versions of the same app. Pure functions, plus a scan
// of a thread's answers that the box and the panel share.
import type { Token, Tokens } from "marked";
import type { ArtifactLang } from "../../../shared/protocol";
import { t } from "../lib/i18n";
import { sourceKeyFor } from "../state/artifacts";
import { peekModel, type TextRow } from "../state/thread-model";
import { lex } from "./render";

export interface ArtifactDoc {
  lang: ArtifactLang;
  code: string;
  title: string;
  usesDefaultTitle: boolean;
  file: string | null; // the file name the model put after the language, if any
  key: string; // the same for every version of one app in a thread
  sourceKey: string; // this block's text, as saved artifacts know it
  messageId: string | null;
}

// The language a fence names, as an artifact's kind, or null for every other language.
export function artifactLangOf(lang: string): ArtifactLang | null {
  const name = lang.toLowerCase();
  if (name === "html" || name === "htm" || name === "xhtml") return "html";
  if (name === "jsx") return "jsx";
  if (name === "tsx") return "tsx";
  return null;
}

// A full program, not a snippet: what decides whether a block becomes a box. HTML needs a document
// or a script; React needs a component exported by default, or a file that renders itself.
export function isArtifactBlock(lang: string, text: string): boolean {
  const kind = artifactLangOf(lang);
  if (kind === "html") return /<!doctype|<html[\s>]|<body[\s>]|<script[\s>]/i.test(text);
  if (kind === "jsx" || kind === "tsx") return /\bexport\s+default\b/.test(text) || /\bcreateRoot\s*\(/.test(text);
  return false;
}

// While a block streams: does it look like an app yet? Then the box shows it being written,
// instead of the code running down the conversation.
export function looksLikeApp(lang: string, text: string): boolean {
  const kind = artifactLangOf(lang);
  if (kind === "html") return /<!doctype|<html[\s>]/i.test(text.slice(0, 400)) || /<body[\s>]|<script[\s>]/i.test(text);
  if (kind === "jsx" || kind === "tsx") return /\bfrom\s+["']react(?:-dom(?:\/client)?)?["']/.test(text) || /\bexport\s+default\b/.test(text);
  return false;
}

// A file name after the language: ```jsx teller.jsx, ```html title="Spill" or ```tsx file=app.tsx.
export function fileFromInfo(info: string): string | null {
  const rest = info.trim().split(/\s+/).slice(1).join(" ");
  if (!rest) return null;
  const quoted = /(?:file(?:name)?|title|name)\s*=\s*["']?([^"'\s][^"']*?)["']?(?:\s|$)/i.exec(rest)?.[1];
  const bare = /^([\w.-]+\.(?:html?|jsx|tsx))$/i.exec(rest)?.[1];
  const name = (quoted ?? bare ?? "").trim().slice(0, 80);
  return name || null;
}

// The name the box shows: HTML's <title>, a React component's name, or the file name.
function namedTitle(lang: ArtifactLang, text: string, file: string | null): string | null {
  const bare = file?.replace(/\.(html?|jsx|tsx)$/i, "") || null;
  if (lang === "html") {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1]?.replace(/\s+/g, " ").trim();
    return (title || bare)?.slice(0, 80) ?? null;
  }
  const named = /\bexport\s+default\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/.exec(text)?.[1]
    ?? /\bexport\s+default\s+([A-Z][\w$]*)\s*;?\s*$/m.exec(text)?.[1];
  if (named && named !== "App") return named.slice(0, 80);
  return bare?.slice(0, 80) ?? null;
}

export const defaultArtifactTitle = (lang: ArtifactLang) => lang === "html" ? t("HTML-app") : t("React-app");
export const artifactDisplayTitle = (doc: ArtifactDoc) => doc.usesDefaultTitle ? defaultArtifactTitle(doc.lang) : doc.title;

export function artifactDoc(lang: string, info: string, text: string, messageId: string | null): ArtifactDoc | null {
  const kind = artifactLangOf(lang);
  if (!kind || !isArtifactBlock(lang, text)) return null;
  const file = fileFromInfo(info);
  const named = namedTitle(kind, text, file);
  const title = named ?? (kind === "html" ? "HTML-app" : "React-app");
  // Versions of one app share a key: its file name when the model gave one, else its name. HTML
  // and React never share one.
  const family = kind === "html" ? "html" : "react";
  const key = `${family}:${(file?.replace(/\.(html?|jsx|tsx)$/i, "") ?? title).toLowerCase()}`;
  return { lang: kind, code: text, title, usesDefaultTitle: named === null, file, key, sourceKey: sourceKeyFor(text), messageId };
}

export const lineCount = (text: string) => text.replace(/\n$/, "").split("\n").length;

// ---------------------------------------------------------------------------------------------
// Versions in a thread

const FENCE_HINT = /(?:^|\n) {0,12}(?:```|~~~)\s*(?:html?|xhtml|jsx|tsx)\b/i;
const scanned = new WeakMap<TextRow, { length: number; docs: ArtifactDoc[] }>();

function walk(tokens: Token[], messageId: string, out: ArtifactDoc[]): void {
  for (const token of tokens) {
    if (token.type === "code") {
      const info = ((token as Tokens.Code).lang ?? "").trim();
      const doc = artifactDoc(info.split(/\s+/)[0] ?? "", info, (token as Tokens.Code).text, messageId);
      if (doc) out.push(doc);
    } else if (token.type === "list") {
      for (const item of (token as Tokens.List).items) walk(item.tokens, messageId, out);
    } else if (token.type === "blockquote") {
      walk((token as Tokens.Blockquote).tokens, messageId, out);
    }
  }
}

// The apps in one answer, with the same parser that renders it. Kept per row until its text grows.
function docsIn(row: TextRow): ArtifactDoc[] {
  const cached = scanned.get(row);
  if (cached && cached.length === row.text.length) return cached.docs;
  const docs: ArtifactDoc[] = [];
  if (FENCE_HINT.test(row.text)) walk(lex(row.text), row.key, docs);
  scanned.set(row, { length: row.text.length, docs });
  return docs;
}

// Every app in the thread with this key, oldest first: the versions the panel can go through.
// Only what is loaded counts; a thread whose start is not loaded begins with what is.
export function versionsIn(threadId: string | null, key: string): ArtifactDoc[] {
  const model = threadId ? peekModel(threadId) : undefined;
  if (!model) return [];
  const out: ArtifactDoc[] = [];
  for (const chunk of model.chunks()) {
    for (const row of chunk.rows()) {
      if (row.kind !== "text") continue;
      for (const doc of docsIn(row)) if (doc.key === key) out.push(doc);
    }
  }
  return out;
}
