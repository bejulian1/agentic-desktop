// A simple outline of a file for the mini editor (round 8, agent G): functions, classes, methods,
// types and Markdown headings, found line by line with patterns and nested by indentation. Not a
// parser, so it is fast on big files and works for any language that looks like the usual ones.

export type SymbolKind = "function" | "class" | "method" | "interface" | "type" | "const" | "heading" | "rule";

export interface OutlineItem {
  name: string;
  kind: SymbolKind;
  line: number; // 1-based
  depth: number;
}

const MAX_LINES = 50_000;
const MAX_ITEMS = 2_000;

const NOT_METHODS = new Set(["if", "for", "while", "switch", "catch", "return", "function", "else", "do", "try", "with", "new", "typeof", "await", "yield", "super", "constructor"]);

type Rule = [RegExp, SymbolKind];

const CODE: Rule[] = [
  [/^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([\p{L}_$][\p{L}\p{N}_$]*)/u, "class"],
  [/^\s*(?:export\s+)?(?:declare\s+)?interface\s+([\p{L}_$][\p{L}\p{N}_$]*)/u, "interface"],
  [/^\s*(?:export\s+)?(?:declare\s+)?(?:type|enum)\s+([\p{L}_$][\p{L}\p{N}_$]*)\s*(?:<[^=]*>)?\s*(?:=|\{)/u, "type"],
  [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\p{L}_$][\p{L}\p{N}_$]*)/u, "function"],
  [/^\s*(?:export\s+)?(?:const|let|var)\s+([\p{L}_$][\p{L}\p{N}_$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[\p{L}_$][\p{L}\p{N}_$]*\s*=>)/u, "function"],
  [/^\s*(?:export\s+)?(?:const|let)\s+([\p{Lu}][\p{Lu}\p{N}_]{2,})\s*(?::[^=]+)?=/u, "const"],
  // Python
  [/^\s*(?:async\s+)?def\s+([\p{L}_][\p{L}\p{N}_]*)\s*\(/u, "function"],
  [/^\s*class\s+([\p{L}_][\p{L}\p{N}_]*)\s*[:(]/u, "class"],
  // Rust and Go
  [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?fn\s+([\p{L}_][\p{L}\p{N}_]*)/u, "function"],
  [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|union)\s+([\p{L}_][\p{L}\p{N}_]*)/u, "class"],
  [/^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([\p{L}_][\p{L}\p{N}_]*)/u, "interface"],
  [/^\s*impl(?:<[^>]*>)?\s+(?:[\w:<>, ]+\s+for\s+)?([\p{L}_][\p{L}\p{N}_:]*)/u, "class"],
  [/^func\s+(?:\([^)]*\)\s*)?([\p{L}_][\p{L}\p{N}_]*)\s*\(/u, "function"],
  // Shell
  [/^\s*(?:function\s+)?([\p{L}_][\p{L}\p{N}_-]*)\s*\(\)\s*\{/u, "function"],
];

// A method in a class body: a name, its parameters and an opening brace on the same line.
const METHOD = /^\s+(?:(?:public|private|protected|static|readonly|override|async|get|set|\*)\s+)*(#?[\p{L}_$][\p{L}\p{N}_$]*)\s*(?:<[^>]*>)?\s*\([^;]*\)\s*(?::\s*[^={;]+)?\{\s*(?:\/\/.*)?$/u;

function indentOf(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4;
    else break;
  }
  return width;
}

export function outline(text: string, lang = ""): OutlineItem[] {
  const lines = text.split("\n", MAX_LINES);
  const items: OutlineItem[] = [];
  const markdown = /^(md|markdown|mdx)$/i.test(lang);
  const css = /^(css|scss|less)$/i.test(lang);
  // Open containers as [indent, depth], so a symbol nests under the last one with less indent.
  const stack: number[] = [];
  let inFence = false;
  let inBlockComment = false;

  for (let i = 0; i < lines.length && items.length < MAX_ITEMS; i++) {
    const line = lines[i].replace(/\r$/, "");
    if (markdown) {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      const heading = inFence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (heading) items.push({ name: heading[2], kind: "heading", line: i + 1, depth: heading[1].length - 1 });
      continue;
    }
    if (css) {
      const rule = /^([^\s{}@/][^{}]*?|@media[^{]*|@keyframes[^{]*|@layer[^{]*|@supports[^{]*)\s*\{\s*$/.exec(line);
      if (rule && indentOf(line) === 0) items.push({ name: rule[1].trim().slice(0, 80), kind: "rule", line: i + 1, depth: 0 });
      continue;
    }
    const trimmed = line.trimStart();
    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
      inBlockComment = true;
      continue;
    }
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#") && !/^#\[/.test(trimmed) || trimmed.startsWith("*")) continue;

    const indent = indentOf(line);
    while (stack.length && stack[stack.length - 1] >= indent) stack.pop();

    let found: [string, SymbolKind] | null = null;
    for (const [pattern, kind] of CODE) {
      const match = pattern.exec(line);
      if (match) {
        found = [match[1], kind];
        break;
      }
    }
    if (!found && stack.length) {
      const method = METHOD.exec(line);
      if (method && !NOT_METHODS.has(method[1])) found = [method[1], "method"];
      else if (/^\s+constructor\s*\(/.test(line)) found = ["constructor", "method"];
    }
    if (!found) continue;
    const [name, kind] = found;
    const nested = kind === "function" && stack.length ? "method" : kind;
    items.push({ name, kind: nested, line: i + 1, depth: stack.length });
    if (kind === "class" || kind === "interface" || (kind === "function" && /[{:]\s*(?:\/\/.*)?$/.test(line))) stack.push(indent);
  }
  return items;
}

// The symbol the cursor is in: the last one that starts on or before the line.
export function symbolAt(items: OutlineItem[], line: number): OutlineItem | undefined {
  let found: OutlineItem | undefined;
  for (const item of items) {
    if (item.line > line) break;
    found = item;
  }
  return found;
}
