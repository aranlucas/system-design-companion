import { expect, test } from "vitest";
import { requiredPoint } from "@/shared/schemas.ts";
import { requiredTestValue } from "@test/helpers/required-test-value.ts";

test("geometry endpoints preserve forward and backward indices", () => {
  expect(
    requiredPoint(
      [
        [1, 2],
        [3, 4],
      ],
      0,
    ),
  ).toEqual([1, 2]);
  expect(
    requiredPoint(
      [
        [1, 2],
        [3, 4],
      ],
      -1,
    ),
  ).toEqual([3, 4]);
  expect(() => requiredPoint([], -1)).toThrow("Missing geometry point at index -1");
  expect(() => requiredPoint([[1, 2]], 2)).toThrow("Missing geometry point at index 2");
});

test("fixtures reject missing values without rejecting falsy data", () => {
  expect(requiredTestValue(0)).toBe(0);
  expect(requiredTestValue(false)).toBe(false);
  expect(requiredTestValue("")).toBe("");
  expect(() => requiredTestValue()).toThrow("Expected test fixture value to be present");
  expect(() => requiredTestValue(null)).toThrow("Expected test fixture value to be present");
});
