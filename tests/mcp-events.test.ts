// MCP Events: the catalog, the subscribe/unsubscribe contract, and signed delivery.
//
// The OAuth gate is covered in http.test.ts; these tests drive the MCP surface
// directly through handleMcp, which is the same seam the provider's apiHandler
// calls once a token has been verified.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { El } from "../src/shared/protocol.ts";
import { deliverDiagramEvent, resetVerificationCache } from "../src/worker/events.ts";
import { handleMcp } from "../src/worker/mcp.ts";
import { DiagramRoom } from "../src/worker/room.ts";
import { createDiagram, shareLink } from "../src/worker/store.ts";
import {
  makeEnv,
  makeRoom,
  makeRoomCtx,
  makeWs,
  testPrincipal,
  type TestEnv,
} from "./helpers/fakes.ts";

const PROTOCOL_VERSION = "2026-07-28";
const CALLBACK = "https://receiver.example.com/hooks/abc";
/** A Standard Webhooks secret: whsec_ plus base64 of 24 bytes. */
const SECRET = `whsec_${btoa("0123456789abcdef01234567")}`;

/** An element as a browser tab would send it over the socket. */
function rect(id: string, x: number, y: number): El {
  return {
    id,
    type: "rectangle",
    x,
    y,
    width: 160,
    height: 70,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    index: `a${id}`,
    frameId: null,
  };
}

/** One POST the server made to a callback URL. */
interface Delivery {
  url: string;
  headers: Record<string, string>;
  body: EventBody;
  raw: string;
}

/** The `data` of one delivered event, as a test reads it. */
type EventData = { diagram_id?: string; name?: string; snapshot_id?: string };

/** The body of one delivered event, as a test reads it. */
interface EventBody extends Record<string, unknown> {
  eventId?: string;
  name?: string;
  timestamp?: string;
  cursor?: null;
  type?: string;
  data?: EventData;
}

/** A JSON-RPC reply: either a result or an error, never both. */
interface RpcReply<T> {
  result?: T;
  error?: { code: number; data?: unknown };
}

/** What events/list returns. */
type EventsListResult = { events: ListedEvent[] };

/** One entry of the events/list catalog. */
type ListedEvent = {
  name: string;
  description: string;
  delivery: string[];
  inputSchema: { required: string[]; properties: Record<string, unknown> };
  payloadSchema: { type: string };
};

/** What events/subscribe grants. */
type Grant = { id: string; refreshBefore: string; cursor: null };

/** The `delivery` and `arguments` an unsubscribe is keyed on. */
type UnsubscribeParams = {
  name: string;
  arguments: { diagram: string };
  delivery: { mode: "webhook"; url: string };
};

/** Lets a test intercept callback deliveries and decide how the endpoint answers. */
class Receiver {
  readonly deliveries: Delivery[] = [];
  /** When false, the endpoint never echoes the challenge, so verification fails. */
  echoChallenge = true;
  /** Status returned for event deliveries (the verification POST always gets 200). */
  eventStatus = 200;

  fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    // The server always serializes the body once and signs those exact bytes.
    const body = JSON.parse(init?.body as string) as EventBody;
    this.deliveries.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers)),
      body,
      raw: init?.body as string,
    });
    if (body.type === "verification") {
      if (!this.echoChallenge) return new Response("nope", { status: 400 });
      return Response.json({ challenge: body.challenge });
    }
    return new Response(null, { status: this.eventStatus });
  });

  /** Deliveries that are events rather than control envelopes. */
  events(): Delivery[] {
    return this.deliveries.filter((d) => !("type" in d.body));
  }
}

let env: TestEnv;
let receiver: Receiver;

beforeEach(() => {
  env = makeEnv();
  receiver = new Receiver();
  // The verification cache is per-isolate soft state, so it has to be cleared
  // between tests that reuse the same principal and callback URL.
  resetVerificationCache();
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    if (new URL(input).hostname === "cloudflare-dns.com")
      return Response.json({ Status: 0, TC: false, Answer: [{ type: 1, data: "8.8.8.8" }] });
    return receiver.fetch(input, init);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Send one JSON-RPC request on the 2026-07-28 era and return its result or error. */
async function rpc<T extends Record<string, unknown>>(
  method: string,
  params: Record<string, unknown>,
  principal = testPrincipal(),
): Promise<RpcReply<T>> {
  const response = await handleMcp(
    new Request("https://design.example/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        // The modern era cross-checks these against the body's envelope.
        "mcp-protocol-version": PROTOCOL_VERSION,
        "mcp-method": method,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
          },
        },
      }),
    }),
    env.env,
    principal,
  );
  const text = await response.text();
  // The handler answers over SSE, so the payload is in a data: frame.
  const frame = text
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);
  return JSON.parse(frame ?? text) as RpcReply<T>;
}

async function newDiagram(name = "Board") {
  const d = await createDiagram(env.env, name);
  return { ...d, link: shareLink("https://design.example", d.id, d.key) };
}

/** The subscribe params every test shares. */
function subscribeParams(link: string, overrides: Record<string, unknown> = {}) {
  return {
    name: "diagram.changed",
    arguments: { diagram: link },
    delivery: { mode: "webhook", url: CALLBACK, secret: SECRET },
    ...overrides,
  };
}

describe("events/list", () => {
  it("advertises the catalog with schemas and webhook delivery", async () => {
    const { result } = await rpc<EventsListResult>("events/list", {});
    const names = result!.events.map((e) => e.name);
    expect(names).toEqual(["diagram.changed", "diagram.renamed", "diagram.checkpointed"]);
    for (const event of result!.events) {
      expect(event.delivery).toEqual(["webhook"]);
      expect(event.inputSchema).toMatchObject({ required: ["diagram"] });
      expect(event.payloadSchema).toMatchObject({ type: "object" });
    }
    const changed = result!.events[0];
    expect(changed.description).toMatch(/edited/i);
    // Agent edits are opt-in, so the model can see the loop is closed by default.
    expect(JSON.stringify(changed.inputSchema)).toContain("include_agent");
  });
});

describe("events/subscribe", () => {
  it("verifies the callback, stores the subscription and grants a TTL", async () => {
    const d = await newDiagram();
    const { result } = await rpc<Grant>("events/subscribe", subscribeParams(d.link));
    expect(result!.id).toMatch(/^sub_/);
    expect(result!.cursor).toBeNull();
    expect(Date.parse(result!.refreshBefore)).toBeGreaterThan(Date.now());

    // The endpoint was challenged before any event could be sent to it.
    expect(receiver.deliveries[0].body).toMatchObject({ type: "verification" });

    const row = env.db.event_subscriptions.get(result!.id);
    expect(row).toMatchObject({ user_id: "github%3A1", event_name: "diagram.changed" });
    // The share link is the credential, so the key must not be stored.
    expect(JSON.stringify(row)).not.toContain(d.key);
  });

  it("signs the verification challenge like any other delivery", async () => {
    const d = await newDiagram();
    await rpc("events/subscribe", subscribeParams(d.link));
    const { headers } = receiver.deliveries[0];
    expect(headers["webhook-id"]).toMatch(/^msg_verification_/);
    expect(headers["webhook-timestamp"]).toMatch(/^\d+$/);
    expect(headers["webhook-signature"]).toMatch(/^v1,[A-Za-z0-9+/=]+$/);
    expect(headers["x-mcp-subscription-id"]).toMatch(/^sub_/);
  });

  it("refuses to subscribe when the endpoint will not echo the challenge", async () => {
    const d = await newDiagram();
    receiver.echoChallenge = false;
    const { error } = await rpc("events/subscribe", subscribeParams(d.link));
    expect(error!.code).toBe(-32015);
    expect(env.db.event_subscriptions.size).toBe(0);
  });

  it("challenges a given principal and endpoint only once", async () => {
    const d = await newDiagram();
    await rpc("events/subscribe", subscribeParams(d.link));
    await rpc("events/subscribe", subscribeParams(d.link));
    expect(receiver.deliveries.filter((x) => x.body.type === "verification")).toHaveLength(1);
  });

  it("is idempotent for the same identity and refreshes the grant", async () => {
    const d = await newDiagram();
    const first = await rpc<Grant>("events/subscribe", subscribeParams(d.link));
    const second = await rpc<Grant>(
      "events/subscribe",
      subscribeParams(d.link, {
        ttlMs: 60 * 60 * 1000,
      }),
    );
    expect(second.result!.id).toBe(first.result!.id);
    expect(env.db.event_subscriptions.size).toBe(1);
  });

  it("rejects a secret that is not a Standard Webhooks key", async () => {
    const d = await newDiagram();
    const bad = ["nope", `whsec_${btoa("short")}`, "whsec_!!!not-base64!!!"];
    const errors = await Promise.all(
      bad.map(async (secret) => {
        const { error } = await rpc(
          "events/subscribe",
          subscribeParams(d.link, { delivery: { mode: "webhook", url: CALLBACK, secret } }),
        );
        return error!.code;
      }),
    );
    expect(errors).toEqual([-32602, -32602, -32602]);
  });

  it("rejects a non-https callback", async () => {
    const d = await newDiagram();
    const { error } = await rpc(
      "events/subscribe",
      subscribeParams(d.link, {
        delivery: { mode: "webhook", url: "http://x.example", secret: SECRET },
      }),
    );
    expect(error!.code).toBe(-32602);
  });

  it("refuses a diagram link the caller cannot open", async () => {
    const d = await newDiagram();
    const { error } = await rpc(
      "events/subscribe",
      subscribeParams(shareLink("https://design.example", d.id, "wrong-key")),
    );
    expect(error!.code).toBe(-32012);
  });

  it("refuses an unknown event name", async () => {
    const d = await newDiagram();
    const { error } = await rpc("events/subscribe", subscribeParams(d.link, { name: "nope" }));
    expect(error!.code).toBe(-32011);
  });
});

describe("events/unsubscribe", () => {
  it("stops delivery and is idempotent", async () => {
    const d = await newDiagram();
    await rpc("events/subscribe", subscribeParams(d.link));
    const room = await makeRoom(env.env, d.id, d.name);
    // Background delivery; the subscription is removed before it settles.
    void room.applyPatch([{ op: "add_node", label: "Web" }], "agent");

    const params: UnsubscribeParams = {
      name: "diagram.changed",
      arguments: { diagram: d.link },
      delivery: { mode: "webhook", url: CALLBACK },
    };
    expect((await rpc("events/unsubscribe", params)).result).toBeDefined();
    expect(env.db.event_subscriptions.size).toBe(0);
    // Unsubscribing again changes nothing.
    expect((await rpc("events/unsubscribe", params)).result).toBeDefined();
    expect(env.db.event_subscriptions.size).toBe(0);
  });
});

/** A diagram, a subscription to it, and a room wired to a drainable context. */
interface Watched {
  d: { id: string; key: string; name: string; link: string };
  room: DiagramRoom;
  ctx: ReturnType<typeof makeRoomCtx>;
}

/** Subscribe to one event on a fresh diagram, then hand back a room for it. */
async function watched(name = "diagram.changed", args: Record<string, unknown> = {}) {
  const d = await newDiagram();
  await rpc("events/subscribe", {
    ...subscribeParams(d.link, { name }),
    arguments: { diagram: d.link, ...args },
  });
  const ctx = makeRoomCtx();
  const room = new DiagramRoom(ctx.ctx as unknown as DurableObjectState, env.env);
  await room.init(d.id, d.name);
  return { d, room, ctx } satisfies Watched;
}

describe("delivery", () => {
  it("delivers a human edit as a signed event", async () => {
    const { d, room, ctx } = await watched();
    // A person editing arrives over the socket, not through the ops layer.
    const socket = makeWs() as unknown as WebSocket;
    await room.webSocketMessage(
      socket,
      JSON.stringify({ type: "update", elements: [rect("web", 10, 20)] }),
    );
    await ctx.drain();

    const events = receiver.events();
    expect(events).toHaveLength(1);
    expect(events[0].body).toMatchObject({
      name: "diagram.changed",
      cursor: null,
      data: { diagram_id: d.id, origin: "human", changed_count: 1 },
    });
    expect(events[0].body.eventId).toMatch(/^evt_/);
    expect(Date.parse(events[0].body.timestamp as string)).toBeGreaterThan(0);
    // Signed per Standard Webhooks, with the subscription id for routing.
    expect(events[0].headers["webhook-id"]).toMatch(/^evt_/);
    expect(events[0].headers["webhook-signature"]).toMatch(/^v1,/);
    expect(events[0].headers["x-mcp-subscription-id"]).toMatch(/^sub_/);
  });

  it("withholds the agent's own edits so it cannot react to itself", async () => {
    const { room, ctx } = await watched();
    await room.applyPatch([{ op: "add_node", label: "Web" }], "agent");
    await ctx.drain();
    expect(receiver.events()).toHaveLength(0);
  });

  it("delivers the agent's own edits to a subscriber that opted in", async () => {
    const { d, room, ctx } = await watched("diagram.changed", { include_agent: true });
    await room.applyPatch([{ op: "add_node", label: "Web" }], "agent");
    await ctx.drain();
    const events = receiver.events();
    expect(events).toHaveLength(1);
    expect(events[0].body.data).toMatchObject({ diagram_id: d.id, origin: "agent" });
  });

  it("delivers renames", async () => {
    const { d, room, ctx } = await watched("diagram.renamed");
    await room.rename("Renamed board");
    await ctx.drain();
    expect(receiver.events()[0].body.data).toMatchObject({
      diagram_id: d.id,
      name: "Renamed board",
    });
  });

  it("delivers named checkpoints but not the automatic ones", async () => {
    const { d, room, ctx } = await watched("diagram.checkpointed");
    // Every agent edit snapshots first; that is noise, not a checkpoint.
    await room.applyPatch([{ op: "add_node", label: "Web" }], "agent");
    await ctx.drain();
    expect(receiver.events()).toHaveLength(0);

    await room.snapshot("before the interview", "named");
    await ctx.drain();
    const events = receiver.events();
    expect(events).toHaveLength(1);
    expect(events[0].body.data).toMatchObject({
      diagram_id: d.id,
      name: "before the interview",
    });
    expect(events[0].body.data?.snapshot_id).toEqual(expect.any(String));
  });

  it("only delivers to subscribers of that event", async () => {
    const { room, ctx } = await watched("diagram.renamed");
    await room.applyPatch([{ op: "add_node", label: "Web" }], "agent");
    await ctx.drain();
    expect(receiver.events()).toHaveLength(0);
  });

  it("keeps the share key out of the delivered payload", async () => {
    const { d, room, ctx } = await watched("diagram.renamed");
    await room.rename("Renamed");
    await ctx.drain();
    const body = JSON.stringify(receiver.events()[0].body);
    // The link is the credential, and the agent already supplied it to subscribe.
    expect(body).not.toContain(d.key);
    expect(body).toContain(d.id);
  });

  it("does not retry a 410 Gone", async () => {
    const { room, ctx } = await watched("diagram.renamed");
    receiver.eventStatus = 410;
    await room.rename("Renamed");
    await ctx.drain();
    expect(receiver.deliveries).toHaveLength(2); // the challenge, then one attempt
  });

  it("leaves the edit working when delivery fails outright", async () => {
    const { d, room, ctx } = await watched("diagram.renamed");
    receiver.fetch.mockRejectedValue(new Error("connection refused"));
    await room.rename("Renamed");
    await ctx.drain();
    // The rename is committed locally regardless of the webhook.
    expect((await room.info()).name).toBe("Renamed");
    expect(d.id).toBeTruthy();
  });
});

/** Verify using the receiver's key and the actual transmitted bytes. */
async function validSignature(delivery: Delivery, secret = SECRET): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(secret.slice(6)), (c) => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(
    `${delivery.headers["webhook-id"]}.${delivery.headers["webhook-timestamp"]}.${delivery.raw}`,
  );
  const signatures = delivery.headers["webhook-signature"].split(" ");
  const results = await Promise.all(
    signatures.map((signature) =>
      crypto.subtle.verify(
        "HMAC",
        key,
        Uint8Array.from(atob(signature.split(",")[1]), (c) => c.charCodeAt(0)),
        signed,
      ),
    ),
  );
  return results.some(Boolean);
}

describe("subscription validation and isolation", () => {
  it("rejects arguments that differ from the advertised schemas", async () => {
    const d = await newDiagram();
    const invalid = [
      { diagram: d.link, include_agent: "yes" },
      { diagram: d.link, unexpected: true },
      { diagram: 12 },
    ];
    const replies = await Promise.all(
      invalid.map((arguments_) =>
        rpc("events/subscribe", subscribeParams(d.link, { arguments: arguments_ })),
      ),
    );
    expect(replies.map((reply) => reply.error?.code)).toEqual([-32602, -32602, -32602]);
    expect(
      (
        await rpc(
          "events/subscribe",
          subscribeParams(d.link, {
            name: "diagram.renamed",
            arguments: { diagram: d.link, include_agent: true },
          }),
        )
      ).error?.code,
    ).toBe(-32602);
    expect(receiver.deliveries).toHaveLength(0);
  });

  it("rejects malformed URLs, credentials, IP literals and local destinations before fetching", async () => {
    const d = await newDiagram();
    const urls = [
      "https://",
      "https://localhost/cb",
      "https://internal.local/cb",
      "https://127.0.0.1/cb",
      "https://2130706433/cb",
      "https://[::1]/cb",
      "https://user:pass@receiver.example.com/cb",
      `${CALLBACK}#fragment`,
    ];
    const replies = await Promise.all(
      urls.map((url) =>
        rpc(
          "events/subscribe",
          subscribeParams(d.link, { delivery: { mode: "webhook", url, secret: SECRET } }),
        ),
      ),
    );
    expect(replies.map((reply) => reply.error?.code)).toEqual(urls.map(() => -32602));
    expect(receiver.fetch).not.toHaveBeenCalled();
  });

  it("enforces TTL boundaries and rejects negative, zero and fractional lifetimes", async () => {
    const d = await newDiagram();
    const now = Date.now();
    const short = await rpc<Grant>("events/subscribe", subscribeParams(d.link, { ttlMs: 1 }));
    expect(Date.parse(short.result!.refreshBefore) - now).toBeGreaterThanOrEqual(5 * 60 * 1000);
    const capped = await rpc<Grant>(
      "events/subscribe",
      subscribeParams(d.link, { ttlMs: 30 * 86400_000 }),
    );
    expect(Date.parse(capped.result!.refreshBefore) - Date.now()).toBeLessThanOrEqual(
      7 * 86400_000,
    );
    const finite = await rpc<Grant>("events/subscribe", subscribeParams(d.link, { ttlMs: null }));
    expect(finite.result!.refreshBefore).not.toBeNull();
    const replies = await Promise.all(
      [-1, 0, 1.5].map((ttlMs) => rpc("events/subscribe", subscribeParams(d.link, { ttlMs }))),
    );
    expect(replies.map((reply) => reply.error?.code)).toEqual([-32602, -32602, -32602]);
  });

  it("normalizes argument order and omitted defaults", async () => {
    const d = await newDiagram();
    const first = await rpc<Grant>("events/subscribe", subscribeParams(d.link));
    const second = await rpc<Grant>(
      "events/subscribe",
      subscribeParams(d.link, {
        arguments: { include_agent: false, diagram: d.link },
      }),
    );
    expect(second.result!.id).toBe(first.result!.id);
  });

  it("isolates subscriptions by user and consent grant", async () => {
    const d = await newDiagram();
    const own = await rpc<Grant>("events/subscribe", subscribeParams(d.link));
    const other = await rpc<Grant>(
      "events/subscribe",
      subscribeParams(d.link),
      testPrincipal({ authorizationId: "other-installation" }),
    );
    expect(other.result!.id).not.toBe(own.result!.id);
    const params = {
      name: "diagram.changed",
      arguments: { diagram: d.link },
      delivery: { mode: "webhook", url: CALLBACK },
    };
    await rpc("events/unsubscribe", params, testPrincipal({ userId: "someone-else" }));
    expect(env.db.event_subscriptions.size).toBe(2);
    await rpc("events/unsubscribe", params);
    expect(env.db.event_subscriptions.has(own.result!.id)).toBe(false);
    expect(env.db.event_subscriptions.has(other.result!.id)).toBe(true);
  });

  it("allows unsubscribe after the diagram capability is revoked", async () => {
    const d = await newDiagram();
    await rpc("events/subscribe", subscribeParams(d.link));
    env.db.deleted.add(d.id);
    const reply = await rpc("events/unsubscribe", {
      name: "diagram.changed",
      arguments: { diagram: d.link },
      delivery: { mode: "webhook", url: CALLBACK },
    });
    expect(reply.result).toBeDefined();
    expect(env.db.event_subscriptions.size).toBe(0);
  });

  it("rejects an oversized verification response", async () => {
    const d = await newDiagram();
    receiver.fetch.mockResolvedValue(new Response("x".repeat(4097)));
    expect((await rpc("events/subscribe", subscribeParams(d.link))).error?.code).toBe(-32015);
    expect(env.db.event_subscriptions.size).toBe(0);
  });
});

describe("webhook delivery lifecycle", () => {
  it("generates verifiable signatures covering the exact payload", async () => {
    const { room, ctx } = await watched("diagram.renamed");
    await room.rename("Unicode: café 🌳");
    await ctx.drain();
    expect(await validSignature(receiver.deliveries[0])).toBe(true);
    expect(await validSignature(receiver.events()[0])).toBe(true);
    expect(await validSignature({ ...receiver.events()[0], raw: "tampered" })).toBe(false);
  });

  it("rotates secrets with five minutes of dual signatures", async () => {
    const { d, room, ctx } = await watched("diagram.renamed");
    const replacement = `whsec_${btoa("abcdefghijklmnopqrstuvwx")}`;
    const originalId = [...env.db.event_subscriptions.keys()][0];
    const refreshed = await rpc<Grant>(
      "events/subscribe",
      subscribeParams(d.link, {
        name: "diagram.renamed",
        delivery: { mode: "webhook", url: CALLBACK, secret: replacement },
      }),
    );
    expect(refreshed.result!.id).toBe(originalId);
    await room.rename("Rotated");
    await ctx.drain();
    expect(await validSignature(receiver.events()[0], SECRET)).toBe(true);
    expect(await validSignature(receiver.events()[0], replacement)).toBe(true);
    env.db.event_access.get(originalId)!.previous_secret_until = Date.now() - 1;
    await room.rename("Window closed");
    await ctx.drain();
    expect(receiver.events()[1].headers["webhook-signature"].split(" ")).toHaveLength(1);
    expect(await validSignature(receiver.events()[1], replacement)).toBe(true);
  });

  it("stops delivery after subscription expiry", async () => {
    const { room, ctx } = await watched("diagram.renamed");
    [...env.db.event_subscriptions.values()][0].expires_at = Date.now() - 1;
    await room.rename("Expired");
    await ctx.drain();
    expect(receiver.events()).toHaveLength(0);
  });

  it("stops delivery when the consent grant is revoked", async () => {
    const { room, ctx } = await watched("diagram.renamed");
    env.kv.values.delete("grant:github%3A1:test-grant");
    await room.rename("Disconnected");
    await ctx.drain();
    expect(receiver.events()).toHaveLength(0);
    expect(env.db.event_subscriptions.size).toBe(0);
  });

  it("stops delivery after the capability key changes or the diagram is deleted", async () => {
    const { d, room, ctx } = await watched("diagram.renamed");
    env.db.diagrams.get(d.id)!.key_hash = "rotated";
    await room.rename("Revoked");
    await ctx.drain();
    expect(receiver.events()).toHaveLength(0);
    expect(env.db.event_subscriptions.size).toBe(0);
    const second = await watched("diagram.renamed");
    env.db.deleted.add(second.d.id);
    await second.room.rename("Deleted");
    await second.ctx.drain();
    expect(receiver.events()).toHaveLength(0);
  });

  it("keeps subscriptions through a new handler and verification-cache reset", async () => {
    const { room, ctx } = await watched("diagram.renamed");
    resetVerificationCache();
    await room.rename("After restart");
    await ctx.drain();
    expect(receiver.events()).toHaveLength(1);
  });

  it("retries transient HTTP and network failures with the same event ID", async () => {
    const { room, ctx } = await watched("diagram.renamed");
    receiver.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    receiver.fetch.mockRejectedValueOnce(new Error("network unavailable"));
    await room.rename("Retry");
    await ctx.drain();
    const calls = receiver.fetch.mock.calls.slice(1);
    expect(calls).toHaveLength(3);
    const ids = calls.map((call) => new Headers(call[1]?.headers).get("webhook-id"));
    expect(new Set(ids).size).toBe(1);
    expect(await validSignature(receiver.events()[0])).toBe(true);
  });

  it("bounds retries and does not retry a 413 or a permanent 400", async () => {
    const { d } = await watched("diagram.renamed");
    receiver.eventStatus = 503;
    await deliverDiagramEvent(env.env, d.id, "diagram.renamed", {
      diagram_id: d.id,
      name: "Bounded",
    });
    expect(receiver.events()).toHaveLength(3);
    receiver.eventStatus = 413;
    await deliverDiagramEvent(env.env, d.id, "diagram.renamed", {
      diagram_id: d.id,
      name: "Too large",
    });
    expect(receiver.events()).toHaveLength(4);
    receiver.eventStatus = 400;
    await deliverDiagramEvent(env.env, d.id, "diagram.renamed", {
      diagram_id: d.id,
      name: "Bad request",
    });
    expect(receiver.events()).toHaveLength(5);
  });

  it("cancels subsequent attempts when unsubscribe happens during a delivery", async () => {
    const { d, room, ctx } = await watched("diagram.renamed");
    receiver.fetch.mockImplementationOnce(async () => {
      await rpc("events/unsubscribe", {
        name: "diagram.renamed",
        arguments: { diagram: d.link },
        delivery: { mode: "webhook", url: CALLBACK },
      });
      return new Response(null, { status: 503 });
    });
    await room.rename("Cancelled");
    await ctx.drain();
    expect(receiver.fetch).toHaveBeenCalledTimes(2); // challenge + one delivery attempt
  });
});
