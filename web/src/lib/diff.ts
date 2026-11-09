// A line diff: common start and end are trimmed, and what is left goes through a plain LCS table.
// Files too large for the table show as replaced, instead of freezing the panel.
export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
  oldLine?: number;
  newLine?: number;
}

const MAX_TABLE = 4_000_000;

export function diffLines(before: string | null, after: string | null): DiffLine[] {
  const a = before ? before.split("\n") : [];
  const b = after ? after.split("\n") : [];
  if (before?.endsWith("\n")) a.pop();
  if (after?.endsWith("\n")) b.pop();
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ kind: "same", text: a[i], oldLine: i + 1, newLine: i + 1 });

  const n = endA - start;
  const m = endB - start;
  if (n * m > MAX_TABLE) {
    for (let i = start; i < endA; i++) out.push({ kind: "del", text: a[i], oldLine: i + 1 });
    for (let j = start; j < endB; j++) out.push({ kind: "add", text: b[j], newLine: j + 1 });
  } else {
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] = a[start + i] === b[start + j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) {
        out.push({ kind: "same", text: a[start + i], oldLine: start + i + 1, newLine: start + j + 1 });
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
  for (let i = endA, j = endB; i < a.length; i++, j++) out.push({ kind: "same", text: a[i], oldLine: i + 1, newLine: j + 1 });
  return out;
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
