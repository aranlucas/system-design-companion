import { requiredTestValue } from "@test/helpers/required-test-value.ts";
// Capability links, diagram lifecycle (store.ts), component catalog.
import { describe, expect, it } from "vitest";
import {
  createDiagram,
  listTemplates,
  parseLink,
  saveAsTemplate,
  shareLink,
  verifyKey,
} from "@/worker/store.ts";
import { COMPONENTS } from "@/shared/components.ts";
import { makeEnv } from "@test/helpers/fakes.ts";

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

  it("saves and reuses custom templates", async () => {
    const { env, rooms } = makeEnv();
    const d = await createDiagram(env, "Src", "builtin:read-heavy", "github%3A1");
    const tpl = await saveAsTemplate(env, d.id, "My shape", "desc", "github%3A1");
    expect(tpl.id.startsWith("tpl")).toBe(true);
    const listed = await listTemplates(env, "github%3A1");
    expect(listed.some((t) => t.id === tpl.id && t.name === "My shape")).toBe(true);
    expect(listed.some((t) => t.id === "builtin:interview")).toBe(true);

    const d2 = await createDiagram(env, "Copy", tpl.id, "github%3A1");
    const g = await requiredTestValue(rooms.get(d2.id)).getGraph();
    expect(g.nodes).toHaveLength(6);
    expect(g.edges).toHaveLength(5);
  });
});

describe("component catalog", () => {
  it("has unique kinds", () => {
    const kinds = COMPONENTS.map((c) => c.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});
