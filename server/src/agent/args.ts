// Tool arguments from models that do not always write clean JSON. OpenAI-compatible models in
// particular send code fences, trailing commas, Python literals or JSON inside a string. The
// repairs here are conservative: each one is a known mistake, and what still does not parse is
// reported back to the model with what it sent and what was expected, so it can try again.

const MAX_REPAIR_CHARS = 1024 * 1024;

// Walks the text once, outside strings only, and fixes what is safe to fix there.
function repairOutsideStrings(text: string): string {
  let out = "";
  let inString: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") {
        out += ch + (text[i + 1] ?? "");
        i++;
        continue;
      }
      if (ch === inString) {
        inString = null;
        out += '"';
        continue;
      }
      // A double quote inside a single-quoted string needs escaping once the quotes are swapped.
      if (inString === "'" && ch === '"') {
        out += '\\"';
        continue;
      }
      // Raw newlines and tabs are not allowed inside JSON strings.
      if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else out += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      out += '"';
      continue;
    }
    // Trailing commas before a closing bracket.
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === "}" || text[j] === "]") continue;
    }
    // Python and JavaScript literals.
    const rest = text.slice(i);
    const literal = /^(True|False|None|undefined)(?![\w$])/.exec(rest);
    if (literal && !/[\w$]/.test(text[i - 1] ?? "")) {
      out += literal[1] === "True" ? "true" : literal[1] === "False" ? "false" : "null";
      i += literal[1].length - 1;
      continue;
    }
    // Unquoted keys: { path: "a" } or , path: "a".
    const key = /^([A-Za-z_$][\w$-]*)(\s*):/.exec(rest);
    if (key && /[{,]\s*$/.test(out)) {
      out += `"${key[1]}"${key[2]}:`;
      i += key[0].length - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

function tryObject(text: string): Record<string, unknown> | undefined {
  try {
    let value: unknown = JSON.parse(text);
    // JSON encoded twice: a string that holds the object.
    if (typeof value === "string" && /^\s*\{/.test(value)) value = JSON.parse(value);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // Not this one.
  }
  return undefined;
}

// Returns the arguments as an object, or undefined when nothing safe made them parse.
export function repairJson(raw: string): Record<string, unknown> | undefined {
  if (raw.length > MAX_REPAIR_CHARS) return undefined;
  let text = raw.trim();
  const direct = tryObject(text);
  if (direct) return direct;
  // ```json ... ``` around the object.
  const fenced = /^```[\w-]*\s*\n?([\s\S]*?)\n?```$/.exec(text);
  if (fenced) text = fenced[1].trim();
  // Text before or after the object, such as "Here are the arguments: {...}".
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start > 0 || (end !== -1 && end < text.length - 1)) {
    if (start === -1 || end <= start) return undefined;
    text = text.slice(start, end + 1);
  }
  return tryObject(text) ?? tryObject(repairOutsideStrings(text));
}

// What a property's JSON schema says, as far as coercion needs.
interface PropSchema {
  type?: string;
  items?: PropSchema;
  properties?: Record<string, PropSchema>;
}

// Gives each value the type the schema asks for, when the model sent the same value in the wrong
// type: "10" for 10, "true" for true, a JSON string for a list. Anything else is left as it is,
// and the tool itself says what is wrong.
export function coerceArgs(input: Record<string, unknown>, schema: Record<string, unknown>): Record<string, unknown> {
  const props = (schema.properties ?? {}) as Record<string, PropSchema>;
  const out: Record<string, unknown> = { ...input };
  for (const [name, prop] of Object.entries(props)) {
    const value = out[name];
    if (value === undefined || value === null) continue;
    out[name] = coerceValue(value, prop);
  }
  return out;
}

function coerceValue(value: unknown, prop: PropSchema): unknown {
  if ((prop.type === "integer" || prop.type === "number") && typeof value === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) {
    const n = Number(value);
    return prop.type === "integer" ? Math.trunc(n) : n;
  }
  if (prop.type === "boolean" && typeof value === "string") {
    if (/^(true|yes|1)$/i.test(value.trim())) return true;
    if (/^(false|no|0)$/i.test(value.trim())) return false;
  }
  if (prop.type === "string" && (typeof value === "number" || typeof value === "boolean")) return String(value);
  if ((prop.type === "array" || prop.type === "object") && typeof value === "string") {
    const parsed = (() => {
      try {
        return JSON.parse(value);
      } catch {
        return repairJson(value);
      }
    })();
    if (prop.type === "array" && Array.isArray(parsed)) return prop.items ? parsed.map((v) => coerceValue(v, prop.items!)) : parsed;
    if (prop.type === "object" && parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  }
  if (prop.type === "array" && Array.isArray(value) && prop.items) return value.map((v) => coerceValue(v, prop.items!));
  if (prop.type === "object" && value && typeof value === "object" && !Array.isArray(value) && prop.properties) {
    return coerceArgs(value as Record<string, unknown>, prop as Record<string, unknown>);
  }
  return value;
}

// Models sometimes write "functions.read_file", "Read_File" or "read-file".
export function resolveToolName(name: string, known: Iterable<string>): string | undefined {
  const names = [...known];
  if (names.includes(name)) return name;
  const plain = (s: string) => s.toLowerCase().replace(/^(functions?|tools?)[.:]/, "").replace(/-/g, "_").trim();
  const wanted = plain(name);
  return names.find((n) => plain(n) === wanted);
}

// A one-line picture of the arguments a tool takes, for error messages.
export function describeParams(schema: Record<string, unknown>): string {
  const props = (schema.properties ?? {}) as Record<string, PropSchema>;
  const required = new Set((schema.required ?? []) as string[]);
  const fields = Object.entries(props).map(([name, prop]) => `${name}${required.has(name) ? "" : "?"}: ${prop.type ?? "any"}`);
  return `{ ${fields.join(", ")} }`;
}
