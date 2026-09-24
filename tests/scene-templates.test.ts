// Built-in templates: every starter layout applies cleanly and reads back correctly.
import { describe, expect, it } from "vitest";
import { BUILTIN_TEMPLATES } from "../src/worker/templates.ts";
import { Scene, graphView } from "../src/worker/scene.ts";

function applied(id: string): Scene {
  const t = BUILTIN_TEMPLATES.find((x) => x.id === id)!;
  expect(t).toBeDefined();
  const s = new Scene([]);
  const res = s.apply(t.ops, "template");
  expect(res.filter((r) => !r.ok)).toEqual([]);
  return s;
}

function counts(s: Scene) {
  const g = graphView(s) as {
    nodes?: unknown[];
    edges?: unknown[];
    frames?: unknown[];
    notes?: unknown[];
  };
  return {
    nodes: g.nodes?.length ?? 0,
    edges: g.edges?.length ?? 0,
    frames: g.frames?.length ?? 0,
    notes: g.notes?.length ?? 0,
  };
}

describe("builtin templates", () => {
  it("has unique ids with names and descriptions", () => {
    const ids = BUILTIN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it("interview framework: six frames with starter notes", () => {
    const c = counts(applied("builtin:interview"));
    expect(c.frames).toBe(6);
    expect(c.notes).toBe(5);
  });

  it("web baseline: client-to-storage path with cache and queue", () => {
    const s = applied("builtin:web-baseline");
    expect(counts(s)).toMatchObject({ nodes: 9, edges: 8 });
    const g = graphView(s) as { edges?: Array<{ from?: string; to?: string }> };
    const pairs = g.edges!.map((e) => `${e.from}->${e.to}`);
    expect(pairs).toContain("Client->CDN");
    expect(pairs).toContain("Client->Load Balancer");
  });

  it("read-heavy and realtime shapes", () => {
    expect(counts(applied("builtin:read-heavy"))).toMatchObject({ nodes: 6, edges: 5 });
    expect(counts(applied("builtin:realtime"))).toMatchObject({ nodes: 6, edges: 6 });
  });

  it("every template is tidy-stable on a second pass", () => {
    for (const t of BUILTIN_TEMPLATES) {
      const s = applied(t.id);
      s.tidy();
      const again = new Scene(structuredClone(s.live()));
      again.tidy();
      expect(again.changedElements()).toHaveLength(0);
    }
  });
});
