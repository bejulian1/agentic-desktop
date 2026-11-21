import assert from "node:assert/strict";
import { test } from "node:test";
import { extract, metadataKeys } from "../../scripts/i18n.ts";

test("extract aliases, namespace imports and plural forms, not shadowed calls", () => {
  const keys = new Set<string>(), errors: string[] = [];
  extract(`import { t as label } from "../lib/i18n";
    import * as native from "./i18n.ts";
    const element = <button title={label("Lukk")}>{native.plural(2, "{count} fil", "{count} filer")}</button>;
    function unrelated(label: Function) { label(dynamic); }
    native.t(dynamic);
    label(\`computed \${count}\`);`, "example.tsx", keys, errors);
  assert.deepEqual([...keys], ["Lukk", "{count} fil", "{count} filer"]);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /example.tsx:5: t requires a static source string/);
});

test("shared source markers are static and lookups do not extract user content", () => {
  const keys = new Set<string>(), errors: string[] = [];
  extract(`import { sourceText as mark } from "./i18n.ts";
    import { lookupMessage } from "../lib/i18n";
    mark("Filen er for stor"); lookupMessage(result); mark(dynamic);`, "metadata.ts", keys, errors);
  assert.deepEqual([...keys], ["Filen er for stor"]);
  assert.deepEqual(errors, ["metadata.ts:3: sourceText requires a static source string"]);
});

test("catalog shared display fields without collecting prompts or commands", () => {
  const keys = new Set(metadataKeys());
  for (const label of ["Snakkeboble", "Oransje", "Profesjonell", "Stjernehimmel"]) assert.ok(keys.has(label), label);
  assert.ok(!keys.has("Be brief. Answer in as few words as the task allows."));
  assert.ok(!keys.has("npx"));
});
