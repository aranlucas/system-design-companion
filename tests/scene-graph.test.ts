// Read model: graph(), graphView(), selection, inferred edges, sketches.
import { describe, expect, it } from "vitest";
import type { El, Point } from "../src/shared/protocol.ts";
import { Scene, graphView, type Op } from "../src/worker/scene.ts";

let seq = 0;
const idx = () => `a${String(seq++).padStart(6, "0")}`;

function rect(id: string, x: number, y: number, w = 160, h = 70): El {
  return {
    id,
    type: "rectangle",
    x,
    y,
    width: w,
    height: h,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    index: idx(),
    boundElements: [],
  };
}

function boundLabel(id: string, container: El, label: string): El {
  container.boundElements = [{ id, type: "text" }];
  return {
    id,
    type: "text",
    x: container.x,
    y: container.y,
    width: 50,
    height: 20,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    index: idx(),
    text: label,
    originalText: label,
    fontSize: 20,
    containerId: container.id,
    boundElements: null,
  };
}

function arrow(
  id: string,
  x: number,
  y: number,
  pts: Point[],
  startId?: string,
  endId?: string,
): El {
  return {
    id,
    type: "arrow",
    x,
    y,
    width: 0,
    height: 0,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    index: idx(),
    points: pts,
    strokeStyle: "solid",
    ...(startId
      ? { startBinding: { elementId: startId, focus: 0, gap: 8, fixedPoint: null } }
      : {}),
    ...(endId ? { endBinding: { elementId: endId, focus: 0, gap: 8, fixedPoint: null } } : {}),
  };
}

function view(s: Scene, sel?: Set<string>) {
  return graphView(s, sel);
}

function build(ops: Op[]): Scene {
  const s = new Scene([]);
  const res = s.apply(ops, "agent");
  expect(res.every((r) => r.ok)).toBe(true);
  return s;
}

describe("graph()", () => {
  it("returns an empty object for an empty scene", () => {
    expect(view(new Scene([]))).toEqual({});
  });

  it("lists frames, nodes, edges and notes with their fields", () => {
    const s = build([
      { op: "add_frame", ref: "f", name: "HLD" },
      { op: "add_node", ref: "a", label: "API", kind: "service", frame: "f" },
      { op: "add_node", ref: "b", label: "DB", kind: "sql_db" },
      { op: "connect", from: "a", to: "b", label: "reads" },
      { op: "add_note", text: "note here", frame: "f" },
    ]);
    const g = view(s);
    expect(g.frames![0].name).toBe("HLD");
    expect(g.nodes).toHaveLength(2);
    expect(g.nodes![0].frame).toBe("HLD");
    expect(g.nodes![0].kind).toBe("service");
    expect(g.nodes![0].by).toBe("agent");
    expect(g.edges![0]).toMatchObject({ from: "API", to: "DB", label: "reads" });
    expect(g.notes![0].frame).toBe("HLD");
  });

  it("disambiguates duplicate labels with #id suffixes", () => {
    const s = build([
      { op: "add_node", ref: "a", label: "API" },
      { op: "add_node", ref: "b", label: "API" },
      { op: "connect", from: "a", to: "b" },
    ]);
    const g = view(s);
    const aId = s.resolve("a").id;
    const bId = s.resolve("b").id;
    expect(g.edges![0].from).toBe(`API#${aId}`);
    expect(g.edges![0].to).toBe(`API#${bId}`);
  });

  it("marks the current selection", () => {
    const s = build([
      { op: "add_node", ref: "a", label: "A" },
      { op: "add_node", ref: "b", label: "B" },
    ]);
    const g = view(s, new Set([s.resolve("a").id]));
    expect(g.nodes!.find((n) => n.label === "A")!.selected).toBe(true);
    expect(g.nodes!.find((n) => n.label === "B")!.selected).toBeUndefined();
  });

  it("infers edges for unbound arrows that touch two nodes", () => {
    const a = rect("a", 0, 0);
    const b = rect("b", 300, 0);
    const t1 = boundLabel("t1", a, "Alpha");
    const t2 = boundLabel("t2", b, "Beta");
    const s = new Scene([
      a,
      b,
      t1,
      t2,
      arrow("arr", 10, 10, [
        [0, 0],
        [340, 0],
      ]),
    ]);
    const g = view(s);
    expect(g.edges).toHaveLength(1);
    expect(g.edges![0]).toMatchObject({ from: "Alpha", to: "Beta", inferred: true });
  });

  it("reports stray arrows and freedraw as sketches", () => {
    const s = new Scene([
      arrow("lonely", 5000, 5000, [
        [0, 0],
        [50, 50],
      ]),
      { ...rect("scribble", 6000, 6000), type: "freedraw" },
    ]);
    const g = view(s);
    expect(g.edges ?? []).toHaveLength(0);
    expect(g.sketches!.map((x) => x.id).sort()).toEqual(["lonely", "scribble"]);
  });

  it("hides internal raw edges from the agent view", () => {
    const s = build([
      { op: "add_node", ref: "a", label: "A" },
      { op: "add_node", ref: "b", label: "B" },
      { op: "connect", from: "a", to: "b" },
    ]);
    expect("_edgesRaw" in view(s)).toBe(false);
    expect("_edgesRaw" in (s.graph() as Record<string, unknown>)).toBe(true);
  });
});
