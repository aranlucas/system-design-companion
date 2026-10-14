import { describe, expect, it } from "vitest";
import { requiredValue } from "@/shared/required-value.ts";

describe("requiredValue", () => {
  it.each([null, undefined])("rejects missing %s with its context", (value) => {
    expect(() => requiredValue(value, "active board")).toThrow(
      "Missing required value: active board",
    );
  });
  it("preserves falsy values and object identity", () => {
    expect(requiredValue(0, "count")).toBe(0);
    expect(requiredValue(false, "flag")).toBe(false);
    expect(requiredValue("", "text")).toBe("");
    const item = { id: "board" };
    expect(requiredValue(item, "board")).toBe(item);
  });
});
