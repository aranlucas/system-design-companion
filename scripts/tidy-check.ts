// Usage: node scripts/tidy-check.ts <raw-elements.json> [out.json]
// Reports layout problems before/after Scene.tidy() on a real diagram export (get_scene format=raw).
import { readFileSync, writeFileSync } from "node:fs";
import { Scene } from "../src/worker/scene.ts";

const els = JSON.parse(readFileSync(process.argv[2], "utf8"));
const report = (s: Scene) => {
  const live = s.live();
  const byId = new Map(live.map((e) => [e.id, e]));
  const blocks = live.filter((e) => s.isNode(e) || (e.type === "text" && !e.containerId));
  const frames = live.filter((e) => e.type === "frame");
  const ov = (a: any, b: any) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  let blockOverlaps = 0;
  for (let i = 0; i < blocks.length; i++)
    for (let j = i + 1; j < blocks.length; j++) if (ov(blocks[i], blocks[j])) blockOverlaps++;
  let frameOverlaps = 0;
  for (let i = 0; i < frames.length; i++)
    for (let j = i + 1; j < frames.length; j++) if (ov(frames[i], frames[j])) frameOverlaps++;
  const loose = blocks.filter((e) => !e.frameId).length;
  const outside = blocks.filter((e) => {
    const f = e.frameId && byId.get(e.frameId);
    return (
      f &&
      !(
        e.x >= f.x &&
        e.y >= f.y &&
        e.x + e.width <= f.x + f.width &&
        e.y + e.height <= f.y + f.height
      )
    );
  }).length;
  // Bound arrows whose drawn ends are detached (>20px) from the shapes they are bound to.
  const dist = (p: number[], e: any) =>
    Math.hypot(
      Math.max(e.x - p[0], 0, p[0] - (e.x + e.width)),
      Math.max(e.y - p[1], 0, p[1] - (e.y + e.height)),
    );
  let brokenArrows = 0;
  for (const a of live.filter((e) => e.type === "arrow")) {
    const pts = a.points;
    const ends: [any, number[]][] = [
      [a.startBinding && byId.get(a.startBinding.elementId), [a.x + pts[0][0], a.y + pts[0][1]]],
      [
        a.endBinding && byId.get(a.endBinding.elementId),
        [a.x + pts.at(-1)[0], a.y + pts.at(-1)[1]],
      ],
    ];
    if (ends.some(([n, p]) => n && dist(p, n) > 20)) brokenArrows++;
  }
  const widest = Math.max(...blocks.filter((e) => e.type === "text").map((e) => e.width));
  return {
    brokenArrows,
    blockOverlaps,
    frameOverlaps,
    loose,
    outsideFrame: outside,
    widestNote: widest,
  };
};
const s = new Scene(structuredClone(els));
console.log("before", report(s));
console.log("tidy", s.tidy());
console.log("after ", report(s), "changed", s.changedElements().length);
const again = new Scene(structuredClone(s.live()));
again.tidy();
console.log("idempotent (2nd pass changes):", again.changedElements().length);
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(s.live()));
