import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import worker from "@/worker/index.ts";
import { sha256 } from "@/worker/store.ts";
import { AUTH_ISSUER } from "@/worker/oidc.ts";
import { authServer } from "@test/helpers/auth-server.ts";
import { makeEnv, testCtx } from "@test/helpers/fakes.ts";
import { requiredTestValue } from "@test/helpers/required-test-value.ts";

type AuthServer = Awaited<ReturnType<typeof authServer>>;

let server: AuthServer;

let env: ReturnType<typeof makeEnv>;

function request(path: string, cookie = "", method = "GET") {
  return worker.fetch(
    new Request(`https://design.example${path}`, {
      method,
      headers: { Cookie: cookie, Origin: "https://design.example" },
    }),
    env.env,
    testCtx(),
  );
}

function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}

async function start() {
  const response = await request("/api/auth/login");
  expect(response.status).toBe(302);
  const destination = new URL(requiredTestValue(response.headers.get("Location")));
  server.authorize(destination);
  const path = `/api/auth/callback?${new URLSearchParams({ code: "test-code", state: requiredTestValue(destination.searchParams.get("state")), iss: AUTH_ISSUER }).toString()}`;

  return { response, destination, path, cookie: cookies(response) };
}

beforeEach(async () => {
  env = makeEnv();
  env.env.AUTH_CLIENT_ID = "test-client";
  env.env.AUTH_CLIENT_SECRET = "test-secret";
  server = await authServer();
  vi.stubGlobal("fetch", server.upstream);
});

afterEach(() => vi.unstubAllGlobals());

describe("shared Auth sign-in", () => {
  it("uses OIDC PKCE, verifies a signed identity, creates a private session and logs out", async () => {
    const login = await start();
    expect(login.destination.origin).toBe("https://auth.aranlucas.workers.dev");
    expect(login.destination.searchParams.get("scope")).toBe("openid");
    expect(login.destination.searchParams.get("code_challenge_method")).toBe("S256");
    expect(login.destination.searchParams.get("redirect_uri")).toBe(
      "https://design.example/api/auth/callback",
    );
    expect(login.destination.searchParams.has("client_secret")).toBe(false);
    expect((await request(login.path)).status).toBe(400);
    const response = await request(login.path, login.cookie);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
    const cookie = cookies(response);
    expect(cookie).toContain("__Host-sdc-session=");
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly; SameSite=Lax");
    expect(response.headers.get("Set-Cookie")).toContain("Secure");
    expect((await request("/api/diagrams", cookie)).status).toBe(200);

    const tokenRequest = requiredTestValue(
      server.upstream.mock.calls.find(([input]) =>
        (input instanceof Request ? input.url : input.toString()).endsWith("/oauth2/token"),
      ),
    );

    const body = new URLSearchParams(z.instanceof(URLSearchParams).parse(tokenRequest[1]?.body));
    expect(body.get("code_verifier")).toBeTruthy();
    expect(body.get("redirect_uri")).toBe("https://design.example/api/auth/callback");
    expect(new Headers(tokenRequest[1]?.headers).get("Authorization")).toBe(
      `Basic ${btoa("test%2Dclient:test%2Dsecret")}`,
    );
    const stored = JSON.stringify([...env.kv.values.values()]);
    expect(stored).toContain("auth%3A123");
    expect(stored).not.toContain("upstream-token");
    expect((await request(login.path, login.cookie)).status).toBe(400);
    expect((await request("/api/auth/logout", cookie, "POST")).status).toBe(204);
    expect((await request("/api/diagrams", cookie)).status).toBe(401);
  });

  it.each(["issuer", "audience", "nonce", "expiry", "signature"])(
    "rejects an invalid ID token %s",
    async (field) => {
      const sessions = [...env.kv.values.keys()].filter((key) =>
        key.startsWith("browser-session:"),
      );

      const login = await start();

      if (field === "issuer") {
        server.overrideClaims({ iss: "https://attacker.example" });
      }

      if (field === "audience") {
        server.overrideClaims({ aud: "another-client" });
      }

      if (field === "nonce") {
        server.overrideClaims({ nonce: "attacker" });
      }

      if (field === "expiry") {
        server.overrideClaims({ exp: 1 });
      }

      if (field === "signature") {
        server.corruptSignature();
      }

      const response = await request(login.path, login.cookie);
      expect(response.status).toBe(502);
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect([...env.kv.values.keys()].filter((key) => key.startsWith("browser-session:"))).toEqual(
        sessions,
      );
    },
  );

  it("rejects wrong state, expired logins, and cancelled sign-in without exchanging a code", async () => {
    const login = await start();
    const calls = server.upstream.mock.calls.length;
    expect(
      (await request(login.path.replace(/state=[^&]+/, "state=forged"), login.cookie)).status,
    ).toBe(400);
    const cancelled = await request(login.path + "&error=access_denied", login.cookie);
    expect(cancelled.status).toBe(302);
    expect(cancelled.headers.get("Location")).toBe("/?signin=cancelled");
    expect(server.upstream).toHaveBeenCalledTimes(calls);
    const expired = await start();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 601_000);

    try {
      expect((await request(expired.path, expired.cookie)).status).toBe(400);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("resumes the original MCP authorization after Auth sign-in", async () => {
    const registered = await worker.fetch(
      new Request("https://design.example/oauth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Agent",
          redirect_uris: ["https://client.example/callback"],
          token_endpoint_auth_method: "none",
        }),
      }),
      env.env,
      testCtx(),
    );

    const client = z.object({ client_id: z.string() }).parse(await registered.json());
    const path = `/authorize?${new URLSearchParams({ client_id: client.client_id, redirect_uri: "https://client.example/callback", response_type: "code", resource: "https://design.example/mcp", scope: "mcp:read", state: "agent-state", code_challenge: await sha256("verifier"), code_challenge_method: "S256" }).toString()}`;
    const login = await request(path);
    expect(login.status).toBe(302);
    const destination = new URL(requiredTestValue(login.headers.get("Location")));
    server.authorize(destination);
    const callback = `/api/auth/callback?${new URLSearchParams({ state: requiredTestValue(destination.searchParams.get("state")), code: "test-code", iss: AUTH_ISSUER }).toString()}`;
    const signedIn = await request(callback, cookies(login));
    expect(signedIn.headers.get("Location")).toBe(path);
    const consent = await request(path, cookies(signedIn));
    expect(consent.status).toBe(200);
    expect(await consent.text()).toContain('name="handle"');
  });
});
