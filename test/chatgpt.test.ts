import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import worker from "@/worker/index.ts";
import { chatgptAuth } from "@/worker/chatgpt.ts";
import { createDiagram } from "@/worker/store.ts";
import { makeEnv, testCtx, type TestEnv } from "@test/helpers/fakes.ts";
import { SQLiteD1 } from "@test/helpers/sqlite-d1.ts";
import { d1Adapter } from "@test/helpers/d1-adapter.ts";
import { requiredTestValue } from "@test/helpers/required-test-value.ts";

const ORIGIN = "https://design.example";

const statusSchema = z.object({ status: z.string() });

const pendingSchema = z.object({ status: z.literal("pending"), userCode: z.string() });

let env: TestEnv;

let database: SQLiteD1;

let subject = "candidate-subject";

let workspace = "test-account";

let upstream: ReturnType<typeof vi.fn<typeof fetch>>;

function request(
  path: string,
  cookie = "",
  method: string = "GET",
  body?: string,
  origin = ORIGIN,
) {
  return worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
      body,
    }),
    env.env,
    testCtx(),
  );
}

function token() {
  const payload = {
    iss: "https://auth.openai.com",
    sub: subject,
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: "candidate@example.com",
    "https://api.openai.com/auth": {
      chatgpt_account_id: workspace,
      chatgpt_plan_type: "plus",
    },
  };

  return `header.${btoa(JSON.stringify(payload))}.test-signature`;
}

beforeEach(() => {
  subject = "candidate-subject";
  workspace = "test-account";
  env = makeEnv();

  database = new SQLiteD1();

  env.env.DB = d1Adapter(database);

  env.env.LWC_SECRET = "test-only-stable-session-encryption-secret";

  upstream = vi.fn<typeof fetch>((input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));

    if (url.pathname.endsWith("/deviceauth/usercode")) {
      return Promise.resolve(
        Response.json({ device_auth_id: "device-test", user_code: "ABCD-1234", interval: 1 }),
      );
    }

    if (url.pathname.endsWith("/deviceauth/token")) {
      return Promise.resolve(
        Response.json({
          authorization_code: "test-code",
          code_verifier: "test-verifier",
          code_challenge: "test-challenge",
        }),
      );
    }

    if (url.pathname.endsWith("/oauth/token")) {
      return Promise.resolve(
        Response.json({
          access_token: token(),
          refresh_token: "test-refresh-token",
          id_token: token(),
          expires_in: 3600,
        }),
      );
    }

    if (url.pathname.endsWith("/models")) {
      return Promise.resolve(Response.json({ models: [{ slug: "account-model" }] }));
    }

    if (url.pathname.endsWith("/responses")) {
      return Promise.resolve(
        new Response("data: test-stream\n\n", { headers: { "Content-Type": "text/event-stream" } }),
      );
    }

    return Promise.reject(new Error("Unexpected upstream request"));
  });
  vi.stubGlobal("fetch", upstream);
});

afterEach(() => {
  vi.unstubAllGlobals();
  database.sql.close();
});

async function connect() {
  const response = await request("/api/chatgpt/login", "", "POST");
  expect(response.status).toBe(200);
  expect(pendingSchema.parse(await response.json()).userCode).toBe("ABCD-1234");
  expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
  expect(response.headers.get("Set-Cookie")).toContain("Secure");
  const cookie = requiredTestValue(response.headers.get("Set-Cookie")).split(";")[0];
  expect(
    statusSchema.parse(await (await request("/api/chatgpt/status", cookie)).json()).status,
  ).toBe("authenticated");

  return cookie;
}

describe("ChatGPT plan sessions", () => {
  it("uses the SDK device flow, keeps tokens encrypted in D1 and exposes only a session cookie", async () => {
    const cookie = await connect();
    const response = await request("/api/chatgpt/session", cookie);
    const publicSession = await response.text();
    expect(publicSession).toContain("authenticated");
    expect(publicSession).not.toContain("test-refresh-token");
    expect(publicSession).not.toContain("accessToken");
    const stored = JSON.stringify(database.sql.prepare("SELECT value FROM chatgpt_state").all());
    expect(stored).toContain("tokensCipher");
    expect(stored).not.toContain("test-refresh-token");
    expect(stored).not.toContain(token());
    // Rebuilding a handler on the same shared store retains the authenticated account.
    const freshEnv = { ...env.env, DB: d1Adapter(database) };
    expect(
      (await chatgptAuth(freshEnv).getSession(new Request(ORIGIN, { headers: { Cookie: cookie } })))
        .status,
    ).toBe("authenticated");
    expect(await (await request("/api/chatgpt/models", cookie)).json()).toEqual({
      models: ["account-model"],
    });
  });

  it("does not accept a workspace alone as a board owner", async () => {
    subject = "";
    const cookie = await connect();
    expect(
      z
        .object({ signedIn: z.boolean() })
        .parse(await (await request("/api/auth/session", cookie)).json()).signedIn,
    ).toBe(false);
    expect((await request("/api/diagrams", cookie)).status).toBe(401);
  });

  it("authorizes an MCP client with ChatGPT when GitHub is unavailable", async () => {
    env.env.GITHUB_CLIENT_ID = "";
    env.env.GITHUB_CLIENT_SECRET = "";

    const registered = await request(
      "/oauth/register",
      "",
      "POST",
      JSON.stringify({
        client_name: "ChatGPT test agent",
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "none",
      }),
    );

    expect(registered.status).toBe(201);
    const client = z.object({ client_id: z.string() }).parse(await registered.json());
    const verifier = crypto.randomUUID() + crypto.randomUUID();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));

    const challenge = btoa(String.fromCodePoint(...new Uint8Array(digest)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");

    const query = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: "https://client.example/callback",
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: `${ORIGIN}/mcp`,
      scope: "mcp:read mcp:write",
      state: "test-state",
    });

    const path = `/authorize?${query.toString()}`;
    const anonymous = await request(path);
    expect(anonymous.status).toBe(302);
    expect(
      new URL(requiredTestValue(anonymous.headers.get("Location"))).searchParams.get("authorize"),
    ).toBe(path);
    const cookie = await connect();
    const consent = await request(path, cookie);
    expect(consent.status).toBe(200);
    const handle = requiredTestValue(/name="handle" value="([^"]+)"/.exec(await consent.text()))[1];

    const consentCookie = consent.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");

    const approved = await worker.fetch(
      new Request(`${ORIGIN}/authorize`, {
        method: "POST",
        headers: { Origin: ORIGIN, Cookie: `${cookie}; ${consentCookie}` },
        body: new URLSearchParams({ handle, decision: "allow", scope: "mcp:read" }),
      }),
      env.env,
      testCtx(),
    );

    expect(approved.status).toBe(302);
    const callback = new URL(requiredTestValue(approved.headers.get("Location")));
    expect(callback.origin).toBe("https://client.example");
    expect(callback.searchParams.get("state")).toBe("test-state");
    const code = requiredTestValue(callback.searchParams.get("code"));

    const exchanged = await worker.fetch(
      new Request(`${ORIGIN}/oauth/token`, {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: client.client_id,
          code,
          redirect_uri: "https://client.example/callback",
          code_verifier: verifier,
          resource: `${ORIGIN}/mcp`,
        }),
      }),
      env.env,
      testCtx(),
    );

    expect(exchanged.status).toBe(200);

    const granted = z
      .object({ access_token: z.string(), scope: z.string() })
      .parse(await exchanged.json());

    expect(granted.scope).toBe("mcp:read");
    expect(
      upstream.mock.calls.every(
        ([input]) => !(input instanceof Request ? input.url : String(input)).includes("github.com"),
      ),
    ).toBe(true);
  });

  it("creates a private board using ChatGPT without GitHub and signs out both sessions", async () => {
    env.env.GITHUB_CLIENT_ID = "";
    env.env.GITHUB_CLIENT_SECRET = "";
    const staleGithubLink = await request("/api/auth/login");
    expect(staleGithubLink.status).toBe(302);
    expect(staleGithubLink.headers.get("Location")).toBe("/");
    const cookie = await connect();
    const state = await request("/api/auth/session", cookie);
    expect(await state.json()).toEqual({
      signedIn: true,
      githubEnabled: false,
      chatgptEnabled: true,
    });

    const created = await request(
      "/api/diagrams",
      cookie,
      "POST",
      JSON.stringify({ name: "ChatGPT board" }),
    );

    expect(created.status).toBe(200);
    const firstBoard = z.object({ id: z.string() }).parse(await created.json());
    const library = await request("/api/diagrams", cookie);
    expect(
      z
        .object({ items: z.array(z.object({ id: z.string() })) })
        .parse(await library.json())
        .items.map((item) => item.id),
    ).toEqual([firstBoard.id]);
    // Another person in the same workspace cannot see this user's boards.
    subject = "another-person";
    const anotherCookie = await connect();
    expect(
      z
        .object({ items: z.array(z.unknown()) })
        .parse(await (await request("/api/diagrams", anotherCookie)).json()).items,
    ).toEqual([]);
    workspace = "another-workspace";
    const workspaceCookie = await connect();
    expect(
      z
        .object({ items: z.array(z.unknown()) })
        .parse(await (await request("/api/diagrams", workspaceCookie)).json()).items,
    ).toEqual([]);
    workspace = "test-account";
    // Reconnecting the original person resolves to the same stable owner.
    subject = "candidate-subject";
    const returningCookie = await connect();
    expect(
      z
        .object({ items: z.array(z.object({ id: z.string() })) })
        .parse(await (await request("/api/diagrams", returningCookie)).json()).items[0].id,
    ).toBe(firstBoard.id);
    const logout = await request("/api/auth/logout", returningCookie, "POST");
    expect(logout.status).toBe(204);
    expect(logout.headers.getSetCookie().some((value) => value.startsWith("lwc_session="))).toBe(
      true,
    );
    expect(
      z
        .object({ signedIn: z.boolean() })
        .parse(await (await request("/api/auth/session", returningCookie)).json()).signedIn,
    ).toBe(false);
  });

  it("proxies responses with server-held credentials and removes the session on disconnect", async () => {
    const cookie = await connect();

    const response = await request(
      "/api/chatgpt/responses",
      cookie,
      "POST",
      JSON.stringify({ model: "account-model", input: "What fails first?" }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("test-stream");

    const responseRequest = requiredTestValue(
      upstream.mock.calls.find(([input]) =>
        (input instanceof Request ? input.url : String(input)).includes("/responses"),
      ),
    );

    expect(new Headers(responseRequest[1]?.headers).get("Authorization")).toBe(`Bearer ${token()}`);
    await request("/api/chatgpt/logout", cookie, "POST");
    expect(
      statusSchema.parse(await (await request("/api/chatgpt/session", cookie)).json()).status,
    ).toBe("unauthenticated");
    expect((await request("/api/chatgpt/models", cookie)).status).toBe(401);
    expect((await request("/api/chatgpt/responses", cookie, "POST", "{}")).status).toBe(401);
  });

  it("rejects cross-origin login and logout and refuses an unconfigured deployment", async () => {
    expect(
      (await request("/api/chatgpt/login", "", "POST", undefined, "https://attacker.example"))
        .status,
    ).toBe(403);
    expect(
      (await request("/api/chatgpt/logout", "", "POST", undefined, "https://attacker.example"))
        .status,
    ).toBe(403);
    delete env.env.LWC_SECRET;
    expect((await request("/api/chatgpt/login", "", "POST")).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("requires the board capability before returning interviewer context", async () => {
    const board = await createDiagram(env.env, "Practice");
    const response = await request(`/api/d/${board.id}/interview-context?k=${board.key}`);
    expect(response.status).toBe(200);
    expect(z.object({ scene: z.string() }).parse(await response.json()).scene).toContain(
      "Practice",
    );
    expect((await request(`/api/d/${board.id}/interview-context?k=wrong`)).status).toBe(403);
  });
});
