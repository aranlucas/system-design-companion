// Capability links, diagram lifecycle (store.ts), component catalog, rubric.
import { describe, expect, it } from "vitest";
import { AGENT_STROKE } from "../src/shared/protocol.ts";
import { COLORS } from "../src/worker/scene.ts";
import { RUBRIC } from "../src/worker/rubric.ts";
import {
  createDiagram,
  listTemplates,
  parseLink,
  saveAsTemplate,
  shareLink,
  verifyKey,
} from "../src/worker/store.ts";
import { COMPONENTS, COMPONENT_KINDS, componentByKind } from "../src/shared/components.ts";
import { makeEnv } from "./helpers/fakes.ts";

describe("parseLink / shareLink", () => {
  it("parses full share links", () => {
    expect(parseLink("https://foo.workers.dev/d/abcDEFGH?k=key-123_456")).toEqual({
      id: "abcDEFGH",
      key: "key-123_456",
    });
  });

  it("parses paths, bare pairs and links with extra params", () => {
    expect(parseLink("/d/abcDEFGH?k=secret1")).toEqual({ id: "abcDEFGH", key: "secret1" });
    expect(parseLink("abcDEFGH?k=secret1")).toEqual({ id: "abcDEFGH", key: "secret1" });
    expect(parseLink("/d/abcDEFGH?foo=1&k=secret1")).toEqual({ id: "abcDEFGH", key: "secret1" });
  });

  it("rejects garbage, short ids and missing keys", () => {
    expect(parseLink("hello")).toBeNull();
    expect(parseLink("abc?k=secret1")).toBeNull();
    expect(parseLink("/d/abcDEFGH")).toBeNull();
    expect(parseLink("/d/abcDEFGH?k=")).toBeNull();
  });

  it("round-trips through shareLink", () => {
    const link = shareLink("http://localhost:5173", "abcDEFGH", "secret1");
    expect(link).toBe("http://localhost:5173/d/abcDEFGH?k=secret1");
    expect(parseLink(link)).toEqual({ id: "abcDEFGH", key: "secret1" });
  });
});

describe("diagram lifecycle (store.ts + real rooms on fake bindings)", () => {
  it("creates, verifies and rejects keys", async () => {
    const { env } = makeEnv();
    const d = await createDiagram(env, "HLD");
    expect(d.id).toHaveLength(21);
    expect(d.key).toHaveLength(42);
    const row = await verifyKey(env, d.id, d.key);
    expect(row?.name).toBe("HLD");
    expect(await verifyKey(env, d.id, "wrong")).toBeNull();
    expect(await verifyKey(env, d.id, null)).toBeNull();
    expect(await verifyKey(env, "nope-nope-nope", d.key)).toBeNull();
  });

  it("creates from a builtin template through the room", async () => {
    const { env, rooms } = makeEnv();
    const d = await createDiagram(env, "Web", "builtin:web-baseline");
    const g = await rooms.get(d.id)!.getGraph();
    expect(g.nodes).toHaveLength(9);
    expect(g.edges).toHaveLength(8);
  });

  it("rejects unknown templates", async () => {
    const { env } = makeEnv();
    await expect(createDiagram(env, "X", "builtin:nope")).rejects.toThrow("unknown template");
  });

  it("saves and reuses custom templates", async () => {
    const { env, rooms } = makeEnv();
    const d = await createDiagram(env, "Src", "builtin:read-heavy");
    const tpl = await saveAsTemplate(env, d.id, "My shape", "desc");
    expect(tpl.id.startsWith("tpl")).toBe(true);
    const listed = await listTemplates(env);
    expect(listed.some((t) => t.id === tpl.id && t.name === "My shape")).toBe(true);
    expect(listed.some((t) => t.id === "builtin:interview")).toBe(true);

    const d2 = await createDiagram(env, "Copy", tpl.id);
    const g = await rooms.get(d2.id)!.getGraph();
    expect(g.nodes).toHaveLength(6);
    expect(g.edges).toHaveLength(5);
  });
});

describe("component catalog", () => {
  it("has unique kinds with valid shapes and groups", () => {
    const kinds = COMPONENTS.map((c) => c.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(COMPONENT_KINDS).toHaveLength(COMPONENTS.length);
    const groups = new Set(["Clients", "Edge", "Compute", "Data", "Messaging", "External"]);
    for (const c of COMPONENTS) {
      expect(["rectangle", "ellipse", "diamond"]).toContain(c.shape);
      expect(groups.has(c.group)).toBe(true);
      expect(componentByKind.get(c.kind)?.label).toBe(c.label);
    }
  });

  it("encodes roles by fill colour", () => {
    expect(componentByKind.get("cache")?.fill).toBe("#ffc9c9");
    expect(componentByKind.get("sql_db")?.fill).toBe("#b2f2bb");
  });
});

describe("rubric", () => {
  it("covers the ten interview dimensions", () => {
    const items = RUBRIC.match(/^\d+\. /gm);
    expect(items).toHaveLength(10);
    for (const word of ["Requirements", "Estimates", "Trade-offs"]) expect(RUBRIC).toContain(word);
  });

  it("keeps agent stroke distinct from the violet fill", () => {
    expect(AGENT_STROKE).toBe("#6741d9");
    expect(COLORS.violet).toBe("#d0bfff");
    expect(AGENT_STROKE).not.toBe(COLORS.violet);
  });
});
