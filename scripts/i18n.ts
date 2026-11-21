import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import { languages } from "../shared/i18n.ts";

const traverse = traverseModule.default ?? traverseModule;
const root = path.resolve(import.meta.dirname, "..");

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory() && !["test", "build", "locales"].includes(entry.name)) yield* sources(file);
    else if (entry.isFile() && /\.[jt]sx?$/.test(file)) yield file;
  }
}

export function extract(text: string, file: string, keys: Set<string>, errors: string[]): void {
  const tree = parse(text, { sourceType: "unambiguous", plugins: ["typescript", "jsx"] });
  traverse(tree, { CallExpression(call) {
    const callee = call.node.callee;
    const local = callee.type === "Identifier" ? callee : callee.type === "MemberExpression" && callee.object.type === "Identifier" ? callee.object : null;
    if (!local) return;
    const binding = call.scope.getBinding(local.name)?.path;
    const declaration = binding?.parentPath?.node;
    if (!binding || declaration?.type !== "ImportDeclaration" || !/\/i18n(?:\.ts)?$/.test(declaration.source.value)) return;
    let name: string | undefined;
    if (binding.isImportSpecifier() && callee.type === "Identifier") {
      const imported = binding.node.imported;
      name = imported.type === "Identifier" ? imported.name : imported.value;
    } else if (binding.isImportNamespaceSpecifier() && callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") name = callee.property.name;
    for (const index of name === "t" ? [0] : name === "plural" ? [1, 2] : []) {
      const argument = call.node.arguments[index];
      if (argument?.type === "StringLiteral") keys.add(argument.value);
      else if (argument?.type === "TemplateLiteral" && !argument.expressions.length) keys.add(argument.quasis[0].value.cooked ?? argument.quasis[0].value.raw);
      else errors.push(`${file}:${call.node.loc?.start.line}: ${name} requires a static source string`);
    }
  } });
}

const placeholders = (text: string) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort().join(",");

function serverMessages(): Set<string> {
  const messages = new Set<string>();
  for (const file of sources(path.join(root, "server/src"))) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("new HttpError")) continue;
    traverse(parse(text, { sourceType: "module", plugins: ["typescript"] }), { NewExpression({ node }) {
      const message = node.arguments[1];
      if (node.callee.type === "Identifier" && node.callee.name === "HttpError" && message?.type === "StringLiteral") messages.add(message.value);
    } });
  }
  return messages;
}

if (import.meta.main) {
  const command = process.argv[2];
  if (!["extract", "check"].includes(command)) throw new Error("Usage: node scripts/i18n.ts extract|check [--strict]");
  const keys = new Set<string>(), errors: string[] = [];
  const optional = command === "check" ? serverMessages() : new Set<string>();
  for (const dir of ["web/src", "desktop"]) for (const file of sources(path.join(root, dir))) extract(readFileSync(file, "utf8"), path.relative(root, file), keys, errors);
  if (command === "extract") console.log(JSON.stringify([...keys].sort(), null, 2));
  else for (const language of Object.keys(languages).filter(code => code !== "nb")) {
    const catalog = JSON.parse(readFileSync(path.join(root, "web/src/locales", `${language}.json`), "utf8"));
    const missing = [...keys].filter(key => !Object.hasOwn(catalog, key) || catalog[key] === "").sort();
    for (const [key, value] of Object.entries(catalog)) {
      if (!keys.has(key) && !optional.has(key)) errors.push(`${language}: stale: ${key}`);
      if (typeof value !== "string" || (value && placeholders(key) !== placeholders(value))) errors.push(`${language}: invalid text or placeholders: ${key}`);
    }
    console.log(`${language}: ${missing.length} missing of ${keys.size}${missing.length ? "\n  " + missing.join("\n  ") : ""}`);
    if (missing.length && process.argv.includes("--strict")) errors.push(`${language}: incomplete catalog`);
  }
  if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
}
