// edit_file's matching. An exact match comes first. When there is none, a few known slips are
// forgiven, one at a time, as long as the match stays unique: line numbers copied from read_file,
// Windows line endings, spaces at the end of lines and different indentation. That is what Aider
// and OpenCode found to cut edit errors the most. When nothing matches, the error shows the most
// similar lines of the file, so the model can copy them instead of guessing again.

export type EditResult =
  | { after: string; firstLine: number; lastLine: number; note?: string }
  | { error: string };

const NUMBER_PREFIX = /^ *\d+(?:\t|→|│| \| )/;

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function occurrences(text: string, search: string): number[] {
  const out: number[] = [];
  for (let at = text.indexOf(search); at !== -1; at = text.indexOf(search, at + search.length)) out.push(at);
  return out;
}

function listLines(lines: number[]): string {
  const shown = lines.slice(0, 8).join(", ");
  return lines.length > 8 ? `${shown} og ${lines.length - 8} til` : shown;
}

// A replacement at known character positions, which is what every strategy ends up as.
function apply(content: string, spans: Array<[number, number]>, replacement: string): { after: string; firstLine: number; lastLine: number } {
  let after = "";
  let last = 0;
  for (const [start, end] of spans) {
    after += content.slice(last, start) + replacement;
    last = end;
  }
  after += content.slice(last);
  const firstStart = spans[0][0];
  const firstLine = lineOf(content, firstStart);
  return { after, firstLine, lastLine: firstLine + replacement.split("\n").length - 1 };
}

function exact(content: string, oldText: string, newText: string, all: boolean, rel: string, note?: string): EditResult | null {
  const found = occurrences(content, oldText);
  if (!found.length) return null;
  if (found.length > 1 && !all) {
    const lines = found.map((at) => lineOf(content, at));
    return { error: `old_string finnes ${found.length} ganger i ${rel}, på linje ${listLines(lines)}. Ta med flere linjer rundt, så teksten blir unik, eller sett replace_all: true for å endre alle.` };
  }
  return { ...apply(content, found.map((at) => [at, at + oldText.length]), newText), ...(note ? { note } : {}) };
}

function indentOf(line: string): string {
  return /^[ \t]*/.exec(line)![0];
}

// Line by line, comparing with `same`. Returns [startLine, endLine) pairs, 0-based.
function lineMatches(fileLines: string[], wanted: string[], same: (a: string, b: string) => boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (!wanted.length) return out;
  for (let i = 0; i + wanted.length <= fileLines.length; i++) {
    let ok = true;
    for (let j = 0; j < wanted.length && ok; j++) ok = same(fileLines[i + j], wanted[j]);
    if (ok) out.push([i, i + wanted.length]);
  }
  return out;
}

// Gives new_string the file's indentation. When old_string was off by the same amount on every
// line, new_string is moved by that amount. When it was flattened or mixed, each new line that
// also was in old_string gets that line's indentation from the file (line by line when the
// counts match), and the others follow the line before them.
function reindent(newText: string, wanted: string[], matched: string[]): string {
  const pairs = wanted.map((line, i) => ({ own: indentOf(line), file: indentOf(matched[i]), text: line.trim() })).filter((p) => p.text);
  if (!pairs.length) return newText;
  const first = pairs[0];
  const shift = (own: string, file: string) => (file.endsWith(own) ? { add: file.slice(0, file.length - own.length), cut: "" } : own.endsWith(file) ? { add: "", cut: own.slice(0, own.length - file.length) } : null);
  const base = shift(first.own, first.file);
  const consistent = base && pairs.every((p) => {
    const s = shift(p.own, p.file);
    return s && s.add === base.add && s.cut === base.cut;
  });
  const lines = newText.split("\n");
  if (consistent) {
    if (!base.add && !base.cut) return newText;
    return lines.map((line) => (!line.trim() ? line : base.cut && line.startsWith(base.cut) ? line.slice(base.cut.length) : base.add + line)).join("\n");
  }
  // Same number of lines: line k of new_string takes the indentation of line k in the file.
  const filled = lines.filter((line) => line.trim());
  if (filled.length === pairs.length) {
    let k = 0;
    return lines.map((line) => (line.trim() ? pairs[k++].file + line.trimStart() : line)).join("\n");
  }
  const known = new Map<string, string>();
  for (const p of pairs) if (!known.has(p.text)) known.set(p.text, p.file);
  let previous = { own: "", file: first.file };
  return lines
    .map((line) => {
      if (!line.trim()) return line;
      const own = indentOf(line);
      const file = known.get(line.trim()) ?? (own.length > previous.own.length ? previous.file + own.slice(previous.own.length) : previous.file);
      previous = { own, file };
      return file + line.trimStart();
    })
    .join("\n");
}

function tolerant(content: string, oldText: string, newText: string, all: boolean, rel: string): EditResult | null {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const fileLines = content.split(eol);
  const trimEdges = (lines: string[]) => {
    let a = 0;
    let b = lines.length;
    while (a < b && !lines[a].trim()) a++;
    while (b > a && !lines[b - 1].trim()) b--;
    return lines.slice(a, b);
  };
  const wanted = trimEdges(oldText.split(/\r?\n/));
  if (!wanted.length) return null;
  const strategies: Array<{ same: (a: string, b: string) => boolean; note: string; reindent: boolean }> = [
    { same: (a, b) => a.trimEnd() === b.trimEnd(), note: "Fant teksten når mellomrom på slutten av linjene ble sett bort fra.", reindent: false },
    { same: (a, b) => a.trim() === b.trim(), note: "Fant teksten når innrykket ble sett bort fra. new_string fikk samme innrykk som filen.", reindent: true },
    { same: (a, b) => a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " "), note: "Fant teksten når forskjeller i mellomrom ble sett bort fra.", reindent: true },
  ];
  for (const strategy of strategies) {
    const found = lineMatches(fileLines, wanted, strategy.same);
    if (!found.length) continue;
    if (found.length > 1 && !all) {
      return { error: `old_string passer ${found.length} steder i ${rel} når mellomrom ses bort fra, på linje ${listLines(found.map(([s]) => s + 1))}. Ta med flere linjer rundt, så teksten blir unik.` };
    }
    // Character spans of the matched lines, so the replacement keeps the file's line endings.
    const starts: number[] = [0];
    for (let i = 0; i < fileLines.length; i++) starts.push(starts[i] + fileLines[i].length + eol.length);
    const spans: Array<[number, number]> = found.map(([s, e]) => [starts[s], starts[e] - eol.length]);
    let replacement = newText.replace(/\r?\n/g, eol);
    if (strategy.reindent) replacement = reindent(replacement, wanted, fileLines.slice(found[0][0], found[0][1]));
    // old_string's own blank first and last lines were dropped; drop new_string's too.
    replacement = replacement.replace(new RegExp(`^(?:[ \\t]*${eol === "\r\n" ? "\\r\\n" : "\\n"})+`), "").replace(new RegExp(`(?:${eol === "\r\n" ? "\\r\\n" : "\\n"}[ \\t]*)+$`), "");
    return { ...apply(content, spans, replacement), note: strategy.note };
  }
  return null;
}

// How alike two lines are: shared character pairs, from 0 to 1.
function similarity(a: string, b: string): number {
  a = a.trim();
  b = b.trim();
  if (!a || !b) return 0;
  if (a === b) return 1;
  const pairs = (s: string) => {
    const map = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const pair = s.slice(i, i + 2);
      map.set(pair, (map.get(pair) ?? 0) + 1);
    }
    return map;
  };
  const pa = pairs(a);
  const pb = pairs(b);
  let shared = 0;
  for (const [pair, n] of pa) shared += Math.min(n, pb.get(pair) ?? 0);
  return (2 * shared) / Math.max(1, a.length - 1 + b.length - 1);
}

function closest(content: string, oldText: string): string {
  const fileLines = content.split(/\r?\n/);
  const wanted = oldText.split(/\r?\n/).filter((l) => l.trim());
  if (!wanted.length || !fileLines.length) return "";
  let best = { score: 0, at: -1 };
  for (let i = 0; i < fileLines.length; i++) {
    let score = 0;
    for (let j = 0; j < Math.min(wanted.length, 6) && i + j < fileLines.length; j++) score += similarity(fileLines[i + j], wanted[j]);
    score /= Math.min(wanted.length, 6);
    if (score > best.score) best = { score, at: i };
  }
  if (best.at < 0 || best.score < 0.4) return "";
  const from = Math.max(0, best.at - 1);
  const to = Math.min(fileLines.length, best.at + wanted.length + 1, from + 15);
  const shown = fileLines.slice(from, to).map((line, i) => `${from + i + 1}\t${line.length > 300 ? `${line.slice(0, 300)}…` : line}`);
  return `\n\nMest lik tekst i filen (linje ${from + 1}–${to}):\n${shown.join("\n")}`;
}

export function findEdit(content: string, oldText: string, newText: string, all: boolean, rel: string): EditResult {
  const direct = exact(content, oldText, newText, all, rel);
  if (direct) return direct;

  // Line numbers copied from read_file along with the text.
  const oldLines = oldText.split("\n");
  const numberedLines = oldLines.filter((l) => l.trim());
  if (numberedLines.length && numberedLines.every((l) => NUMBER_PREFIX.test(l))) {
    const strip = (text: string) => text.split("\n").map((l) => l.replace(NUMBER_PREFIX, "")).join("\n");
    const newStripped = newText.split("\n").every((l) => !l.trim() || NUMBER_PREFIX.test(l)) ? strip(newText) : newText;
    const result = exact(content, strip(oldText), newStripped, all, rel, "Linjenumrene fra read_file ble fjernet fra old_string før søket.")
      ?? tolerant(content, strip(oldText), newStripped, all, rel);
    if (result) return result;
  }

  // The file has Windows line endings, and the model wrote \n.
  if (content.includes("\r\n") && !oldText.includes("\r\n")) {
    const result = exact(content, oldText.replace(/\n/g, "\r\n"), newText.replace(/\r?\n/g, "\r\n"), all, rel);
    if (result) return result;
  }

  const loose = tolerant(content, oldText, newText, all, rel);
  if (loose) return loose;

  return {
    error: `Teksten i old_string finnes ikke lenger i ${rel}, eller den var aldri der.${closest(content, oldText)}\n\n` +
      "Les filen på nytt med read_file og kopier teksten nøyaktig, uten linjenumrene. Filen kan også være endret av en annen tråd.",
  };
}
