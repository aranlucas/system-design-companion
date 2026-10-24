import { HTTPException } from "hono/http-exception";
import { sha256 } from "./store.ts";
import { takeBudget } from "./request-limits.ts";

const SESSION_SECONDS = 7 * 24 * 60 * 60;

const LOGIN_SECONDS = 600;

type BrowserSession = { userId: string; expiresAt: number };

export type LoginState = {
  state: string;
  verifier: string;
  nonce: string;
  expiresAt: number;
  returnTo: string;
};

function cookieName(request: Request, suffix: string) {
  return `${new URL(request.url).protocol === "https:" ? "__Host-" : ""}sdc-${suffix}`;
}

function cookie(request: Request, suffix: string, value: string, seconds: number) {
  return `${cookieName(request, suffix)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}

function cookieValue(request: Request, suffix: string) {
  const name = cookieName(request, suffix);

  return request.headers
    .get("Cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export async function browserUser(request: Request, env: Env): Promise<string | null> {
  const token = cookieValue(request, "session");

  if (!token || !/^[a-f0-9-]{36}$/.test(token)) {
    return null;
  }

  const session = await env.OAUTH_KV.get<BrowserSession>(
    `browser-session:${await sha256(token)}`,
    "json",
  );

  return session && session.expiresAt > Date.now() ? session.userId : null;
}

export async function requireBrowserUser(request: Request, env: Env) {
  const user = await browserUser(request, env);

  if (!user) {
    throw new HTTPException(401, { message: "Sign in to manage your diagrams." });
  }

  return user;
}

/** Cookie-authenticated mutations must originate from our own page. */
export function requireSameOrigin(request: Request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    throw new HTTPException(403, { message: "A same-origin request is required." });
  }
}

export function browserAuthConfigured(env: Env): boolean {
  return Boolean(env.AUTH_CLIENT_ID && env.AUTH_CLIENT_SECRET);
}

export async function browserLogin(request: Request, env: Env, returnTo = "/"): Promise<Response> {
  if (!browserAuthConfigured(env)) {
    throw new HTTPException(503, { message: "Auth sign-in is not configured." });
  }

  await takeBudget(
    env,
    `browser-login:${request.headers.get("CF-Connecting-IP") ?? "unknown"}`,
    20,
  );
  const { startLogin } = await import("./oidc.ts");
  const { url, login } = await startLogin(request, env, returnTo);
  const binding = crypto.randomUUID();
  await env.OAUTH_KV.put(`browser-login:${await sha256(binding)}`, JSON.stringify(login), {
    expirationTtl: LOGIN_SECONDS,
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.href,
      "Set-Cookie": cookie(request, "login", binding, LOGIN_SECONDS),
      "Cache-Control": "no-store",
    },
  });
}

export async function browserCallback(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    throw new HTTPException(405, { message: "Use GET for the sign-in callback." });
  }

  const url = new URL(request.url);
  const binding = cookieValue(request, "login");
  const key = binding ? `browser-login:${await sha256(binding)}` : "";
  const login = key ? await env.OAUTH_KV.get<LoginState>(key, "json") : null;

  if (!login || login.state !== url.searchParams.get("state") || login.expiresAt <= Date.now()) {
    throw new HTTPException(400, {
      message: "Sign-in expired or was not started in this browser.",
    });
  }

  await env.OAUTH_KV.delete(key);
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", cookie(request, "login", "", 0));

  if (url.searchParams.has("error")) {
    headers.set("Location", "/?signin=cancelled");

    return new Response(null, { status: 302, headers });
  }

  const { finishLogin } = await import("./oidc.ts");
  const userId = await finishLogin(request, env, login);

  const sessionToken = crypto.randomUUID();

  const session: BrowserSession = {
    userId,
    expiresAt: Date.now() + SESSION_SECONDS * 1000,
  };

  await env.OAUTH_KV.put(`browser-session:${await sha256(sessionToken)}`, JSON.stringify(session), {
    expirationTtl: SESSION_SECONDS,
  });
  headers.append("Set-Cookie", cookie(request, "session", sessionToken, SESSION_SECONDS));
  headers.set("Location", login.returnTo);

  return new Response(null, { status: 302, headers });
}

export async function browserLogout(request: Request, env: Env): Promise<Response> {
  requireSameOrigin(request);
  const token = cookieValue(request, "session");

  if (token) {
    await env.OAUTH_KV.delete(`browser-session:${await sha256(token)}`);
  }

  const headers = new Headers({
    "Set-Cookie": cookie(request, "session", "", 0),
    "Cache-Control": "no-store",
  });

  if (env.LWC_SECRET) {
    const { chatgptAuth } = await import("./chatgpt.ts");
    const url = new URL("/api/chatgpt/logout", request.url);

    const response = await chatgptAuth(env).handler(
      new Request(url, { method: "POST", headers: request.headers }),
    );

    for (const value of response.headers.getSetCookie()) {
      headers.append("Set-Cookie", value);
    }
  }

  return new Response(null, {
    status: 204,
    headers,
  });
}
