import { afterEach, describe, expect, it, vi } from "vitest";
import { callbackAllowed, checkCallbackDestination } from "../src/worker/webhook-destination.ts";
import { makeEnv } from "./helpers/fakes.ts";

const CALLBACK = "https://receiver.example.com/events";
type DnsRecord = { type: number; data: string };

function resolver(records: DnsRecord[]) {
  const fetch = vi.fn(async (input: URL) => {
    expect(input.hostname).toBe("cloudflare-dns.com");
    expect(input.searchParams.get("name")).toBe("receiver.example.com");
    return Response.json({ Status: 0, TC: false, Answer: records });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("callback destination policy", () => {
  it("fails closed without an exact host allowlist and refuses subdomains and custom ports", async () => {
    const { env } = makeEnv();
    expect(callbackAllowed(env, CALLBACK)).toBe(true);
    expect(callbackAllowed(env, "https://evil.receiver.example.com/cb")).toBe(false);
    expect(callbackAllowed(env, "https://receiver.example.com:8443/cb")).toBe(false);
    delete env.MCP_EVENT_CALLBACK_HOSTS;
    expect(callbackAllowed(env, CALLBACK)).toBe(false);
    const fetch = resolver([]);
    await expect(checkCallbackDestination(env, CALLBACK)).rejects.toThrow("not allowed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("resolves both address families again for every attempt", async () => {
    const { env } = makeEnv();
    const fetch = resolver([
      { type: 1, data: "8.8.8.8" },
      { type: 28, data: "2606:4700:4700::1111" },
    ]);
    await checkCallbackDestination(env, CALLBACK);
    await checkCallbackDestination(env, CALLBACK);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.map(([url]) => url.searchParams.get("type"))).toEqual([
      "A",
      "AAAA",
      "A",
      "AAAA",
    ]);
  });

  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "192.0.2.1",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ])("rejects non-public address %s even alongside a public answer", async (address) => {
    const { env } = makeEnv();
    resolver([
      { type: 1, data: "8.8.8.8" },
      { type: address.includes(":") ? 28 : 1, data: address },
    ]);
    await expect(checkCallbackDestination(env, CALLBACK)).rejects.toThrow("public addresses");
  });

  it("fails closed on absent addresses, lookup errors, truncated answers and oversized responses", async () => {
    const { env } = makeEnv();
    resolver([]);
    await expect(checkCallbackDestination(env, CALLBACK)).rejects.toThrow("public addresses");
    vi.stubGlobal("fetch", async () => Response.json({ Status: 2 }));
    await expect(checkCallbackDestination(env, CALLBACK)).rejects.toThrow();
    vi.stubGlobal("fetch", async () => Response.json({ Status: 0, TC: true }));
    await expect(checkCallbackDestination(env, CALLBACK)).rejects.toThrow();
    vi.stubGlobal("fetch", async () => new Response("x".repeat(4097)));
    await expect(checkCallbackDestination(env, CALLBACK)).rejects.toThrow("too large");
  });
});
