// MCP Events: the catalog, subscription storage, and signed webhook delivery.
//
// ChatGPT is the only client that speaks this today, and it only speaks webhook
// delivery, so `delivery` is ["webhook"] everywhere and poll/stream are not
// implemented. The SDK has no events support yet, so the three methods are
// registered by hand; `capabilities.events` is set in mcp.ts.
//
// Delivery is best-effort; retries can deliver duplicates. There is no durable event
// log, so every response carries `cursor: null` and a missed event is not
// recoverable through the protocol. An agent that needs certainty calls
// get_scene, which is why payloads stay small enough to act on.
import { ProtocolError, type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { boundedResponse } from "./bounded-response.ts";
import { callbackAllowed, checkCallbackDestination } from "./webhook-destination.ts";
import type { McpPrincipal } from "./principal.ts";
import { ensureSchema, parseLink, sha256, verifyKey } from "./store.ts";

/** Implementation-defined JSON-RPC codes from the MCP Events draft. */
const ERR_NOT_FOUND = -32011;
const ERR_FORBIDDEN = -32012;
const ERR_CALLBACK = -32015;
const ERR_INVALID_PARAMS = -32602;

/** Finite subscription lifetimes bound how long the grant can authorize delivery. */
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_TTL_MS = 5 * 60 * 1000;
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A (principal, callback URL) pair that answered a challenge is not asked again for this long. */
const VERIFICATION_TTL_MS = 60 * 60 * 1000;

/** One request per delivery, this many attempts, this much backoff between them. */
const MAX_ATTEMPTS = 3;
const DELIVERY_TIMEOUT_MS = 5_000;
const RETRY_BASE_MS = 500;
const MAX_BODY_BYTES = 256 * 1024;

/** One event type, as `events/list` describes it. */
interface EventType {
  name: string;
  description: string;
  delivery: string[];
  inputSchema: Record<string, unknown>;
  payloadSchema: Record<string, unknown>;
}

/** A stored webhook subscription. The secret is the client's, chosen at subscribe time. */
interface Subscription {
  id: string;
  userId: string;
  authorizationId: string;
  resource: string;
  keyHash: string;
  previousSecret: string | null;
  previousSecretUntil: number;
  eventName: string;
  diagramId: string;
  callbackUrl: string;
  secret: string;
  includeAgent: boolean;
  expiresAt: number;
}

/** The body POSTed to a callback: an event occurrence, or a control envelope. */
type DeliveryBody =
  | { type: "verification"; challenge: string }
  | {
      eventId: string;
      name: string;
      timestamp: string;
      data: Record<string, unknown>;
      cursor: null;
    };

/** Row shape read back from D1. */
type SubscriptionRow = {
  id: string;
  user_id: string;
  authorization_id: string;
  resource: string;
  key_hash: string;
  previous_secret: string | null;
  previous_secret_until: number;
  event_name: string;
  diagram_id: string;
  callback_url: string;
  secret: string;
  include_agent: number;
  expires_at: number;
};

/** A `post` outcome: the status we got, and the body when we asked for it. */
type PostResult = { status: number; body: string } | null;

/** What a callback must return to prove it wants deliveries. */
type ChallengeEcho = { challenge?: unknown };

const str = z.string();

const subscribeParams = z.looseObject({
  name: str,
  arguments: z.record(z.string(), z.unknown()).optional(),
  delivery: z.object({ mode: z.literal("webhook"), url: str, secret: str.optional() }),
  cursor: z.string().nullable().optional(),
  ttlMs: z.number().int().positive().nullable().optional(),
});

const unsubscribeParams = z.looseObject({
  name: str,
  arguments: z.record(z.string(), z.unknown()).optional(),
  delivery: z.object({ mode: z.literal("webhook"), url: str }),
});

const listParams = z.looseObject({ cursor: z.string().optional() });

type SubscribeRequest = z.infer<typeof subscribeParams>;
type UnsubscribeRequest = z.infer<typeof unsubscribeParams>;

/** The share link every subscription must name, described for the model that fills it in. */
const diagramArg = {
  type: "string",
  description:
    "The diagram share link, e.g. https://…/d/<id>?k=<key>. The same link you pass to tools.",
};

export const EVENT_TYPES: EventType[] = [
  {
    name: "diagram.changed",
    description:
      "Someone edited a diagram you are watching. Call get_scene with the same share link to see what changed.",
    delivery: ["webhook"],
    inputSchema: {
      type: "object",
      properties: {
        diagram: diagramArg,
        include_agent: {
          type: "boolean",
          default: false,
          description:
            "Also deliver edits the agent itself made. Off by default, so an agent does not react to its own changes.",
        },
      },
      required: ["diagram"],
      additionalProperties: false,
    },
    payloadSchema: {
      type: "object",
      properties: {
        diagram_id: { type: "string" },
        origin: { type: "string", enum: ["human", "agent", "system"] },
        changed_count: { type: "integer", description: "Elements this edit touched." },
      },
      required: ["diagram_id", "origin", "changed_count"],
      additionalProperties: false,
    },
  },
  {
    name: "diagram.renamed",
    description: "A diagram you are watching was renamed.",
    delivery: ["webhook"],
    inputSchema: {
      type: "object",
      properties: { diagram: diagramArg },
      required: ["diagram"],
      additionalProperties: false,
    },
    payloadSchema: {
      type: "object",
      properties: { diagram_id: { type: "string" }, name: { type: "string" } },
      required: ["diagram_id", "name"],
      additionalProperties: false,
    },
  },
  {
    name: "diagram.checkpointed",
    description: "Someone saved a named checkpoint (version) of a diagram you are watching.",
    delivery: ["webhook"],
    inputSchema: {
      type: "object",
      properties: { diagram: diagramArg },
      required: ["diagram"],
      additionalProperties: false,
    },
    payloadSchema: {
      type: "object",
      properties: {
        diagram_id: { type: "string" },
        snapshot_id: { type: "string" },
        name: { type: "string" },
      },
      required: ["diagram_id", "snapshot_id", "name"],
      additionalProperties: false,
    },
  },
];

const byName = new Map(EVENT_TYPES.map((t) => [t.name, t]));

/** Endpoints that answered a challenge, so repeated subscribes do not re-poke them. */
const verified = new Map<string, number>();

/**
 * Forget which endpoints have been verified. The cache is deliberately per-isolate
 * soft state, so this exists for tests that reuse one principal and callback.
 */
export function resetVerificationCache(): void {
  verified.clear();
}

/** Register events/list, events/subscribe and events/unsubscribe on one server. */
export function registerEvents(server: McpServer, env: Env, principal: McpPrincipal): void {
  const low = server.server;
  low.setRequestHandler(
    "events/list",
    { params: listParams, result: z.looseObject({ events: z.array(z.unknown()) }) },
    async () => {
      requireRead(principal);
      return { events: EVENT_TYPES };
    },
  );
  low.setRequestHandler(
    "events/subscribe",
    { params: subscribeParams, result: z.looseObject({ id: str }) },
    async (params) => subscribe(env, principal, params),
  );
  low.setRequestHandler(
    "events/unsubscribe",
    { params: unsubscribeParams, result: z.looseObject({}) },
    async (params) => unsubscribe(env, principal, params),
  );
}

async function subscribe(env: Env, principal: McpPrincipal, params: SubscribeRequest) {
  requireRead(principal);
  if (!byName.has(params.name))
    throw protocolError(ERR_NOT_FOUND, "NotFound", { kind: "event", name: params.name });

  const { url, secret } = params.delivery;
  if (!secret) throw invalidParams("delivery.secret is required for webhook delivery");
  validateCallbackUrl(url);
  if (!callbackAllowed(env, url))
    throw protocolError(ERR_CALLBACK, "CallbackEndpointError", {
      reason: "host_not_allowed",
      url: redacted(url),
    });
  assertSecretLength(secret);

  const args = validateArguments(params.name, params.arguments);
  const parsed = parseLink(args.diagram)!;
  await resolveDiagram(env, args);
  const diagramId = parsed.id;
  const keyHash = await sha256(parsed.key);
  const includeAgent = args.include_agent === true;
  await ensureSchema(env);
  const sub: Subscription = {
    id: await subscriptionId(principal, url, params.name, diagramId, keyHash, includeAgent),
    userId: principal.userId,
    authorizationId: principal.authorizationId,
    resource: principal.resource,
    keyHash,
    previousSecret: null,
    previousSecretUntil: 0,
    eventName: params.name,
    diagramId,
    callbackUrl: url,
    secret,
    includeAgent,
    expiresAt: Date.now() + grantTtl(params.ttlMs),
  };

  // Proving the endpoint wants deliveries stops an attacker using this server to
  // flood someone else's URL. Cached per principal and URL, so varying arguments
  // cannot multiply challenges against one endpoint.
  if (!wasVerified(principal.userId, url)) {
    if (!(await verifyCallback(env, sub)))
      throw protocolError(ERR_CALLBACK, "CallbackEndpointError", {
        reason: "challenge_failed",
        url: redacted(url),
      });
    markVerified(principal.userId, url);
  }

  const previous = await env.DB.prepare(
    "SELECT s.*, a.* FROM event_subscriptions s JOIN event_subscription_access a ON a.id = s.id WHERE s.id = ?",
  )
    .bind(sub.id)
    .first<SubscriptionRow>();
  if (previous?.secret !== secret && previous && previous.expires_at > Date.now()) {
    sub.previousSecret = previous.secret;
    sub.previousSecretUntil = Date.now() + 5 * 60 * 1000;
  } else if (previous?.previous_secret_until && previous.previous_secret_until > Date.now()) {
    sub.previousSecret = previous.previous_secret;
    sub.previousSecretUntil = previous.previous_secret_until;
  }
  // Store both halves atomically. Old rows without access metadata fail closed.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO event_subscriptions
        (id, user_id, event_name, diagram_id, callback_url, secret, include_agent, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET secret = excluded.secret, expires_at = excluded.expires_at`,
    ).bind(
      sub.id,
      sub.userId,
      sub.eventName,
      sub.diagramId,
      sub.callbackUrl,
      sub.secret,
      sub.includeAgent ? 1 : 0,
      sub.expiresAt,
      Date.now(),
    ),
    env.DB.prepare(
      `INSERT INTO event_subscription_access
        (id, authorization_id, resource, key_hash, previous_secret, previous_secret_until)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET previous_secret = excluded.previous_secret,
         previous_secret_until = excluded.previous_secret_until`,
    ).bind(
      sub.id,
      sub.authorizationId,
      sub.resource,
      sub.keyHash,
      sub.previousSecret,
      sub.previousSecretUntil,
    ),
  ]);

  return {
    id: sub.id,
    refreshBefore: new Date(sub.expiresAt).toISOString(),
    // No event log, so there is nothing to resume from.
    cursor: null,
    truncated: false,
  };
}

async function unsubscribe(env: Env, principal: McpPrincipal, params: UnsubscribeRequest) {
  requireRead(principal);
  if (!byName.has(params.name))
    throw protocolError(ERR_NOT_FOUND, "NotFound", { kind: "event", name: params.name });
  const args = validateArguments(params.name, params.arguments);
  const parsed = parseLink(args.diagram)!;
  const id = await subscriptionId(
    principal,
    params.delivery.url,
    params.name,
    parsed.id,
    await sha256(parsed.key),
    args.include_agent === true,
  );
  await removeSubscription(env, id);
  return {};
}

/** Resolve the `diagram` argument to an authorized diagram id, or refuse. */
async function resolveDiagram(
  env: Env,
  args: Record<string, unknown> | undefined,
): Promise<string> {
  const link = args?.diagram;
  if (typeof link !== "string" || !link) throw invalidParams("`diagram` is required");
  const parsed = parseLink(link);
  if (!parsed)
    throw invalidParams("`diagram` must be the share link, e.g. https://…/d/<id>?k=<key>");
  const row = await verifyKey(env, parsed.id, parsed.key);
  // A bad or revoked link is Forbidden rather than NotFound, which would tell an
  // unauthorized caller whether the diagram exists.
  if (!row)
    throw protocolError(ERR_FORBIDDEN, "Forbidden", { reason: "diagram link is not valid" });
  return row.id;
}

/**
 * The subscription key from the spec: principal, delivery URL, event name and
 * arguments, compared by canonical JSON. Arguments contribute the diagram id and
 * filters rather than the raw link, so the capability key never reaches storage.
 */
async function subscriptionId(
  principal: McpPrincipal,
  url: string,
  name: string,
  diagramId: string,
  keyHash: string,
  includeAgent: boolean,
): Promise<string> {
  const canonical = JSON.stringify([
    principal.userId,
    principal.authorizationId,
    url,
    name,
    diagramId,
    keyHash,
    includeAgent,
  ]);
  return `sub_${(await sha256(canonical)).slice(0, 24)}`;
}

function grantTtl(requested: number | null | undefined): number {
  // A null ttlMs asks for no expiry, which we decline by granting a finite one.
  const wanted = typeof requested === "number" && requested > 0 ? requested : DEFAULT_TTL_MS;
  return Math.min(Math.max(wanted, MIN_TTL_MS), MAX_TTL_MS);
}

// ---------- delivery, called from the room ----------

/**
 * Deliver one occurrence to everyone watching a diagram. An unreachable callback
 * must never delay or fail a human's edit, so callers run this in waitUntil.
 */
export async function deliverDiagramEvent(
  env: Env,
  diagramId: string,
  name: string,
  data: Record<string, unknown>,
): Promise<void> {
  const subs = await subscriptionsFor(env, diagramId, name);
  const event: DeliveryBody = {
    eventId: `evt_${crypto.randomUUID()}`,
    name,
    timestamp: new Date().toISOString(),
    data,
    cursor: null,
  };
  await Promise.all(
    subs.map(async (sub) => {
      // Agent edits are withheld unless this subscriber asked for them, so an
      // agent never reacts to the change it just made.
      if (name === "diagram.changed" && data.origin === "agent" && !sub.includeAgent) return;
      await sendWithBackoff(env, sub, event);
    }),
  );
}

async function subscriptionsFor(env: Env, diagramId: string, name: string) {
  await ensureSchema(env);
  const { results } = await env.DB.prepare(
    `SELECT s.*, a.* FROM event_subscriptions s
       JOIN event_subscription_access a ON a.id = s.id
      WHERE s.diagram_id = ? AND s.event_name = ? AND s.expires_at > ?`,
  )
    .bind(diagramId, name, Date.now())
    .all<SubscriptionRow>();
  return results.map(rowToSubscription);
}

function rowToSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    userId: row.user_id,
    authorizationId: row.authorization_id,
    resource: row.resource,
    keyHash: row.key_hash,
    previousSecret: row.previous_secret,
    previousSecretUntil: row.previous_secret_until,
    eventName: row.event_name,
    diagramId: row.diagram_id,
    callbackUrl: row.callback_url,
    secret: row.secret,
    includeAgent: row.include_agent === 1,
    expiresAt: row.expires_at,
  };
}

async function sendWithBackoff(env: Env, sub: Subscription, body: DeliveryBody): Promise<boolean> {
  // Standard Webhooks ties the signature to the message id, and the spec says an
  // event delivery is identified by its eventId while a control envelope uses
  // msg_<type>_<random>. The id is stable across retries, so the receiver can dedupe.
  const msgId = "eventId" in body ? body.eventId : `msg_${body.type}_${crypto.randomUUID()}`;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // oxlint-disable-next-line no-await-in-loop -- one attempt at a time, by design
    const active = await activeSubscription(env, sub);
    if (!active) return false;
    // oxlint-disable-next-line no-await-in-loop -- sign a fresh attempt after checking access
    const res = await post(env, active, msgId, body);
    if (res && res.status >= 200 && res.status < 300) return true;
    // 410 and 413 are the endpoint saying never to retry this delivery.
    if (res?.status === 410) {
      // oxlint-disable-next-line no-await-in-loop -- a gone callback cancels this subscription
      await removeSubscription(env, sub.id);
      return false;
    }
    if (res?.status === 413) return false;
    if (res && res.status < 500 && res.status !== 408 && res.status !== 429) return false;
    if (attempt < MAX_ATTEMPTS) {
      // oxlint-disable-next-line no-await-in-loop -- backoff is the point
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }
  return false;
}

/** One signed POST. The body is serialized once: the signature covers these exact bytes. */
async function post(
  env: Env,
  sub: Subscription,
  msgId: string,
  body: DeliveryBody,
): Promise<PostResult> {
  validateCallbackUrl(sub.callbackUrl);
  const text = JSON.stringify(body);
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    console.error("mcp events: payload too large", msgId);
    return null;
  }
  const timestamp = Math.floor(Date.now() / 1000);
  try {
    await checkCallbackDestination(env, sub.callbackUrl);
    const res = await fetch(sub.callbackUrl, {
      method: "POST",
      // A redirect can point at an internal address that the subscribe-time check missed.
      redirect: "error",
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        "webhook-id": msgId,
        "webhook-timestamp": String(timestamp),
        "webhook-signature": await signatures(sub, msgId, timestamp, text),
        "X-MCP-Subscription-Id": sub.id,
      },
      body: text,
    });
    if (!("type" in body)) {
      await res.body?.cancel();
      return { status: res.status, body: "" };
    }
    return { status: res.status, body: await boundedResponse(res) };
  } catch {
    return null;
  }
}

/** Ask the endpoint to prove it wants deliveries before we start sending them. */
async function verifyCallback(env: Env, sub: Subscription): Promise<boolean> {
  const challenge = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const res = await post(env, sub, `msg_verification_${crypto.randomUUID()}`, {
    type: "verification",
    challenge,
  });
  if (!res || res.status < 200 || res.status >= 300) return false;
  // The echo has to come back and match, compared in constant time.
  let echoed: unknown;
  try {
    echoed = (JSON.parse(res.body) as ChallengeEcho).challenge;
  } catch {
    return false;
  }
  if (typeof echoed !== "string") return false;
  // Web Crypto verifies MACs in constant time on both Workers and Node.
  const key = await crypto.subtle.importKey(
    "raw",
    crypto.getRandomValues(new Uint8Array(32)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(challenge));
  return crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(echoed));
}

function wasVerified(userId: string, url: string): boolean {
  const key = JSON.stringify([userId, url]);
  const until = verified.get(key);
  if (until === undefined) return false;
  if (until < Date.now()) {
    verified.delete(key);
    return false;
  }
  return true;
}

function markVerified(userId: string, url: string) {
  for (const [key, until] of verified) if (until < Date.now()) verified.delete(key);
  if (verified.size >= 1024) verified.delete(verified.keys().next().value!);
  verified.set(JSON.stringify([userId, url]), Date.now() + VERIFICATION_TTL_MS);
}

/** Never echo a callback's path and query back to it in an error. */
function redacted(url: string): string {
  return `${new URL(url).origin}/…`;
}

// ---------- Standard Webhooks ----------

function decodeSecret(secret: string): Uint8Array {
  if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)) throw new Error("missing whsec_ prefix");
  return Uint8Array.from(atob(secret.slice("whsec_".length)), (c) => c.charCodeAt(0));
}

function assertSecretLength(secret: string): void {
  let bytes: Uint8Array;
  try {
    bytes = decodeSecret(secret);
  } catch {
    throw invalidParams("delivery.secret must be whsec_ followed by base64 of 24-64 bytes");
  }
  if (bytes.length < 24 || bytes.length > 64)
    throw invalidParams("delivery.secret must be whsec_ followed by base64 of 24-64 bytes");
}

/** `v1,<base64 HMAC-SHA256(secretBytes, "<msgId>.<timestamp>.<body>")>` */
async function sign(
  secret: string,
  msgId: string,
  timestamp: number,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    decodeSecret(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${msgId}.${timestamp}.${body}`),
  );
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`;
}

// ---------- errors and small helpers ----------

function protocolError(code: number, message: string, data?: unknown): ProtocolError {
  return new ProtocolError(code, message, data);
}

function invalidParams(message: string): ProtocolError {
  return protocolError(ERR_INVALID_PARAMS, "InvalidParams", { reason: message });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const diagramArguments = z.strictObject({ diagram: z.string().min(1) });
const changedArguments = diagramArguments.extend({ include_agent: z.boolean().optional() });
type EventArguments = z.infer<typeof changedArguments>;
type KeyHashRow = { key_hash: string };

function validateArguments(
  name: string,
  args: Record<string, unknown> | undefined,
): EventArguments {
  const result = (name === "diagram.changed" ? changedArguments : diagramArguments).safeParse(args);
  if (!result.success) throw invalidParams("arguments do not match the event inputSchema");
  if (!parseLink(result.data.diagram)) throw invalidParams("diagram must be a valid share link");
  return result.data;
}

function requireRead(principal: McpPrincipal): void {
  if (!principal.scopes.includes("mcp:read"))
    throw protocolError(ERR_FORBIDDEN, "Forbidden", { reason: "mcp:read is required" });
}

function validateCallbackUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidParams("delivery.url must be an HTTPS URL");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  // Global fetch uses Cloudflare's public network (global_fetch_strictly_public).
  // Reject literal IPs and local hostnames as well, and never follow redirects.
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    !host.includes(".") ||
    host.startsWith("[") ||
    /^[\d.]+$/.test(host) ||
    ["localhost", "local", "internal", "home", "test", "invalid"].some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    )
  )
    throw invalidParams(
      "delivery.url must identify a public HTTPS hostname without credentials or a fragment",
    );
}

async function signatures(
  sub: Subscription,
  id: string,
  at: number,
  body: string,
): Promise<string> {
  const current = await sign(sub.secret, id, at, body);
  return sub.previousSecret && sub.previousSecretUntil > Date.now()
    ? `${current} ${await sign(sub.previousSecret, id, at, body)}`
    : current;
}

async function removeSubscription(env: Env, id: string): Promise<void> {
  await ensureSchema(env);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM event_subscriptions WHERE id = ?").bind(id),
    env.DB.prepare("DELETE FROM event_subscription_access WHERE id = ?").bind(id),
  ]);
}

/** Recheck consent, capability, expiry and unsubscribe before every delivery attempt. */
async function activeSubscription(env: Env, sub: Subscription): Promise<Subscription | null> {
  const current = await env.DB.prepare(
    "SELECT s.*, a.* FROM event_subscriptions s JOIN event_subscription_access a ON a.id = s.id WHERE s.id = ?",
  )
    .bind(sub.id)
    .first<SubscriptionRow>();
  if (!current || current.expires_at <= Date.now()) return null;
  const key = await env.DB.prepare(
    "SELECT key_hash FROM diagrams WHERE id = ? AND NOT EXISTS (SELECT 1 FROM deleted_diagrams WHERE diagram_id = ?)",
  )
    .bind(sub.diagramId, sub.diagramId)
    .first<KeyHashRow>();
  const { eventAuthorizationActive } = await import("./oauth.ts");
  if (
    !key ||
    key.key_hash !== sub.keyHash ||
    !(await eventAuthorizationActive(env, sub.userId, sub.authorizationId, sub.resource))
  ) {
    await removeSubscription(env, sub.id);
    return null;
  }
  return rowToSubscription(current);
}
