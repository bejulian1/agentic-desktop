import assert from "node:assert/strict";
import { test } from "node:test";
import { extract } from "../../scripts/i18n.ts";

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
