import { describe, expect, it } from "vitest";
import { socketMessageSchema } from "@/worker/socket-schema.ts";

describe("RPC result wire boundary", () => {
  it.each([
    { type: "rpc_result", reqId: "request-1", ok: true, data: { visible: true } },
    { type: "rpc_result", reqId: "request-1", ok: true },
    { type: "rpc_result", reqId: "request-1", ok: false, error: "No open canvas" },
  ])("accepts a supported result: $ok", (message) => {
    expect(socketMessageSchema.parse(message)).toEqual(message);
  });

  it.each([
    { ok: false },
    { ok: false, error: 42 },
    { ok: false, error: "x".repeat(1001) },
    { ok: "true", data: {} },
  ])("rejects a malformed result: $ok", (result) => {
    expect(
      socketMessageSchema.safeParse({ type: "rpc_result", reqId: "request-1", ...result }).success,
    ).toBe(false);
  });
});
