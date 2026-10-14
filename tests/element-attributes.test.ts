import { describe, expect, test } from "vitest";
import { elementAttribute, requiredElementAttribute } from "../src/shared/element-attributes.ts";
import { storedElementSchema } from "../src/shared/schemas.ts";

const core = {
  id: "attribute-test",
  type: "frame",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
};

describe("typed reads of opaque Excalidraw extensions", () => {
  test("validates only the field being consumed and never narrows stored data", () => {
    const original = { ...core, name: "Frame", text: 42, futureExtension: { enabled: true } };
    const parsed = storedElementSchema.parse(original);

    expect(parsed).toBe(original);
    expect(elementAttribute(parsed, "name")).toBe("Frame");
    expect(() => elementAttribute(parsed, "text")).toThrow(/Invalid input/);
    expect(parsed).toEqual(original);
  });

  test("supports nullable frame names and readonly library arrays", () => {
    const original = { ...core, name: null, groupIds: Object.freeze(["group"]) };

    expect(elementAttribute(original, "name")).toBeNull();
    expect(elementAttribute(original, "groupIds")).toEqual(["group"]);
    expect(original.groupIds).toEqual(["group"]);
  });

  test("preserves opaque metadata identity and own keys when reading named fields", () => {
    const metadata: unknown = JSON.parse(
      '{"author":"agent","autoFit":"owned elsewhere","__proto__":{"foreign":true},"future":{"count":3}}',
    );

    const original = { ...core, customData: metadata };
    const result = requiredElementAttribute(original, "customData");

    expect(result).toBe(metadata);
    expect(result.author).toBe("agent");
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(JSON.stringify(result)).toBe(JSON.stringify(metadata));
  });

  test("validates bindings while retaining versioned binding fields", () => {
    const binding = { elementId: "target", fixedPoint: [0.5, 1], futureBinding: "preserved" };
    const original = { ...core, startBinding: binding };

    expect(requiredElementAttribute(original, "startBinding")).toBe(binding);
    expect(() =>
      elementAttribute({ ...core, startBinding: { elementId: 42 } }, "startBinding"),
    ).toThrow(/Invalid input/);
  });

  test("requires values only for operations that declare the field mandatory", () => {
    expect(elementAttribute(core, "fontSize")).toBeUndefined();
    expect(elementAttribute(undefined, "fontSize")).toBeUndefined();
    expect(() => requiredElementAttribute(core, "fontSize")).toThrow(
      "Missing fontSize on element attribute-test",
    );
    expect(requiredElementAttribute({ ...core, fontSize: 0 }, "fontSize")).toBe(0);
  });
});
