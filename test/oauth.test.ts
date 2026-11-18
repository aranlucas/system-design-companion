import { sha256 } from "@/shared/identity.ts";
import { promiseResult } from "@/shared/promise-result.ts";
import { requiredTestValue } from "@test/helpers/required-test-value.ts";
import type { JsonInput } from "@test/helpers/response-schemas.ts";
import { z } from "zod";
import { jsonObjectSchema, rpcResultSchema, tokensSchema } from "@test/helpers/response-schemas.ts";
// Exercise the real OAuth provider with private browser sessions and fake storage.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "@/worker/index.ts";
import { deliverDiagramEvent } from "@/worker/events.ts";
import { createDiagram, shareLink } from "@/worker/store.ts";
import { makeEnv, testCtx, type TestEnv } from "@test/helpers/fakes.ts";

const ORIGIN = "https://design.example";

const RESOURCE = `${ORIGIN}/mcp`;

const RESOURCE_METADATA = `${ORIGIN}/.well-known/oauth-protected-resource/mcp`;

const REDIRECT = "https://client.example/callback";

const VERSION = "2026-07-28";

type Client = { client_id: string };

type Tokens = { access_token: string; refresh_token: string };

type Authorization = { clientId: string; verifier: string; callback: Response };

type TokenError = { error: string };

type RpcResult = {
  result?: { events?: unknown[]; capabilities?: Record<string, JsonInput> };
  error?: unknown;
};

let env: TestEnv;

type UpstreamFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

let upstream: ReturnType<typeof vi.fn<UpstreamFetch>>;

beforeEach(() => {
  env = makeEnv();
  env.env.AUTH_CLIENT_ID = "upstream-client";
  env.env.AUTH_CLIENT_SECRET = "upstream-secret";
  vi.stubGlobal("Cloudflare", { compatibilityFlags: { global_fetch_strictly_public: true } });
  upstream = vi.fn((input: string | URL) =>
    Promise.reject(new Error(`Unexpected external request: ${String(input)}`)),
  );
  vi.stubGlobal("fetch", upstream);
});

afterEach(() => vi.unstubAllGlobals());

function call(path: string, init?: RequestInit) {
  return worker.fetch(new Request(new URL(path, ORIGIN), init), env.env, testCtx());
}

function cookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

async function client(): Promise<string> {
  const response = await call("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Test agent",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
    }),
  });

  expect(response.status).toBe(201);
  const registered: Client = await response.json();

  return registered.client_id;
}

async function consent(scope = "mcp:read mcp:write") {
  const clientId = await client();
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));

  const challenge = btoa(String.fromCodePoint(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
    scope,
    state: "client-state",
  });

  const sessionToken = crypto.randomUUID();
  await env.kv.put(
    `browser-session:${await sha256(sessionToken)}`,
    JSON.stringify({ userId: "auth%3A123", expiresAt: Date.now() + 3600_000 }),
  );
  const sessionCookie = `__Host-sdc-session=${sessionToken}`;
  const page = await call(`/authorize?${query.toString()}`, { headers: { cookie: sessionCookie } });
  expect(page.status).toBe(200);
  expect(page.headers.get("content-security-policy")).toContain("frame-ancestors");
  const html = await page.text();
  const handle = requiredTestValue(/name="handle" value="([^"]+)"/.exec(html))[1];

  return { clientId, verifier, handle, cookie: `${sessionCookie}; ${cookies(page)}`, html };
}

async function authorize(scope = "mcp:read mcp:write"): Promise<Authorization> {
  const started = await consent(scope);
  const form = new URLSearchParams({ handle: started.handle, decision: "allow" });

  for (const item of scope.split(" ")) {
    form.append("scope", item);
  }

  const approved = await call("/authorize", {
    method: "POST",
    headers: { cookie: started.cookie },
    body: form,
  });

  expect(approved.status).toBe(302);
  const callback = approved;

  expect(callback.status).toBe(302);
  const redirected = new URL(requiredTestValue(callback.headers.get("location")));
  expect(redirected.origin + redirected.pathname).toBe(REDIRECT);
  expect(redirected.searchParams.get("state")).toBe("client-state");
  expect(redirected.searchParams.get("code")).toBeTruthy();

  return { clientId: started.clientId, verifier: started.verifier, callback };
}

function exchange(authorization: Authorization, overrides: Record<string, string> = {}) {
  return call("/oauth/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: authorization.clientId,
      redirect_uri: REDIRECT,
      code: requiredTestValue(
        new URL(requiredTestValue(authorization.callback.headers.get("location"))).searchParams.get(
          "code",
        ),
      ),
      code_verifier: authorization.verifier,
      resource: RESOURCE,
      ...overrides,
    }),
  });
}

async function tokens(scope = "mcp:read mcp:write") {
  const auth = await authorize(scope);
  const response = await exchange(auth);
  expect(response.status).toBe(200);

  return { auth, tokens: tokensSchema.parse(await response.json()) satisfies Tokens };
}

function rpc(token: string, method: string, params: Record<string, JsonInput> = {}) {
  const headers = new Headers({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/json",
    "mcp-protocol-version": VERSION,
    "mcp-method": method,
  });

  const requestName = z.string().safeParse(params.name);

  if (requestName.success) {
    headers.set("mcp-name", requestName.data);
  }

  return call("/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": VERSION,
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
        },
      },
    }),
  });
}

async function rpcBody(response: Response): Promise<RpcResult> {
  const text = await response.text();

  const frame = text
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice(6);

  return rpcResultSchema.parse(JSON.parse(frame ?? text)) satisfies RpcResult;
}

describe("OAuth authorization", () => {
  it("publishes the authorization server metadata reached through resource discovery", async () => {
    const resource = await call(RESOURCE_METADATA);
    expect(resource.status).toBe(200);
    const metadata = jsonObjectSchema.parse(await resource.json());
    expect(metadata).toMatchObject({
      resource: RESOURCE,
      authorization_servers: [ORIGIN],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp:read"],
    });

    const issuer = z.array(z.string()).parse(metadata.authorization_servers)[0];
    const server = await call(`${issuer}/.well-known/oauth-authorization-server`);
    expect(server.status).toBe(200);
    const serverMetadata = jsonObjectSchema.parse(await server.json());
    expect(serverMetadata).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["mcp:read", "mcp:write"],
    });
    expect(serverMetadata.grant_types_supported).toContain("authorization_code");
    expect(serverMetadata.grant_types_supported).toContain("refresh_token");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("challenges an unrecognized bearer token as invalid", async () => {
    const response = await rpc("invalid-token", "events/list");
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
    expect(response.headers.get("WWW-Authenticate")).toContain(
      `resource_metadata="${RESOURCE_METADATA}"`,
    );
    expect(response.headers.get("WWW-Authenticate")).toContain('scope="mcp:read"');
  });

  it("challenges an expired issued token and accepts a refreshed token without upstream Auth", async () => {
    const auth = await authorize();
    const issued = await exchange(auth);
    expect(issued.status).toBe(200);

    const { access_token, refresh_token, expires_in } = tokensSchema
      .extend({ expires_in: z.number().int().positive() })
      .parse(await issued.json());

    expect((await rpc(access_token, "events/list")).status).toBe(200);

    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + (expires_in + 1) * 1000);

    try {
      const expired = await rpc(access_token, "events/list");
      expect(expired.status).toBe(401);
      expect(expired.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
      expect(expired.headers.get("WWW-Authenticate")).toContain(
        `resource_metadata="${RESOURCE_METADATA}"`,
      );
      expect(expired.headers.get("WWW-Authenticate")).toContain('scope="mcp:read"');

      const refresh = await call("/oauth/token", {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: auth.clientId,
          refresh_token,
          resource: RESOURCE,
        }),
      });

      expect(refresh.status).toBe(200);
      const replacement = tokensSchema.parse(await refresh.json());
      expect((await rpc(replacement.access_token, "events/list")).status).toBe(200);
      expect(upstream).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });

  it("completes consent, Auth session, token exchange and authenticated event discovery", async () => {
    const { tokens: issued } = await tokens();

    expect(issued.access_token).not.toBe("upstream-upstream-token");
    expect(issued.access_token.startsWith("auth%3A123:")).toBe(true);
    const response = await rpc(issued.access_token, "events/list");
    expect(response.status).toBe(200);
    expect((await rpcBody(response)).result?.events).toHaveLength(3);
    expect(JSON.stringify([...env.kv.values.values()])).not.toContain("upstream-upstream-token");
    const discovery = await rpc(issued.access_token, "server/discover");
    expect((await rpcBody(discovery)).result?.capabilities?.events).toEqual({});
  });

  it("stops persisted webhook subscriptions after a real OAuth grant revocation", async () => {
    const { auth, tokens: issued } = await tokens();
    const diagram = await createDiagram(env.env, "Watched");
    const deliveries: string[] = [];
    const originalFetch = requiredTestValue(upstream.getMockImplementation());
    upstream.mockImplementation((input: string | URL, init?: RequestInit) => {
      return promiseResult(() => {
        const url = new URL(input);

        if (url.hostname === "cloudflare-dns.com") {
          return Response.json({ Status: 0, TC: false, Answer: [{ type: 1, data: "8.8.8.8" }] });
        }

        if (url.hostname === "receiver.example.com") {
          const body = jsonObjectSchema.parse(JSON.parse(z.string().parse(init?.body)));

          if (body.type === "verification") {
            return Response.json({ challenge: body.challenge });
          }

          deliveries.push(z.string().parse(init?.body));

          return new Response(null, { status: 204 });
        }

        return originalFetch(input, init);
      });
    });

    const subscription = await rpc(issued.access_token, "events/subscribe", {
      name: "diagram.renamed",
      arguments: { diagram: shareLink(ORIGIN, diagram.id, diagram.key) },
      delivery: {
        mode: "webhook",
        url: "https://receiver.example.com/events",
        secret: `whsec_${btoa("0123456789abcdef01234567")}`,
      },
    });

    expect((await rpcBody(subscription)).error).toBeUndefined();
    expect(env.db.event_subscriptions.size).toBe(1);
    await deliverDiagramEvent(env.env, diagram.id, "diagram.renamed", {
      diagram_id: diagram.id,
      name: "Before",
    });
    expect(deliveries).toHaveLength(1);

    const revoke = await call("/oauth/token", {
      method: "POST",
      body: new URLSearchParams({
        token: issued.refresh_token,
        token_type_hint: "refresh_token",
        client_id: auth.clientId,
      }),
    });

    expect(revoke.status).toBe(200);
    await deliverDiagramEvent(env.env, diagram.id, "diagram.renamed", {
      diagram_id: diagram.id,
      name: "After",
    });
    expect(deliveries).toHaveLength(1);
    expect(env.db.event_subscriptions.size).toBe(0);
  });

  it("requires read access even if a token has write access", async () => {
    const { tokens: issued } = await tokens("mcp:write");
    const response = await rpc(issued.access_token, "events/list");
    expect(response.status).toBe(403);
    const challenge = requiredTestValue(response.headers.get("WWW-Authenticate"));
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain('scope="mcp:read"');
    expect(challenge).toContain(`resource_metadata="${RESOURCE_METADATA}"`);
  });

  it("permits reads and challenges writes before a read-only token mutates anything", async () => {
    const { tokens: issued } = await tokens("mcp:read");
    expect((await rpc(issued.access_token, "events/list")).status).toBe(200);

    const response = await rpc(issued.access_token, "tools/call", {
      name: "create_diagram",
      arguments: { name: "Forbidden" },
    });

    expect(response.status).toBe(403);
    const challenge = requiredTestValue(response.headers.get("WWW-Authenticate"));
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain('scope="mcp:read mcp:write"');
    expect(challenge).toContain(`resource_metadata="${RESOURCE_METADATA}"`);
    expect(env.db.diagrams.size).toBe(0);
  });

  it("rejects an incorrect PKCE verifier and never redeems an authorization code twice", async () => {
    const auth = await authorize();
    const bad = await exchange(auth, { code_verifier: "wrong" });
    expect(bad.status).toBe(400);
    const error: TokenError = await bad.json();
    expect(error.error).toBe("invalid_grant");
    expect((await exchange(auth)).status).toBe(200);
    expect((await exchange(auth)).status).toBe(400);
  });

  it("rejects a token request for a different protected resource", async () => {
    const auth = await authorize();
    const bad = await exchange(auth, { resource: "https://other.example/mcp" });
    expect(bad.status).toBe(400);
  });

  it("refreshes tokens and revokes the installation through the advertised endpoint", async () => {
    const { auth, tokens: issued } = await tokens();

    const refreshed = await call("/oauth/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: auth.clientId,
        refresh_token: issued.refresh_token,
        resource: RESOURCE,
      }),
    });

    expect(refreshed.status).toBe(200);
    const replacement = tokensSchema.parse(await refreshed.json()) satisfies Tokens;
    expect((await rpc(replacement.access_token, "events/list")).status).toBe(200);

    const revoked = await call("/oauth/token", {
      method: "POST",
      body: new URLSearchParams({
        token: replacement.refresh_token,
        token_type_hint: "refresh_token",
        client_id: auth.clientId,
      }),
    });

    expect(revoked.status).toBe(200);
    const rejected = await rpc(replacement.access_token, "events/list");
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
  });

  it("rejects a consent POST without its browser binding cookie", async () => {
    const started = await consent();

    const response = await call("/authorize", {
      method: "POST",
      body: new URLSearchParams({
        handle: started.handle,
        decision: "allow",
        scope: "mcp:read",
      }),
    });

    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("denies consent without contacting Auth", async () => {
    const started = await consent();

    const response = await call("/authorize", {
      method: "POST",
      headers: { cookie: started.cookie },
      body: new URLSearchParams({ handle: started.handle, decision: "deny" }),
    });

    expect(response.status).toBe(302);
    expect(
      new URL(requiredTestValue(response.headers.get("location"))).searchParams.get("error"),
    ).toBe("access_denied");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects forged upstream state and unsupported route methods", async () => {
    expect((await call("/api/auth/callback?state=forged&code=attacker")).status).toBe(400);
    expect(
      (await call("/api/auth/callback", { method: "POST", headers: { Origin: ORIGIN } })).status,
    ).toBe(405);
    expect((await call("/authorize", { method: "PUT" })).status).toBe(405);
    expect(upstream).not.toHaveBeenCalled();
  });
});
