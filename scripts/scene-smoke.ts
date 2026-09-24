import { Scene, graphView } from "../src/worker/scene.ts";
const s = new Scene([]);
const r = s.apply(
  [
    {
      op: "add_frame",
      ref: "hld",
      name: "High-level design",
      place: { at: { x: 0, y: 0 } },
      width: 1200,
      height: 600,
    },
    { op: "add_node", ref: "c", label: "Client", shape: "ellipse", frame: "hld" },
    { op: "add_node", ref: "lb", label: "Load Balancer", place: { right_of: "c" }, frame: "hld" },
    { op: "add_node", ref: "api", label: "API Service", place: { right_of: "lb" }, color: "blue" },
    {
      op: "add_node",
      label: "Postgres",
      shape: "ellipse",
      place: { below: "api" },
      color: "green",
    },
    { op: "connect", from: "c", to: "lb", label: "HTTPS" },
    { op: "connect", from: "Load Balancer", to: "api" },
    { op: "connect", from: "api", to: "Postgres", dashed: true },
    { op: "add_note", text: "QPS ~ 10k", place: { near: "api" } },
    { op: "connect", from: "nope", to: "api" },
    {
      op: "update",
      target: "api",
      label: "API Service (stateless)",
      move: { right_of: "Load Balancer", gap: 200 },
    },
  ],
  "agent",
);
console.log(r.filter((x) => !x.ok));
console.log(JSON.stringify(graphView(s), null, 1));
console.log("layout", s.layout("LR", "hld"));
s.apply([{ op: "remove", target: "Postgres" }], "agent");
const g = graphView(s) as any;
console.log(
  "after remove edges:",
  g.edges.length,
  "nodes:",
  g.nodes.map((n: any) => n.label),
);
console.log(
  "changed",
  s.changedElements().length,
  "indices monotonic",
  s.live().every((e, i, a) => i === 0 || a[i - 1].index! < e.index!),
);
