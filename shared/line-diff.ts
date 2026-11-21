// A line diff: common start and end are trimmed, and what is left goes through a plain LCS table.
// Files too large for the table show as replaced, instead of freezing the panel.
export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
  oldLine?: number;
  newLine?: number;
  noNewline?: boolean;
}

export interface LineDiffOptions {
  ignoreWhitespace?: boolean;
}

export interface InlineSpan {
  text: string;
  changed: boolean;
}

export type SplitDiffRow =
  | { kind: "skip"; count: number }
  | {
      kind: "pair";
      left?: DiffLine;
      right?: DiffLine;
      leftSpans?: InlineSpan[];
      rightSpans?: InlineSpan[];
    };

const MAX_TABLE = 4_000_000;
const MAX_INLINE_TOKENS = 400;

const stripWhitespace = (line: string): string => line.replace(/\s+/g, "");

export function lineDiff(before: string | null, after: string | null, options: LineDiffOptions = {}): { lines: DiffLine[]; countsExact: boolean } {
  const ignoreWs = options.ignoreWhitespace === true;
  const a = before ? before.split("\n") : [];
  const b = after ? after.split("\n") : [];
  if (before?.endsWith("\n")) a.pop();
  if (after?.endsWith("\n")) b.pop();
  // A missing final terminator is a real line change, not an extra empty line.
  const terminatedA = (i: number) => i < a.length - 1 || before?.endsWith("\n") === true;
  const terminatedB = (j: number) => j < b.length - 1 || after?.endsWith("\n") === true;
  const keyA = ignoreWs ? a.map(stripWhitespace) : a;
  const keyB = ignoreWs ? b.map(stripWhitespace) : b;
  const same = (i: number, j: number) => keyA[i] === keyB[j] && (ignoreWs || terminatedA(i) === terminatedB(j));
  let start = 0;
  while (start < a.length && start < b.length && same(start, start)) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && same(endA - 1, endB - 1)) {
    endA--;
    endB--;
  }
  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ kind: "same", text: ignoreWs ? b[i] : a[i], oldLine: i + 1, newLine: i + 1 });

  const n = endA - start;
  const m = endB - start;
  const countsExact = n * m <= MAX_TABLE;
  if (!n || !m || !countsExact) {
    for (let i = start; i < endA; i++) out.push({ kind: "del", text: a[i], oldLine: i + 1 });
    for (let j = start; j < endB; j++) out.push({ kind: "add", text: b[j], newLine: j + 1 });
  } else {
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] = same(start + i, start + j)
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && same(start + i, start + j)) {
        out.push({ kind: "same", text: ignoreWs ? b[start + j] : a[start + i], oldLine: start + i + 1, newLine: start + j + 1 });
        i++;
        j++;
      } else if (i < n && (j === m || table[(i + 1) * width + j] >= table[i * width + j + 1])) {
        out.push({ kind: "del", text: a[start + i], oldLine: start + i + 1 }); // Removed lines first.
        i++;
      } else {
        out.push({ kind: "add", text: b[start + j], newLine: start + j + 1 });
        j++;
      }
    }
  }
  for (let i = endA, j = endB; i < a.length; i++, j++) out.push({ kind: "same", text: ignoreWs ? b[j] : a[i], oldLine: i + 1, newLine: j + 1 });
  for (const line of out) {
    if (line.kind !== "add" && line.oldLine && !terminatedA(line.oldLine - 1)) line.noNewline = true;
    if (line.kind === "add" && line.newLine && !terminatedB(line.newLine - 1)) line.noNewline = true;
  }
  return { lines: out, countsExact };
}

export function diffLines(before: string | null, after: string | null, options: LineDiffOptions = {}): DiffLine[] {
  return lineDiff(before, after, options).lines;
}

export function lineChangeCounts(before: string | null, after: string | null, options: LineDiffOptions = {}) {
  const { lines, countsExact } = lineDiff(before, after, options);
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.kind === "add") additions++;
    else if (line.kind === "del") deletions++;
  }
  return { additions, deletions, countsExact };
}

// Hunks: changed lines with some context, the rest collapsed.
export function hunks(lines: DiffLine[], context = 3): Array<DiffLine | { kind: "skip"; count: number }> {
  const keep = new Uint8Array(lines.length);
  lines.forEach((line, i) => {
    if (line.kind === "same") return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = 1;
  });
  const out: Array<DiffLine | { kind: "skip"; count: number }> = [];
  let skipped = 0;
  lines.forEach((line, i) => {
    if (keep[i]) {
      if (skipped) out.push({ kind: "skip", count: skipped });
      skipped = 0;
      out.push(line);
    } else skipped++;
  });
  if (skipped) out.push({ kind: "skip", count: skipped });
  return out;
}

function pushSpan(list: InlineSpan[], text: string, changed: boolean): void {
  if (!text) return;
  const last = list[list.length - 1];
  if (last && last.changed === changed) last.text += text;
  else list.push({ text, changed });
}

// Token-level inline diff for paired removed/added lines so changed words stand out clearly.
export function inlineDiff(before: string, after: string, options: LineDiffOptions = {}): { del: InlineSpan[]; add: InlineSpan[] } {
  if (before === after) return { del: [{ text: before, changed: false }], add: [{ text: after, changed: false }] };
  const tokenize = (s: string) => s.match(/\s+|\w+|[^\s\w]/gu) ?? [];
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length > MAX_INLINE_TOKENS || b.length > MAX_INLINE_TOKENS) {
    return { del: [{ text: before, changed: true }], add: [{ text: after, changed: true }] };
  }
  const ignoreWs = options.ignoreWhitespace === true;
  const isWs = (tok: string) => /^\s+$/.test(tok);
  const eq = (x: string, y: string) => (ignoreWs && isWs(x) && isWs(y)) || x === y;

  let start = 0;
  while (start < a.length && start < b.length && eq(a[start], b[start])) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && eq(a[endA - 1], b[endB - 1])) {
    endA--;
    endB--;
  }

  const del: InlineSpan[] = [];
  const add: InlineSpan[] = [];
  for (let i = 0; i < start; i++) {
    pushSpan(del, a[i], false);
    pushSpan(add, b[i], false);
  }
  const n = endA - start;
  const m = endB - start;
  const width = m + 1;
  const table = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = eq(a[start + i], b[start + j])
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && eq(a[start + i], b[start + j])) {
      pushSpan(del, a[start + i], false);
      pushSpan(add, b[start + j], false);
      i++;
      j++;
    } else if (i < n && (j === m || table[(i + 1) * width + j] >= table[i * width + j + 1])) {
      pushSpan(del, a[start + i], !(ignoreWs && isWs(a[start + i])));
      i++;
    } else {
      pushSpan(add, b[start + j], !(ignoreWs && isWs(b[start + j])));
      j++;
    }
  }
  for (let k = endA, l = endB; k < a.length; k++, l++) {
    pushSpan(del, a[k], false);
    pushSpan(add, b[l], false);
  }
  return { del, add };
}

// Pairs consecutive removed and added lines into side-by-side rows with inline word highlights.
export function splitDiffRows(items: Array<DiffLine | { kind: "skip"; count: number }>, options: LineDiffOptions = {}): SplitDiffRow[] {
  const out: SplitDiffRow[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    if (item.kind === "skip") {
      out.push(item);
      i++;
      continue;
    }
    if (item.kind === "same") {
      out.push({ kind: "pair", left: item, right: item });
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < items.length && items[i].kind === "del") dels.push(items[i++] as DiffLine);
    while (i < items.length && items[i].kind === "add") adds.push(items[i++] as DiffLine);
    const count = Math.max(dels.length, adds.length);
    for (let k = 0; k < count; k++) {
      const left = dels[k];
      const right = adds[k];
      if (left && right) {
        const spans = inlineDiff(left.text, right.text, options);
        out.push({ kind: "pair", left, right, leftSpans: spans.del, rightSpans: spans.add });
      } else {
        out.push({ kind: "pair", left, right });
      }
    }
  }
  return out;
}

// Computes word-level highlight spans for stacked diff items when removed/added blocks align.
export function stackedDiffSpans(items: Array<DiffLine | { kind: "skip"; count: number }>, options: LineDiffOptions = {}): Map<number, InlineSpan[]> {
  const spans = new Map<number, InlineSpan[]>();
  let i = 0;
  while (i < items.length) {
    if (items[i].kind !== "del") {
      i++;
      continue;
    }
    const delStart = i;
    while (i < items.length && items[i].kind === "del") i++;
    const addStart = i;
    while (i < items.length && items[i].kind === "add") i++;
    const pairs = Math.min(addStart - delStart, i - addStart);
    for (let k = 0; k < pairs; k++) {
      const delLine = items[delStart + k] as DiffLine;
      const addLine = items[addStart + k] as DiffLine;
      const pair = inlineDiff(delLine.text, addLine.text, options);
      spans.set(delStart + k, pair.del);
      spans.set(addStart + k, pair.add);
    }
  }
  return spans;
}
