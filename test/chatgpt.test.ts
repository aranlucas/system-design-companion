import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import worker from "@/worker/index.ts";
import { createDiagram } from "@/worker/store.ts";
import { chatgptAuth } from "@/worker/chatgpt.ts";
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
      return Promise.resolve(Response.json({ models: [{ slug: "gpt-5.5" }] }));
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
      models: ["gpt-5.5"],
    });
  });

  it("limits inference to the fixed interviewer model before contacting OpenAI", async () => {
    const cookie = await connect();
    const calls = upstream.mock.calls.length;

    const response = await request(
      "/api/chatgpt/responses",
      cookie,
      "POST",
      JSON.stringify({ model: "unconfigured-model", input: [] }),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("model_not_allowed");
    expect(upstream.mock.calls).toHaveLength(calls);
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

  it("keeps ChatGPT inference credentials separate from workspace sign-in", async () => {
    const cookie = await connect();
    const state = await request("/api/auth/session", cookie);
    expect(await state.json()).toEqual({ signedIn: false, authEnabled: false });
    expect((await request("/api/diagrams", cookie)).status).toBe(401);
    expect((await request("/api/auth/login")).status).toBe(503);
    const logout = await request("/api/auth/logout", cookie, "POST");
    expect(logout.status).toBe(204);
    expect(logout.headers.getSetCookie().some((value) => value.startsWith("lwc_session="))).toBe(
      true,
    );
    expect(await (await request("/api/chatgpt/session", cookie)).json()).toMatchObject({
      status: "unauthenticated",
    });
  });

  it("proxies responses with server-held credentials and removes the session on disconnect", async () => {
    const cookie = await connect();

    const response = await request(
      "/api/chatgpt/responses",
      cookie,
      "POST",
      JSON.stringify({ model: "gpt-5.5", input: "What fails first?" }),
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
