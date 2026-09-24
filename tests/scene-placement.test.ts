// Placement hints, overlap nudging, frame inference and frame moves.
import { describe, expect, it } from "vitest";
import { Scene, type Op } from "../src/worker/scene.ts";

function build(ops: Op[]): Scene {
  const s = new Scene([]);
  const res = s.apply(ops, "agent");
  expect(res.every((r) => r.ok)).toBe(true);
  return s;
}

const box = (s: Scene, ref: string) => {
  const e = s.resolve(ref);
  return { x: e.x, y: e.y, w: e.width, h: e.height };
};

describe("placement hints", () => {
  it("right_of defaults to a 100px gap, vertically centered", () => {
    const s = build([
      { op: "add_node", ref: "a", label: "A" },
      { op: "add_node", ref: "b", label: "B", place: { right_of: "a" } },
    ]);
    const a = box(s, "a");
    const b = box(s, "b");
    expect(b.x).toBe(a.x + a.w + 100);
    expect(b.y).toBe(Math.round(a.y + (a.h - b.h) / 2));
  });

  it("honours custom gaps and all four directions", () => {
    const s = build([
      { op: "add_node", ref: "c", label: "C", place: { at: { x: 1000, y: 1000 } } },
      { op: "add_node", ref: "r", label: "R", place: { right_of: "c", gap: 200 } },
      { op: "add_node", ref: "l", label: "L", place: { left_of: "c", gap: 50 } },
      { op: "add_node", ref: "d", label: "D", place: { below: "c", gap: 30 } },
      { op: "add_node", ref: "u", label: "U", place: { above: "c", gap: 30 } },
    ]);
    const c = box(s, "c");
    expect(box(s, "r").x).toBe(c.x + c.w + 200);
    const l = box(s, "l");
    expect(l.x + l.w).toBe(c.x - 50);
    const d = box(s, "d");
    expect(d.y).toBe(c.y + c.h + 30);
    const u = box(s, "u");
    expect(u.y + u.h).toBe(c.y - 30);
  });

  it("places at absolute coordinates", () => {
    const s = build([{ op: "add_node", ref: "a", label: "A", place: { at: { x: 42, y: 77 } } }]);
    expect(box(s, "a").x).toBe(42);
    expect(box(s, "a").y).toBe(77);
  });

  it("near falls back to another side when the right is blocked", () => {
    const s = build([
      { op: "add_node", ref: "a", label: "A" },
      { op: "add_node", ref: "blocker", label: "X", place: { right_of: "a" } },
      { op: "add_node", ref: "c", label: "C", place: { near: "a" } },
    ]);
    const a = box(s, "a");
    const c = box(s, "c");
    // Right side is taken: must land below, left or above instead.
    expect(c.x !== a.x + a.w + 100 || c.y !== a.y).toBe(true);
  });

  it("chains bare nodes to the right of the last placed node", () => {
    const s = build([
      { op: "add_node", ref: "a", label: "A" },
      { op: "add_node", ref: "b", label: "B" },
    ]);
    const a = box(s, "a");
    expect(box(s, "b").x).toBe(a.x + a.w + 100);
  });

  it("nudges overlapping nodes apart", () => {
    const s = build([
      { op: "add_node", ref: "a", label: "A", place: { at: { x: 0, y: 0 } } },
      { op: "add_node", ref: "b", label: "B", place: { at: { x: 0, y: 0 } } },
    ]);
    const a = box(s, "a");
    const b = box(s, "b");
    expect(b.y).toBeGreaterThan(a.y);
    const overlap =
      b.x < a.x + a.w + 20 && a.x < b.x + b.w + 20 && b.y < a.y + a.h + 20 && a.y < b.y + b.h + 20;
    expect(overlap).toBe(false);
  });
});

describe("frames", () => {
  it("inherits the anchor frame for relatively placed nodes", () => {
    const s = build([
      { op: "add_frame", ref: "f", name: "HLD" },
      { op: "add_node", ref: "a", label: "A", frame: "f" },
      { op: "add_node", ref: "b", label: "B", place: { right_of: "a" } },
    ]);
    expect(s.resolve("b").frameId).toBe(s.resolve("f").id);
  });

  it("attaches nodes dropped inside a frame", () => {
    const s = build([
      {
        op: "add_frame",
        ref: "f",
        name: "F",
        place: { at: { x: 0, y: 0 } },
        width: 800,
        height: 500,
      },
      { op: "add_node", ref: "a", label: "A", place: { at: { x: 100, y: 100 } } },
    ]);
    expect(s.resolve("a").frameId).toBe(s.resolve("f").id);
  });

  it("grows a frame to enclose out-of-bounds children", () => {
    const s = build([
      {
        op: "add_frame",
        ref: "f",
        name: "F",
        place: { at: { x: 0, y: 0 } },
        width: 800,
        height: 500,
      },
      { op: "add_node", ref: "a", label: "A", frame: "f", place: { at: { x: 2000, y: 2000 } } },
    ]);
    const f = box(s, "f");
    expect(f.w).toBeGreaterThan(800);
    expect(f.h).toBeGreaterThan(500);
  });

  it("moves frame children with the frame", () => {
    const s = build([
      { op: "add_node", ref: "a", label: "A", place: { at: { x: 100, y: 100 } } },
      { op: "add_frame", ref: "f", name: "F", contains: ["a"] },
    ]);
    const f0 = box(s, "f");
    const a0 = box(s, "a");
    const res = s.apply(
      [{ op: "update", target: "f", move: { at: { x: 3000, y: 3000 } } }],
      "agent",
    );
    expect(res[0].ok).toBe(true);
    const f1 = box(s, "f");
    const a1 = box(s, "a");
    expect(a1.x - a0.x).toBe(f1.x - f0.x);
    expect(a1.y - a0.y).toBe(f1.y - f0.y);
  });

  it("pulls nodes inside when assigned to a frame from outside", () => {
    const s = build([
      {
        op: "add_frame",
        ref: "f",
        name: "F",
        place: { at: { x: 0, y: 0 } },
        width: 2000,
        height: 2000,
      },
      { op: "add_node", ref: "a", label: "A", place: { at: { x: 9000, y: 9000 } } },
    ]);
    const res = s.apply([{ op: "update", target: "a", frame: "f" }], "agent");
    expect(res[0].ok).toBe(true);
    const f = box(s, "f");
    const a = box(s, "a");
    expect(s.resolve("a").frameId).toBe(s.resolve("f").id);
    expect(a.x).toBeGreaterThanOrEqual(f.x);
    expect(a.y).toBeGreaterThanOrEqual(f.y);
    expect(a.x + a.w).toBeLessThanOrEqual(f.x + f.w);
    expect(a.y + a.h).toBeLessThanOrEqual(f.y + f.h);
  });
});
