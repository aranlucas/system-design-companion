// Native tooling cannot report this product's Scene.tidy layout metrics or rewrite get_scene exports.
// Retained diagnostic uses the same Scene and layoutReport contracts exercised by test/scene-tidy.test.ts.
// Usage: node scripts/tidy-check.ts <raw-elements.json> [out.json]
// Reports layout problems before/after Scene.tidy() on a real diagram export (get_scene format=raw).
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { storedElementsSchema } from "../src/shared/schemas.ts";
import { Scene } from "../src/worker/scene.ts";
import { layoutReport } from "../test/helpers/layout-report.ts";

const els = storedElementsSchema.parse(JSON.parse(readFileSync(process.argv[2], "utf8")));

const s = new Scene(els);

// eslint-disable-next-line no-console -- This CLI command reports its validation/build results to the terminal.
console.log("before", layoutReport(s));

// eslint-disable-next-line no-console -- This CLI command reports its validation/build results to the terminal.
console.log("tidy", s.tidy());

// eslint-disable-next-line no-console -- This CLI command reports its validation/build results to the terminal.
console.log("after ", layoutReport(s), "changed", s.changedElements().length);

const again = new Scene(s.live());

again.tidy();

// eslint-disable-next-line no-console -- This CLI command reports its validation/build results to the terminal.
console.log("idempotent (2nd pass changes):", again.changedElements().length);

if (process.argv[3]) {
  writeFileSync(process.argv[3], JSON.stringify(s.live()));
}
