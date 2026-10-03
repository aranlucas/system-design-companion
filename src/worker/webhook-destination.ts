import ipaddr from "ipaddr.js";
import { z } from "zod";
import { boundedResponse } from "./bounded-response.ts";

const dnsResponse = z.object({
  Status: z.literal(0),
  TC: z.literal(false).optional(),
  Answer: z.array(z.object({ type: z.number().int(), data: z.string() })).optional(),
});

/** Only administrator-controlled hostnames may be used as callback destinations. */
export function callbackAllowed(env: Env, value: string): boolean {
  const url = new URL(value);

  // No wildcards: an attacker-controlled subdomain must not inherit permission.
  const allowed = (env.MCP_EVENT_CALLBACK_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  return (!url.port || url.port === "443") && allowed.includes(url.hostname.toLowerCase());
}

/**
 * Workers fetch does not expose DNS pinning or TLS address overrides. Restrict
 * destinations to explicitly trusted callback operators, resolve both address
 * families before every POST, and use global_fetch_strictly_public. This is a
 * trust boundary, not a claim that a DNS preflight by itself prevents rebinding.
 */
export async function checkCallbackDestination(env: Env, value: string): Promise<void> {
  if (!callbackAllowed(env, value)) throw new Error("callback host is not allowed");
  const hostname = new URL(value).hostname;

  const answers = await Promise.all(
    ["A", "AAAA"].map(async (type) => {
      const endpoint = new URL("https://cloudflare-dns.com/dns-query");
      endpoint.searchParams.set("name", hostname);
      endpoint.searchParams.set("type", type);

      const response = await fetch(endpoint, {
        headers: { accept: "application/dns-json" },
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) throw new Error("callback DNS lookup failed");
      const data = dnsResponse.parse(JSON.parse(await boundedResponse(response)));

      return (data.Answer ?? [])
        .filter((record) => record.type === 1 || record.type === 28)
        .map((record) => record.data);
    }),
  );

  const addresses = answers.flat();

  if (!addresses.length || addresses.some((address) => ipaddr.parse(address).range() !== "unicast"))
    throw new Error("callback DNS did not resolve exclusively to public addresses");
}
