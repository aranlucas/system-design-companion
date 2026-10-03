import { describe, expect, it } from "vitest";
import type { DiagramRoom } from "../src/worker/room.ts";
import { awaitedRpc } from "./helpers/awaited-rpc.ts";

const info = { id: "test", name: "Test", elements: 0, tabs: 0, focusedAt: 0 };

describe("awaited-only RPC test adapter", () => {
  it("preserves an awaited result and rejects unsupported pipelining and disposal", async () => {
    const stub = awaitedRpc<DiagramRoom>({ info: async () => info });
    const pending = stub.info();
    expect(() => pending.name).toThrow("Unimplemented fake member");
    const result = await pending;
    expect(result).toEqual(info);
    expect(() => result[Symbol.dispose]).toThrow("RPC disposal");
  });
  it("preserves rejected methods and their receiver", async () => {
    class Methods {
      #message = "original failure";
      async info(): Promise<typeof info> {
        throw new Error(this.#message);
      }
    }

    const stub = awaitedRpc<DiagramRoom>(new Methods());
    await expect(stub.info()).rejects.toThrow("original failure");
  });
});
