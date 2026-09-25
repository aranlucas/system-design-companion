// Semantic ops: every MCP apply_patch variant, target resolution, authorship.
import { describe, expect, it } from "vitest";
import { AGENT_STROKE } from "../src/shared/protocol.ts";
import { COMPONENTS } from "../src/shared/components.ts";
import { Scene, type Author, type Op } from "../src/worker/scene.ts";

function fresh(): Scene {
  return new Scene([]);
}

function applyOk(s: Scene, ops: Op[], author: Author = "agent") {
  const res = s.apply(ops, author);
  expect(res.every((r) => r.ok)).toBe(true);
  return res;
}

function graph(s: Scene) {
  return s.graph();
}

describe("add_node", () => {
  it("creates a labelled rectangle with defaults", () => {
    const s = fresh();
    const [r] = applyOk(s, [{ op: "add_node", label: "API Service" }]);
    const g = graph(s);
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0].label).toBe("API Service");
    expect(g.nodes[0].shape).toBe("rectangle");
    expect(r.id).toBe(g.nodes[0].id);
  });

  it("resolves kind to label/shape/fill", () => {
    const s = fresh();
    applyOk(s, [{ op: "add_node", kind: "sql_db" }]);
    const g = graph(s);
    expect(g.nodes[0].label).toBe("SQL DB");
    expect(g.nodes[0].shape).toBe("rectangle");
    expect(g.nodes[0].icon).toBe("database");
    expect(g.nodes[0].color).toBe("green");
  });

  it("binds arrows to the visible icon, not a wide caption container", () => {
    const s = fresh();
    applyOk(s, [
      {
        op: "add_node",
        kind: "service",
        label: "Telemetry ingestion Validate dedupe write",
        ref: "a",
        place: { at: { x: 0, y: 0 } },
      },
      { op: "add_node", kind: "database", ref: "b", place: { at: { x: 1000, y: 0 } } },
      { op: "connect", from: "a", to: "b" },
    ]);
    const root = s.resolve("a");
    const art = s
      .live()
      .filter((e) => e.customData?.componentPart && e.groupIds.includes(root.groupIds[0]));
    const right = Math.max(
      ...art.map(
        (e) =>
          e.x + (e.type === "line" ? Math.max(...e.points.map((p: number[]) => p[0])) : e.width),
      ),
    );
    const arrow = s.live().find((e) => e.type === "arrow")!;
    expect(arrow.x).toBeLessThanOrEqual(right + 10);
    expect(root.width).toBeLessThanOrEqual(84);
    expect(s.boundText(root)?.containerId).toBeNull();
    const width = root.width;
    applyOk(s, [
      {
        op: "update",
        target: "a",
        label: "A much longer caption describing validation, deduplication, and durable writes",
      },
    ]);
    expect(root.width).toBe(width);
    expect(s.boundText(root)?.text).toContain("\n");
  });

  it("rejects unknown kinds and missing labels", () => {
    const s = fresh();
    const res = s.apply([{ op: "add_node", kind: "nonsense" }, { op: "add_node" } as Op], "agent");
    expect(res[0].ok).toBe(false);
    expect(res[0].error).toMatch("unknown kind");
    expect(res[1].ok).toBe(false);
    expect(res[1].error).toMatch("needs a label");
    expect(graph(s).nodes ?? []).toHaveLength(0);
  });

  it("treats every built-in icon as one semantic node", () => {
    for (const component of COMPONENTS.filter((c) => c.icon)) {
      const s = fresh();
      applyOk(s, [{ op: "add_node", kind: component.kind }]);
      expect(graph(s).nodes).toHaveLength(1);
      expect(graph(s).edges).toHaveLength(0);
      expect(graph(s).notes).toHaveLength(0);
      expect(s.live().some((e) => e.customData?.componentPart)).toBe(true);
    }
  });

  it("moves, resizes, connects, tidies and removes an icon together with its artwork", () => {
    const s = fresh();
    applyOk(s, [
      { op: "add_frame", name: "Design", ref: "f" },
      { op: "add_node", kind: "database", ref: "db", frame: "f" },
      { op: "add_node", kind: "server", ref: "api", frame: "f", place: { right_of: "db" } },
      { op: "connect", from: "api", to: "db" },
    ]);
    const root = s.resolve("db");
    const parts = s
      .live()
      .filter((e) => e.customData?.componentPart && e.groupIds.includes(root.groupIds[0]));
    const previous = { x: root.x, y: root.y, w: root.width, h: root.height };
    const positions = parts.map((p) => ({ x: p.x, y: p.y }));
    applyOk(s, [
      { op: "update", target: "db", width: 300, height: 200, move: { at: { x: 700, y: 500 } } },
    ]);
    parts.forEach((part, i) => {
      expect(part.x).toBeCloseTo(
        root.x + ((positions[i].x - previous.x) * root.width) / previous.w,
      );
      expect(part.y).toBeCloseTo(
        root.y + ((positions[i].y - previous.y) * root.height) / previous.h,
      );
    });
    s.tidy();
    expect(graph(s).nodes).toHaveLength(2);
    expect(graph(s).edges).toHaveLength(1);
    applyOk(s, [{ op: "update", target: "db", label: "Route history", color: "blue" }]);
    expect(graph(s).nodes.find((n) => n.id === root.id)?.color).toBe("blue");
    applyOk(s, [{ op: "remove", target: "Route history" }]);
    expect(parts.every((part) => part.isDeleted)).toBe(true);
  });

  it("tags agent elements violet, human elements neutral", () => {
    const agent = fresh();
    applyOk(agent, [{ op: "add_node", label: "A" }], "agent");
    const aEl = agent.live()[0];
    expect(aEl.strokeColor).toBe(AGENT_STROKE);
    expect(aEl.customData.author).toBe("agent");

    const human = fresh();
    applyOk(human, [{ op: "add_node", label: "A" }], "human");
    const hEl = human.live()[0];
    expect(hEl.strokeColor).toBe("#1e1e1e");
    expect(hEl.customData.author).toBe("human");
  });

  it("marks agent edits of human nodes without stealing authorship", () => {
    const s = fresh();
    applyOk(s, [{ op: "add_node", label: "DB" }], "human");
    applyOk(s, [{ op: "update", target: "DB", label: "DB v2" }], "agent");
    const el = s.live().find((e) => e.type !== "text")!;
    expect(el.customData.author).toBe("human");
    expect(el.customData.editedBy).toBe("agent");
  });
});

describe("connect / disconnect", () => {
  it("binds an arrow between two nodes", () => {
    const s = fresh();
    applyOk(s, [
      { op: "add_node", ref: "a", label: "Client" },
      { op: "add_node", ref: "b", label: "API" },
      { op: "connect", from: "a", to: "b", label: "HTTPS" },
    ]);
    const g = graph(s);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].from).toBe("Client");
    expect(g.edges[0].to).toBe("API");
    expect(g.edges[0].label).toBe("HTTPS");
    const arrow = s.live().find((e) => e.type === "arrow")!;
    expect(arrow.startBinding.elementId).toBe(g.nodes[0].id);
    expect(arrow.endBinding.elementId).toBe(g.nodes[1].id);
  });

  it("supports dashed and bidirectional arrows", () => {
    const s = fresh();
    applyOk(s, [
      { op: "add_node", ref: "a", label: "A" },
      { op: "add_node", ref: "b", label: "B" },
      { op: "connect", from: "a", to: "b", dashed: true, bidirectional: true },
    ]);
    const g = graph(s);
    expect(g.edges[0].dashed).toBe(true);
    expect(g.edges[0].both).toBe(true);
  });

  it("rejects self-connections and unknown endpoints", () => {
    const s = fresh();
    const res = s.apply(
      [
        { op: "add_node", ref: "a", label: "A" },
        { op: "connect", from: "a", to: "a" },
        { op: "connect", from: "a", to: "ghost" },
      ],
      "agent",
    );
    expect(res[1].ok).toBe(false);
    expect(res[1].error).toMatch("itself");
    expect(res[2].ok).toBe(false);
    expect(res[2].error).toMatch("no element");
  });

  it("disconnect removes the arrow; repeat disconnect errors", () => {
    const s = fresh();
    applyOk(s, [
      { op: "add_node", ref: "a", label: "A" },
      { op: "add_node", ref: "b", label: "B" },
      { op: "connect", from: "a", to: "b" },
      { op: "disconnect", from: "a", to: "b" },
    ]);
    expect(graph(s).edges ?? []).toHaveLength(0);
    const again = s.apply([{ op: "disconnect", from: "a", to: "b" }], "agent");
    expect(again[0].ok).toBe(false);
    expect(again[0].error).toMatch("no arrow");
  });
});

describe("update / remove", () => {
  it("renames, recolors and reshapes", () => {
    const s = fresh();
    applyOk(s, [{ op: "add_node", ref: "a", label: "A" }]);
    applyOk(s, [{ op: "update", target: "a", label: "B", color: "blue", shape: "ellipse" }]);
    const g = graph(s);
    expect(g.nodes[0].label).toBe("B");
    expect(g.nodes[0].color).toBe("blue");
    expect(g.nodes[0].shape).toBe("ellipse");
  });

  it("renames frames by name", () => {
    const s = fresh();
    applyOk(s, [{ op: "add_frame", ref: "f", name: "Old" }]);
    applyOk(s, [{ op: "update", target: "f", label: "New" }]);
    expect(graph(s).frames[0].name).toBe("New");
  });

  it("removing a node cascades to its arrows", () => {
    const s = fresh();
    applyOk(s, [
      { op: "add_node", ref: "a", label: "A" },
      { op: "add_node", ref: "b", label: "B" },
      { op: "connect", from: "a", to: "b" },
      { op: "remove", target: "a" },
    ]);
    const g = graph(s);
    expect(g.nodes.map((n) => n.label)).toEqual(["B"]);
    expect(g.edges ?? []).toHaveLength(0);
  });

  it("removing a frame releases its children", () => {
    const s = fresh();
    applyOk(s, [
      { op: "add_frame", ref: "f", name: "F" },
      { op: "add_node", ref: "a", label: "A", frame: "f" },
      { op: "remove", target: "f" },
    ]);
    const g = graph(s);
    expect(g.frames ?? []).toHaveLength(0);
    expect(g.nodes[0].frame).toBeUndefined();
  });
});

describe("add_frame / add_note", () => {
  it("wraps listed nodes in a frame", () => {
    const s = fresh();
    applyOk(s, [
      { op: "add_node", ref: "a", label: "A" },
      { op: "add_node", ref: "b", label: "B" },
      { op: "add_frame", ref: "f", name: "Scope", contains: ["a", "b"] },
    ]);
    const g = graph(s);
    expect(g.frames).toHaveLength(1);
    expect(g.nodes.every((n) => n.frame === "Scope")).toBe(true);
  });

  it("adds a sticky note whose label wraps inside it and grows it", () => {
    const s = fresh();
    const long = `word `.repeat(30).trim();
    const [r] = applyOk(s, [{ op: "add_note", text: long }]);
    const note = s.resolve(r.id!);
    expect(note).toMatchObject({ type: "stickynote", strokeColor: AGENT_STROKE });
    expect(note.created).toEqual(expect.any(Number));
    expect(note.baseHeight).toBeLessThanOrEqual(note.height);
    const label = s.boundText(note)!;
    expect(label).toMatchObject({ containerId: note.id, originalText: long, baseFontSize: 20 });
    expect(label.text).toContain("\n");
    for (const line of label.text.split("\n")) expect(line.length).toBeLessThanOrEqual(28);
    // The label sits inside the note, clear of the date footer.
    expect(label.x).toBeGreaterThanOrEqual(note.x + 16);
    expect(label.x + label.width).toBeLessThanOrEqual(note.x + note.width - 16);
    expect(label.y + label.height).toBeLessThanOrEqual(note.y + note.height - 36);
    // The agent reads back what it wrote, not the wrapped label.
    expect(graph(s).notes[0]).toMatchObject({ id: note.id, text: long, sticky: true });
  });

  it("relabels a sticky note and keeps its label with it when tidied", () => {
    const s = fresh();
    applyOk(s, [
      { op: "add_note", ref: "n", text: "short", place: { at: { x: 0, y: 0 } } },
      { op: "update", target: "n", label: `longer `.repeat(20).trim() },
    ]);
    const note = s.resolve("n");
    const label = s.boundText(note)!;
    expect(label.originalText).toBe(`longer `.repeat(20).trim());
    expect(label.y + label.height).toBeLessThanOrEqual(note.y + note.height - 36);
    expect(s.resolve("longer ".repeat(20).trim()).id).toBe(note.id);

    // A node drawn over the note's corner (bypassing placement). Tidy moves the later block in
    // reading order, here the note, and its label must come along.
    applyOk(s, [{ op: "add_node", ref: "b", label: "Box", place: { at: { x: 600, y: 0 } } }]);
    const box = s.resolve("b");
    const s2 = new Scene(
      s.live().map((e) => (e.id === box.id ? { ...e, x: note.x - 10, y: note.y - 10 } : e)),
    );
    const before = { ...s2.resolve(note.id) };
    const offset = { x: label.x - note.x, y: label.y - note.y };
    expect(s2.tidy().separated).toBeGreaterThan(0);
    const moved = s2.resolve(note.id);
    expect(moved.x !== before.x || moved.y !== before.y).toBe(true);
    const after = s2.boundText(moved)!;
    expect({ x: after.x - moved.x, y: after.y - moved.y }).toEqual(offset);
  });

  it("still reports free text as a note", () => {
    const s = new Scene([]);
    applyOk(s, [{ op: "add_node", label: "A" }]);
    const text = { ...s.boundText(s.resolve("A"))!, id: "t1", containerId: null, text: "loose" };
    const s2 = new Scene([...s.live(), text]);
    expect(graph(s2).notes).toEqual([expect.objectContaining({ id: "t1", text: "loose" })]);
    expect(graph(s2).notes[0]).not.toHaveProperty("sticky");
  });

  it("inherits the anchor frame for notes placed near framed nodes", () => {
    const s = fresh();
    applyOk(s, [
      { op: "add_frame", ref: "f", name: "HLD" },
      { op: "add_node", ref: "a", label: "A", frame: "f" },
      { op: "add_note", text: "hi", place: { near: "a" } },
    ]);
    expect(graph(s).notes[0].frame).toBe("HLD");
  });
});

describe("text_color", () => {
  const textOf = (s: Scene, id: string) =>
    s.live().find((e) => e.type === "text" && (e.id === id || e.containerId === id));

  it("colors node, arrow and note text by name or hex, and reports it", () => {
    const s = fresh();
    const [a, , arrow, note] = applyOk(s, [
      { op: "add_node", ref: "a", label: "A", text_color: "red" },
      { op: "add_node", ref: "b", label: "B" },
      { op: "connect", from: "a", to: "b", label: "writes", text_color: "#123456" },
      { op: "add_note", text: "Hot path", text_color: "blue" },
    ]);
    expect(textOf(s, a.id!)?.strokeColor).toBe("#e03131");
    expect(textOf(s, arrow.id!)?.strokeColor).toBe("#123456");
    expect(textOf(s, note.id!)?.strokeColor).toBe("#1971c2");
    // Only the text changes, not the shape's outline.
    expect(s.resolve("a").strokeColor).toBe(AGENT_STROKE);

    const g = graph(s);
    expect(g.nodes.find((n) => n.label === "A")?.text_color).toBe("red");
    expect(g.nodes.find((n) => n.label === "B")).not.toHaveProperty("text_color");
    expect(g.edges[0].text_color).toBe("#123456");
    expect(g.notes[0]).toMatchObject({ text: "Hot path", text_color: "blue" });
  });

  it("recolors a component caption, a note and an arrow label with update", () => {
    const s = fresh();
    const [db, , , note] = applyOk(s, [
      { op: "add_node", ref: "db", kind: "sql_db" },
      { op: "add_node", ref: "api", label: "API" },
      { op: "connect", from: "api", to: "db", label: "reads" },
      { op: "add_note", ref: "n", text: "Note" },
    ]);
    applyOk(s, [
      { op: "update", target: "db", text_color: "green" },
      { op: "update", target: "n", text_color: "orange" },
      { op: "update", target: db.id!, label: "Orders DB" },
    ]);
    const g = graph(s);
    expect(g.nodes.find((n) => n.label === "Orders DB")?.text_color).toBe("green");
    expect(textOf(s, note.id!)?.strokeColor).toBe("#e8590c");
    // A sticky note's ink is one color: the note follows its label.
    expect(s.resolve(note.id!).strokeColor).toBe("#e8590c");
  });

  it("fails when there is no text to color", () => {
    const s = fresh();
    applyOk(s, [
      { op: "add_node", ref: "a", label: "A" },
      { op: "add_node", ref: "b", label: "B" },
    ]);
    const [r] = s.apply([{ op: "connect", from: "a", to: "b", text_color: "red" }], "agent");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch("text_color");
  });
});

describe("target resolution", () => {
  it("resolves ids, refs and case-insensitive labels", () => {
    const s = fresh();
    const [r] = applyOk(s, [
      { op: "add_node", ref: "api", label: "API Service" },
      { op: "update", target: "api service", label: "API Service v2" },
    ]);
    expect(graph(s).nodes[0].label).toBe("API Service v2");
    expect(s.resolve(r.id!).id).toBe(r.id);
  });

  it("rejects ambiguous labels and suggests ids", () => {
    const s = fresh();
    applyOk(s, [
      { op: "add_node", label: "API" },
      { op: "add_node", label: "API" },
    ]);
    const res = s.apply([{ op: "remove", target: "API" }], "agent");
    expect(res[0].ok).toBe(false);
    expect(res[0].error).toMatch("ambiguous");
  });

  it("continues the batch after a failed op", () => {
    const s = fresh();
    const res = s.apply(
      [
        { op: "add_node", ref: "good", label: "Good" },
        { op: "connect", from: "good", to: "missing" },
        { op: "add_node", label: "Also good" },
      ],
      "agent",
    );
    expect(res.map((r) => r.ok)).toEqual([true, false, true]);
    expect(graph(s).nodes).toHaveLength(2);
  });
});

describe("sync invariants", () => {
  it("keeps z-order indices strictly increasing", () => {
    const s = fresh();
    applyOk(s, [
      { op: "add_node", ref: "a", label: "A" },
      { op: "add_node", ref: "b", label: "B" },
      { op: "connect", from: "a", to: "b" },
      { op: "add_note", text: "n" },
    ]);
    const live = s.live();
    expect(live.every((e, i, a) => i === 0 || (a[i - 1].index ?? "") < (e.index ?? ""))).toBe(true);
  });

  it("bumps versions on mutate and tracks changed elements", () => {
    const s = fresh();
    const [r] = applyOk(s, [{ op: "add_node", label: "A" }]);
    const el = s.resolve(r.id!);
    const v = el.version;
    s.mutate(el, { x: el.x + 5 });
    expect(el.version).toBe(v + 1);
    expect(s.changedElements().map((e) => e.id)).toContain(el.id);
  });

  it("keeps bound labels above their container", () => {
    const s = fresh();
    applyOk(s, [{ op: "add_node", ref: "a", label: "A" }]);
    const node = s.resolve("a");
    const label = s.boundText(node)!;
    s.changedElements(); // runs fixLabelOrder
    expect(label.index! > node.index!).toBe(true);
  });
});
