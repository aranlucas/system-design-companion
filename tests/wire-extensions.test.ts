import { describe, expect, it } from "vitest";
import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
} from "@excalidraw/excalidraw/element/types";
import { storedElementSchema } from "../src/shared/schemas.ts";

const groupIds: ExcalidrawElement["groupIds"] = Object.freeze(["group"]);

const frameName: ExcalidrawFrameElement["name"] = null;

const core = {
  id: "extension-frame",
  type: "frame",
  x: 0,
  y: 0,
  width: 160,
  height: 80,
  version: 1,
  versionNonce: 3,
  isDeleted: false,
};

describe("versioned Excalidraw wire extensions", () => {
  it("round-trips opaque metadata, nullable library fields and readonly arrays without narrowing", () => {
    const runtime = {
      ...core,
      name: frameName,
      groupIds,
      points: Object.freeze([Object.freeze([0, 0]), Object.freeze([10, 20])]),
      customData: {
        autoFit: "another extension owns this value",
        nested: [null, { count: 2, optional: undefined }],
        stamp: new Date("2026-01-01T00:00:00Z"),
      },
      futureExtension: { enabled: true, payload: ["a", { value: null }] },
      omitted: undefined,
    };

    const serialized = JSON.stringify(runtime);
    const original: unknown = JSON.parse(serialized);
    expect(storedElementSchema.parse(original)).toEqual(original);
    expect(JSON.stringify(storedElementSchema.parse(original))).toBe(serialized);
    expect(Object.hasOwn(storedElementSchema.parse(original), "omitted")).toBe(false);
  });
  it("preserves extension identity and special own keys without prototype mutation", () => {
    const original: unknown = JSON.parse(
      `${JSON.stringify(core).slice(0, -1)},"__proto__":{"extension":true},"constructor":"wire","prototype":[1]}`,
    );

    const parsed = storedElementSchema.parse(original);
    expect(parsed).toBe(original);
    expect(Object.keys(parsed)).toContain("__proto__");
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(original));
  });
  it("validates the optional named index without narrowing extensions", () => {
    for (const index of [undefined, null, "a0"]) {
      const original = { ...core, index, futureExtension: { accepted: true } };
      expect(storedElementSchema.parse(original)).toBe(original);
    }

    expect(storedElementSchema.parse(core)).toBe(core);
    expect(() => storedElementSchema.parse({ ...core, index: 42 })).toThrow();
  });
  it("still rejects malformed core fields before opaque values are forwarded", () => {
    expect(() =>
      storedElementSchema.parse({ ...core, x: "not a coordinate", futureExtension: {} }),
    ).toThrow();
    expect(() => storedElementSchema.parse({ ...core, versionNonce: null })).toThrow();
  });
});
