// Tidy behaviours: arrow binding, frame fitting, groups, spacing, push direction, and regressions
// measured with the same layout report scripts/tidy-check.ts prints.
import { describe, expect, it } from "vitest";
import type { El, Point } from "../src/shared/protocol.ts";
import { Scene, graphView, type Op } from "../src/worker/scene.ts";
import { BUILTIN_TEMPLATES } from "../src/worker/templates.ts";
import { DISPATCH_ARCHITECTURE } from "./fixtures/dispatch-architecture.ts";
import { layoutReport } from "./helpers/layout-report.ts";

/** Where a test drags a node; y defaults to where it is. */
type DragTarget = { x: number; y?: number };
/** A named scene for the table-driven regression checks. */
type Case = [name: string, make: () => Scene];

let seq = 0;
const el = (
  id: string,
  type: string,
  x: number,
  y: number,
  w = 160,
  h = 70,
  extra: Partial<El> = {},
): El => ({
  id,
  type,
  x,
  y,
  width: w,
  height: h,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  index: `a${String(seq++).padStart(6, "0")}`,
  boundElements: [],
  frameId: null,
  ...extra,
});
const rect = (id: string, x: number, y: number, extra: Partial<El> = {}) =>
  el(id, "rectangle", x, y, 160, 70, extra);
const arrow = (id: string, from: Point, to: Point, extra: Partial<El> = {}) =>
  el(id, "arrow", from[0], from[1], Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]), {
    points: [
      [0, 0],
      [to[0] - from[0], to[1] - from[1]],
    ],
    ...extra,
  });
const bound = (id: string) => ({ elementId: id, focus: 0, gap: 8, fixedPoint: null });

const idempotent = (s: Scene) => {
  const again = new Scene(s.live());
  again.tidy();
  return again.changedElements().length;
};

describe("tidy: binding loose arrow ends", () => {
  it("binds each end to the closest node, not the first one listed", () => {
    // The end at (80, 76) is 14px from B's top and 6px from A's bottom; B is listed first.
    const s = new Scene([
      rect("B", 0, 90),
      rect("A", 0, 0),
      rect("C", 600, 0),
      arrow("x", [600, 35], [80, 76]),
    ]);
    expect(s.tidy().bound).toBe(2);
    expect(s.resolve("x").startBinding.elementId).toBe("C");
    expect(s.resolve("x").endBinding.elementId).toBe("A");
  });

  it("leaves an arrow alone unless both ends land on nodes, as graph() reads it", () => {
    const s = new Scene([rect("A", 0, 0), arrow("x", [80, 76], [400, 400])]);
    expect(s.tidy().bound).toBe(0);
    expect(s.resolve("x").startBinding).toBeUndefined();
    expect(graphView(s).edges ?? []).toHaveLength(0);
  });

  it("binds the free end of a half-bound arrow when it lands on a node", () => {
    const s = new Scene([
      rect("A", 0, 0, { boundElements: [{ id: "x", type: "arrow" }] }),
      rect("C", 600, 0),
      arrow("x", [168, 35], [590, 35], { startBinding: bound("A") }),
    ]);
    expect(s.tidy().bound).toBe(1);
    expect(s.resolve("x").endBinding.elementId).toBe("C");
  });
});

describe("tidy: frame fitting", () => {
  // Move a node the way Excalidraw drags it: its label comes along.
  const drag = (s: Scene, id: string, to: DragTarget) => {
    const node = s.resolve(id);
    const dx = to.x - node.x;
    const dy = (to.y ?? node.y) - node.y;
    for (const e of [node, s.boundText(node)!]) s.mutate(e, { x: e.x + dx, y: e.y + dy });
  };

  function grownFrame() {
    const s = new Scene([]);
    const ops: Op[] = [
      { op: "add_frame", ref: "f", name: "F", place: { at: { x: 0, y: 0 } } },
      { op: "add_node", ref: "n", label: "N", frame: "f", place: { at: { x: 1200, y: 100 } } },
    ];
    expect(s.apply(ops, "agent").every((r) => r.ok)).toBe(true);
    const f = s.resolve("f");
    expect(f.width).toBeGreaterThan(800); // grew to hold N
    return { s, f, n: s.resolve("n") };
  }

  it("shrinks a frame it grew back to the chosen size once the content moves in", () => {
    const { s, f, n } = grownFrame();
    const moved = new Scene(s.live());
    drag(moved, n.id, { x: 100 });
    expect(moved.tidy().framesFitted).toBe(1);
    expect(moved.resolve(f.id)).toMatchObject({ x: 0, y: 0, width: 800, height: 500 });
    expect(idempotent(moved)).toBe(0);
  });

  it("keeps a size someone chose by resizing the frame", () => {
    const { s, f, n } = grownFrame();
    const resized = new Scene(s.live());
    resized.mutate(resized.resolve(f.id), { width: 2000 });
    drag(resized, n.id, { x: 100 });
    resized.tidy();
    expect(resized.resolve(f.id).width).toBe(2000);
  });

  it("still fits after the frame is moved", () => {
    const { s, f, n } = grownFrame();
    const moved = new Scene(s.live());
    const frame = moved.resolve(f.id);
    moved.mutate(frame, { x: frame.x + 300, y: frame.y + 300 });
    drag(moved, n.id, { x: 400, y: 400 });
    moved.tidy();
    expect(moved.resolve(f.id)).toMatchObject({ x: 300, y: 300, width: 800, height: 500 });
  });
});

describe("tidy: groups", () => {
  it("pushes a group out of the way as one piece, keeping its artwork intact", () => {
    const s = new Scene([
      rect("g1", 0, 0, { groupIds: ["G"] }),
      el("g2", "text", 20, 80, 120, 25, { groupIds: ["G"], text: "caption", fontSize: 20 }),
      rect("n", 40, 20),
    ]);
    const offset = () => [
      s.resolve("g2").x - s.resolve("g1").x,
      s.resolve("g2").y - s.resolve("g1").y,
    ];
    const before = offset();
    s.tidy();
    expect(offset()).toEqual(before);
    expect(layoutReport(s).blockOverlaps).toBe(0);
  });

  it("leaves a group of sketch lines alone", () => {
    const s = new Scene([
      rect("n", 0, 0),
      arrow("l1", [10, 10], [100, 60], { type: "line", groupIds: ["G"] }),
      arrow("l2", [100, 60], [10, 60], { type: "line", groupIds: ["G"] }),
    ]);
    s.tidy();
    expect(s.changedElements()).toEqual([]);
  });
});

describe("tidy: even spacing", () => {
  it("evens out a row whose gaps are roughly even, keeping the ends", () => {
    const s = new Scene([rect("a", 0, 0), rect("b", 200, 0), rect("c", 470, 0)]);
    expect(s.tidy().spaced).toBe(1);
    expect([s.resolve("a").x, s.resolve("b").x, s.resolve("c").x]).toEqual([0, 235, 470]);
    expect(idempotent(s)).toBe(0);
  });

  it("leaves a deliberate big gap alone", () => {
    const s = new Scene([rect("a", 0, 0), rect("b", 200, 0), rect("c", 760, 0)]);
    expect(s.tidy().spaced).toBe(0);
  });

  it("does not pull a node out of its column", () => {
    const s = new Scene([
      rect("a", 0, 0),
      rect("b", 200, 0),
      rect("c", 470, 0),
      rect("d", 200, 300),
    ]);
    s.tidy();
    expect(s.resolve("b").x).toBe(200);
  });
});

describe("tidy: overlap removal", () => {
  // B overlaps A by 30px vertically and 60px sideways, so the cheaper axis is vertical.
  const pair = () => new Scene([rect("A", 0, 0), rect("B", 100, 40)]);
  const pos = (s: Scene, id: string) => ({ x: s.resolve(id).x, y: s.resolve(id).y });

  it("splits the shortest push between both blocks, keeping their order", () => {
    const s = pair();
    expect(s.tidy().separated).toBe(2);
    expect(pos(s, "A")).toEqual({ x: 0, y: -27 });
    expect(pos(s, "B")).toEqual({ x: 100, y: 67 });
    expect(idempotent(s)).toBe(0);
  });

  it("moves what was just added or edited more than what was already there", () => {
    const s = pair();
    s.mutate(s.resolve("B"), { strokeColor: "#000" }); // B is part of this batch
    s.tidy();
    expect(pos(s, "A")).toEqual({ x: 0, y: -5 });
    expect(pos(s, "B")).toEqual({ x: 100, y: 89 });
  });

  it("separates and aligns in one solve, without snapping into a collision", () => {
    // C sits 10px below B's row and overlaps it; lining it up must still keep them apart.
    const s = new Scene([rect("A", 0, 0), rect("B", 400, 0), rect("C", 470, 10)]);
    s.tidy();
    expect(layoutReport(s).blockOverlaps).toBe(0);
    const [a, b, c] = ["A", "B", "C"].map((id) => s.resolve(id));
    expect(new Set([a.y, b.y, c.y]).size).toBe(1);
    expect(b.x + b.width + 24).toBeLessThanOrEqual(c.x);
    expect(idempotent(s)).toBe(0);
  });
});

describe("tidy: a real architecture frame", () => {
  // "Dispatch architecture" from a practice diagram: before orthogonal routing, its arrows
  // crossed each other, cut through captions and ran at angles, and two labels collided.
  const fixture = () => new Scene(DISPATCH_ARCHITECTURE);

  it("routes every connection at right angles, clear of captions, with readable labels", () => {
    const s = fixture();
    const before = layoutReport(s);
    expect(before).toMatchObject({
      arrowCrossings: 6,
      throughText: 4,
      diagonal: 24,
      labelClashes: 2,
    });
    s.tidy();
    const after = layoutReport(s);
    expect(after).toMatchObject({ throughText: 0, diagonal: 0, crossings: 0 });
    expect(after.arrowCrossings).toBeLessThanOrEqual(3);
    // ETA worker and Progress log sit too close for both of their labels to fit side by side.
    expect(after.labelClashes).toBeLessThanOrEqual(1);
    expect(idempotent(s)).toBe(0);
  });
});

describe("tidy: no regressions", () => {
  // A seeded messy diagram: four frames of jittered nodes with random links, bent routes and
  // frames that have to move. It reproduced a second pass rerouting bent arrows.
  function messy(n: number) {
    let r = 7;
    const rand = () => (r = (r * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const ops: Op[] = [];
    for (let f = 0; f < 4; f++) ops.push({ op: "add_frame", ref: `f${f}`, name: `F${f}` });
    for (let i = 0; i < n; i++)
      ops.push({
        op: "add_node",
        ref: `n${i}`,
        label: `Node ${i}`,
        frame: `f${i % 4}`,
        place: { at: { x: (i % 4) * 3000 + (i % 10) * 200, y: Math.floor(i / 10) * 150 } },
      });
    for (let i = 0; i < n * 1.5; i++) {
      const a = Math.floor(rand() * n);
      const b = Math.floor(rand() * n);
      if (a !== b && a % 4 === b % 4) ops.push({ op: "connect", from: `n${a}`, to: `n${b}` });
    }
    const s = new Scene([]);
    expect(s.apply(ops, "template").every((x) => x.ok)).toBe(true);
    return new Scene(
      s.live().map((e) =>
        s.isNode(e)
          ? {
              ...e,
              x: e.x + Math.round(rand() * 120 - 60),
              y: e.y + Math.round(rand() * 80 - 40),
            }
          : e,
      ),
    );
  }

  const cases: Case[] = [
    ["messy 60", () => messy(60)],
    ["messy 120", () => messy(120)],
    ...BUILTIN_TEMPLATES.map((t): Case => [
      `template ${t.id}`,
      () => {
        const s = new Scene([]);
        s.apply(t.ops, "template");
        return new Scene(s.live());
      },
    ]),
  ];

  it.each(cases)("%s: tidy makes nothing worse and a second pass changes nothing", (_, make) => {
    const s = make();
    const before = layoutReport(s);
    s.tidy();
    const after = layoutReport(s);
    for (const k of [
      "brokenArrows",
      "crossings",
      "arrowCrossings",
      "throughText",
      "diagonal",
      "labelClashes",
      "blockOverlaps",
      "frameOverlaps",
      "outsideFrame",
    ] as const)
      expect(after[k], k).toBeLessThanOrEqual(before[k]);
    expect(idempotent(s)).toBe(0);
  });
});
