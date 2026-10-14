import { expect, test } from "vitest";
import { Scene, graphView } from "../src/worker/scene.ts";
import { requiredTestValue } from "./helpers/required-test-value.ts";

test("scene smoke preserves references, layout, removals, and element order", () => {
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
      {
        op: "add_node",
        ref: "api",
        label: "API Service",
        place: { right_of: "lb" },
        color: "blue",
      },
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

  expect(r.filter((result) => !result.ok)).toEqual([
    {
      i: 9,
      op: "connect",
      ok: false,
      error: 'no element "nope" (use an id, a unique label, or a ref from this batch)',
    },
  ]);
  const before = graphView(s);

  expect(before.nodes).toHaveLength(4);
  expect(before.edges).toHaveLength(3);
  expect(before.notes).toHaveLength(1);
  expect(s.layout("LR", "hld")).toBe(4);
  expect(
    s.apply([{ op: "remove", target: "Postgres" }], "agent").every((result) => result.ok),
  ).toBe(true);

  const after = graphView(s);

  expect(after.edges).toHaveLength(2);
  expect(requiredTestValue(after.nodes).map((node) => node.label)).toEqual([
    "Client",
    "Load Balancer",
    "API Service (stateless)",
  ]);
  expect(s.changedElements()).toHaveLength(15);
  expect(
    s
      .live()
      .every(
        (element, index, all) =>
          index === 0 || requiredTestValue(all[index - 1].index) < requiredTestValue(element.index),
      ),
  ).toBe(true);
});
