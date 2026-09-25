// Usage: node scripts/tidy-check.ts <raw-elements.json> [out.json]
// Reports layout problems before/after Scene.tidy() on a real diagram export (get_scene format=raw).
import { readFileSync, writeFileSync } from "node:fs";
import { Scene } from "../src/worker/scene.ts";
import { layoutReport } from "../tests/helpers/layout-report.ts";

const els = JSON.parse(readFileSync(process.argv[2], "utf8"));
const s = new Scene(els);
console.log("before", layoutReport(s));
console.log("tidy", s.tidy());
console.log("after ", layoutReport(s), "changed", s.changedElements().length);
const again = new Scene(s.live());
again.tidy();
console.log("idempotent (2nd pass changes):", again.changedElements().length);
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(s.live()));
