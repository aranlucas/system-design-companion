import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  isCreatedDiagram,
  isApiFailure,
  isBrowserSession,
  isTemplateList,
  isDiagramPage,
  isLibrary,
  assertBoundary,
} from "../src/app/validation.ts";
import { apiErrorMessage } from "../src/app/api-error.ts";

const created = { id: "d", key: "k", name: "Diagram" };

describe("small home-route validation boundaries", () => {
  it("preserves valid values and rejects malformed response and local-storage fields", () => {
    assertBoundary(created, isCreatedDiagram);
    expect(created.id).toBe("d");
    expect(isBrowserSession({ signedIn: false })).toBe(true);
    expect(isBrowserSession({ signedIn: "false" })).toBe(false);
    expect(isTemplateList([{ id: "t", name: "Template", description: "" }])).toBe(true);
    expect(isTemplateList([{ id: "t", name: "Template" }])).toBe(false);
    expect(isDiagramPage({ items: [{ ...created, createdAt: 1 }], nextCursor: null })).toBe(true);
    expect(isDiagramPage({ items: [{ ...created, createdAt: "1" }], nextCursor: null })).toBe(
      false,
    );
    expect(isLibrary([{ ...created, openedAt: 1 }])).toBe(true);
    expect(isLibrary([{ ...created, openedAt: Infinity }])).toBe(false);
    expect(() => assertBoundary({ ...created, key: null }, isCreatedDiagram)).toThrow(TypeError);
  });
  it("matches the schema contracts for generated JSON edge cases", () => {
    const entry = z.object({ id: z.string(), key: z.string(), name: z.string() });

    const entryValues = [
      null,
      false,
      0,
      "",
      [],
      {},
      created,
      { ...created, key: 0 },
      { ...created, name: null },
      { ...created, extra: { nested: true } },
    ];

    for (const value of entryValues)
      expect(isCreatedDiagram(value)).toBe(entry.safeParse(value).success);

    const page = z.object({
      items: z.array(entry.extend({ createdAt: z.number() })),
      nextCursor: z.string().nullable(),
    });

    for (const items of [null, [], [created], [{ ...created, createdAt: 0 }]]) {
      for (const nextCursor of [null, "", false, 0, undefined]) {
        const value = { items, nextCursor };
        expect(isDiagramPage(value)).toBe(page.safeParse(value).success);
      }
    }
  });
  it("retains error text, structured issues, fallback behavior and extra response metadata", () => {
    const payload = {
      success: false,
      error: { name: "ZodError", message: JSON.stringify([{ message: "Required" }]) },
    };

    expect(isApiFailure(payload)).toBe(true);
    expect(apiErrorMessage(payload, "Fallback")).toBe("Required");
    expect(apiErrorMessage({ error: "Server message" }, "Fallback")).toBe("Server message");
    expect(apiErrorMessage({ error: { message: "invalid JSON" } }, "Fallback")).toBe("Fallback");
    expect(apiErrorMessage({ error: "" }, "Fallback")).toBe("Fallback");
  });
});
