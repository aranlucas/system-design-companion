import { expect, test } from "vitest";
import { promiseResult } from "@/shared/promise-result.ts";
import { requiredTestValue } from "@test/helpers/required-test-value.ts";

test("resolves source and test-helper aliases", async () => {
  const value = { id: "alias" };

  expect(await promiseResult(() => requiredTestValue(value))).toBe(value);
});
