import { describe, expect, it } from "vitest";
import { promiseResult } from "../src/shared/promise-result.ts";

describe("promiseResult", () => {
  it("runs immediate side effects and preserves resolved values", async () => {
    const calls: string[] = [];
    const value = { id: "board" };

    const pending = promiseResult(() => {
      calls.push("called");

      return value;
    });

    expect(calls).toEqual(["called"]);
    expect(await pending).toBe(value);
  });
  it("assimilates promises and preserves thrown error identity as a rejection", async () => {
    const value = { id: "board" };
    expect(await promiseResult(() => Promise.resolve(value))).toBe(value);

    const thenable: PromiseLike<typeof value> = {
      // oxlint-disable-next-line unicorn/no-thenable -- regression: PromiseLike assimilation is part of this adapter's contract.
      then(resolve, reject) {
        return Promise.resolve(value).then(resolve, reject);
      },
    };

    expect(await promiseResult(() => thenable)).toBe(value);
    const error = new Error("operation failed");

    const pending = promiseResult(() => {
      throw error;
    });

    await expect(pending).rejects.toBe(error);
  });
  it("preserves a legacy non-Error throw as the same rejection value", async () => {
    const rejection = { reason: "legacy failure" };

    const pending = promiseResult(() => {
      // oxlint-disable-next-line typescript/only-throw-error -- regression: the adapter must preserve arbitrary legacy thrown values.
      throw rejection;
    });

    await expect(pending).rejects.toBe(rejection);
  });
});
