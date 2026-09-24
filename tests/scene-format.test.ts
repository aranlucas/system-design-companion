// Formatting: wrapText/measureText, tidy guarantees, layout, addForeign, restoreTo.
import { describe, expect, it } from "vitest";
import type { El } from "../src/shared/protocol.ts";
import { Scene, graphView, measureText, wrapText, type Op } from "../src/worker/scene.ts";

function build(ops: Op[]): Scene {
  const s = new Scene([]);
  const res = s.apply(ops, "agent");
  expect(res.every((r) => r.ok)).toBe(true);
  return s;
}

function labels(s: Scene): string[] {
  return ((graphView(s) as { nodes?: Array<{ label: string }> }).nodes ?? []).map((n) => n.label);
}

describe("wrapText / measureText", () => {
  it("leaves short text alone", () => {
    expect(wrapText("hello")).toBe("hello");
    expect(wrapText("a\nb")).toBe("a\nb");
  });

  it("wraps long lines at 64 chars without breaking words", () => {
    const text = `word `.repeat(40).trim();
    const out = wrapText(text);
    expect(out).toContain("\n");
    for (const line of out.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(64);
      expect(line).not.toMatch(/^\s|\s$/);
    }
  });

  it("keeps list markers as a hanging indent", () => {
    const out = wrapText(`- ${`item `.repeat(30).trim()}`);
    const [first, ...rest] = out.split("\n");
    expect(first.startsWith("- ")).toBe(true);
    for (const line of rest) expect(line.startsWith("  ")).toBe(true);
  });

  it("measures longest line and line count", () => {
    expect(measureText("ab", 20)).toEqual({
      width: Math.ceil(2 * 20 * 0.6),
      height: Math.ceil(20 * 1.25),
    });
    const two = measureText("abcd\nef", 16);
    expect(two.width).toBe(Math.ceil(4 * 16 * 0.6));
    expect(two.height).toBe(Math.ceil(2 * 16 * 1.25));
  });
});

describe("tidy", () => {
  // Genuinely messy raw elements (as human freehand or imports produce),
  // bypassing the ops layer's own overlap-nudging and frame-attach.
  let seq = 100;
  const idx = () => `b${String(seq++).padStart(6, "0")}`;
  const base = (id: string, type: string, x: number, y: number, w: number, h: number): El => ({
    id,
    type,
    x,
    y,
    width: w,
    height: h,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    index: idx(),
    boundElements: [],
    backgroundColor: "transparent",
  });
  function cluttered(): Scene {
    const f = { ...base("f", "frame", 0, 0, 1600, 900), name: "F" };
    const mkNode = (id: string, x: number, y: number, label: string, frameId: string | null) => {
      const n: El = { ...base(id, "rectangle", x, y, 160, 70), frameId };
      const t: El = {
        ...base(`${id}-t`, "text", x, y, 50, 20),
        text: label,
        originalText: label,
        fontSize: 20,
        containerId: id,
        frameId,
      };
      n.boundElements = [{ id: t.id, type: "text" }];
      return [n, t] as El[];
    };
    const arrow = {
      ...base("arr", "arrow", 0, 0, 0, 0),
      points: [
        [0, 0],
        [10, 10],
      ],
      strokeStyle: "solid",
      startBinding: { elementId: "a", focus: 0, gap: 8, fixedPoint: null },
      endBinding: { elementId: "c", focus: 0, gap: 8, fixedPoint: null },
    } as El;
    const note = {
      ...base("n1", "text", 500, 500, 2000, 20),
      text: `word `.repeat(40).trim(),
      originalText: `word `.repeat(40).trim(),
      fontSize: 20,
      containerId: null,
      frameId: null,
    } as El;
    return new Scene([
      f as El,
      ...mkNode("a", 100, 100, "Alpha", null),
      ...mkNode("b", 120, 120, "Beta", null),
      ...mkNode("c", 200, 150, "Gamma", null), // loose but inside F's area
      note,
      arrow,
    ]);
  }

  const overlaps = (s: Scene) => {
    const blocks = s.live().filter((e) => s.isNode(e) || (e.type === "text" && !e.containerId));
    let n = 0;
    for (let i = 0; i < blocks.length; i++)
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i];
        const b = blocks[j];
        if (
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height
        )
          n++;
      }
    return n;
  };

  it("separates overlaps and adopts loose blocks into their frame", () => {
    const s = cluttered();
    expect(overlaps(s)).toBeGreaterThan(0);
    const stats = s.tidy();
    expect(stats.separated + stats.adopted).toBeGreaterThan(0);
    expect(overlaps(s)).toBe(0);
  });

  it("never changes connections, labels, colours or node count", () => {
    const s = cluttered();
    const before = {
      labels: labels(s),
      edges: (graphView(s) as { edges?: Array<{ from: string; to: string }> }).edges?.map((e) => [
        e.from,
        e.to,
      ]),
      colors: s.live().map((e) => e.backgroundColor),
      count: s.live().length,
    };
    s.tidy();
    expect(labels(s)).toEqual(before.labels);
    expect(
      (graphView(s) as { edges?: Array<{ from: string; to: string }> }).edges?.map((e) => [
        e.from,
        e.to,
      ]),
    ).toEqual(before.edges);
    expect(s.live().map((e) => e.backgroundColor)).toEqual(before.colors);
    expect(s.live().length).toBe(before.count);
  });

  it("is idempotent: a second pass changes nothing", () => {
    const s = cluttered();
    s.tidy();
    const again = new Scene(structuredClone(s.live()));
    again.tidy();
    expect(again.changedElements()).toHaveLength(0);
  });

  it("supports scoping to a single frame", () => {
    const s = build([
      { op: "add_frame", ref: "f", name: "F" },
      { op: "add_node", ref: "a", label: "A", frame: "f", place: { at: { x: 0, y: 0 } } },
      { op: "add_node", ref: "b", label: "B", place: { at: { x: 5000, y: 5000 } } },
      { op: "add_node", ref: "c", label: "C", place: { at: { x: 5020, y: 5020 } } },
    ]);
    const frameId = s.resolve("f").id;
    const stats = s.tidy(new Set([frameId]));
    expect(stats).toBeDefined();
    // Out-of-scope pair untouched by this pass.
    expect(s.resolve("b").x).toBe(5000);
  });
});

describe("layout", () => {
  it("lays out top-level nodes and keeps edges bound", () => {
    const s = build([
      { op: "add_node", ref: "a", label: "A" },
      { op: "add_node", ref: "b", label: "B" },
      { op: "add_node", ref: "c", label: "C" },
      { op: "connect", from: "a", to: "b" },
      { op: "connect", from: "b", to: "c" },
    ]);
    expect(s.layout("LR")).toBe(3);
    expect(s.layout("TB")).toBe(3);
    const g = graphView(s) as { edges?: unknown[] };
    expect(g.edges).toHaveLength(2);
    for (const e of s.live()) {
      expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
    }
  });

  it("scopes to a frame on request and errors when empty", () => {
    const s = build([
      { op: "add_frame", ref: "f", name: "F" },
      { op: "add_node", ref: "a", label: "A", frame: "f" },
      { op: "add_node", ref: "b", label: "B", frame: "f" },
    ]);
    expect(s.layout("LR", "f")).toBe(2);
    expect(() => new Scene([]).layout("LR")).toThrow("nothing to lay out");
  });
});

describe("addForeign / restoreTo", () => {
  it("imports foreign elements as a block with reset versions", () => {
    const s = build([{ op: "add_node", label: "Home" }]);
    const foreign = new Scene([]);
    foreign.apply(
      [
        { op: "add_node", ref: "x", label: "X" },
        { op: "add_node", ref: "y", label: "Y", place: { right_of: "x" } },
      ],
      "human",
    );
    const incoming = structuredClone(foreign.live());
    const added = s.addForeign(incoming, "agent");
    expect(added).toBe(incoming.length);
    const imported = s.live().filter((e) => s.labelOf(e) === "X" || s.labelOf(e) === "Y");
    expect(imported.every((e) => e.customData.author === "agent")).toBe(true);
    expect(
      imported.filter((e) => e.type !== "text").every((e) => e.strokeColor === "#6741d9"),
    ).toBe(true);
  });

  it("returns 0 for empty imports", () => {
    expect(build([]).addForeign([], "agent")).toBe(0);
  });

  it("restoreTo tombstones missing elements and bumps every version", () => {
    const s = build([
      { op: "add_node", ref: "a", label: "A" },
      { op: "add_node", ref: "b", label: "B" },
    ]);
    const snap = structuredClone(s.live());
    const vBefore = s.resolve("a").version;
    s.apply(
      [
        { op: "remove", target: "b" },
        { op: "add_node", label: "C" },
      ],
      "agent",
    );
    s.restoreTo(structuredClone(snap) as ReturnType<Scene["live"]>);
    expect(labels(s).sort()).toEqual(["A", "B"]);
    expect(s.resolve("a").version).toBeGreaterThan(vBefore);
  });

  it("survives a JSON round-trip (the R2 snapshot path)", () => {
    const s = build([
      { op: "add_node", ref: "a", label: "A" },
      { op: "add_node", ref: "b", label: "B" },
      { op: "connect", from: "a", to: "b", label: "e" },
      { op: "add_note", text: "n" },
    ]);
    const raw = JSON.parse(JSON.stringify(s.live())) as ReturnType<Scene["live"]>;
    const copy = new Scene(raw);
    expect(graphView(copy)).toEqual(graphView(s));
  });
});
