import { HTTPException } from "hono/http-exception";
import { sha256 } from "./store.ts";
import { readBounded, takeBudget } from "./request-limits.ts";

const SESSION_SECONDS = 7 * 24 * 60 * 60;
const LOGIN_SECONDS = 600;
type BrowserSession = { userId: string; expiresAt: number };
type LoginState = { state: string; verifier: string; expiresAt: number };
type GithubIdentity = { id: number };
type GithubToken = { access_token?: string };

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
  if (!token || !/^[a-f0-9-]{36}$/.test(token)) return null;
  const session = await env.OAUTH_KV.get<BrowserSession>(
    `browser-session:${await sha256(token)}`,
    "json",
  );
  return session && session.expiresAt > Date.now() ? session.userId : null;
}

export async function requireBrowserUser(request: Request, env: Env) {
  const user = await browserUser(request, env);
  if (!user)
    throw new HTTPException(401, { message: "Sign in with GitHub to manage your diagrams." });
  return user;
}

/** Cookie-authenticated mutations must originate from our own page. */
export function requireSameOrigin(request: Request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin)
    throw new HTTPException(403, { message: "A same-origin request is required." });
}

export async function browserLogin(request: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET)
    throw new HTTPException(503, { message: "GitHub sign-in is not configured." });
  await takeBudget(
    env,
    `browser-login:${request.headers.get("CF-Connecting-IP") ?? "unknown"}`,
    20,
  );
  const state = `browser-${crypto.randomUUID()}`;
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const binding = crypto.randomUUID();
  const login: LoginState = { state, verifier, expiresAt: Date.now() + LOGIN_SECONDS * 1000 };
  await env.OAUTH_KV.put(`browser-login:${await sha256(binding)}`, JSON.stringify(login), {
    expirationTtl: LOGIN_SECONDS,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: `${new URL(request.url).origin}/github/callback`,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.href,
      "Set-Cookie": cookie(request, "login", binding, LOGIN_SECONDS),
      "Cache-Control": "no-store",
    },
  });
}

export function isBrowserCallback(request: Request) {
  return new URL(request.url).searchParams.get("state")?.startsWith("browser-") ?? false;
}

export async function browserCallback(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET")
    throw new HTTPException(405, { message: "Use GET for the sign-in callback." });
  const url = new URL(request.url);
  const binding = cookieValue(request, "login");
  const key = binding ? `browser-login:${await sha256(binding)}` : "";
  const login = key ? await env.OAUTH_KV.get<LoginState>(key, "json") : null;
  if (!login || login.state !== url.searchParams.get("state") || login.expiresAt <= Date.now())
    throw new HTTPException(400, {
      message: "Sign-in expired or was not started in this browser.",
    });
  await env.OAUTH_KV.delete(key);
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", cookie(request, "login", "", 0));
  if (url.searchParams.has("error")) {
    headers.set("Location", "/?signin=cancelled");
    return new Response(null, { status: 302, headers });
  }
  const code = url.searchParams.get("code");
  if (!code)
    throw new HTTPException(400, { message: "GitHub did not return an authorization code." });
  const exchanged = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/github/callback`,
      code_verifier: login.verifier,
    }),
  });
  const token = JSON.parse(
    new TextDecoder().decode(await readBounded(exchanged.body, 16 * 1024)),
  ) as GithubToken;
  if (!exchanged.ok || !token.access_token)
    throw new HTTPException(502, { message: "GitHub sign-in failed." });
  const identityResponse = await fetch("https://api.github.com/user", {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "system-design-companion",
    },
  });
  const identity = JSON.parse(
    new TextDecoder().decode(await readBounded(identityResponse.body, 16 * 1024)),
  ) as GithubIdentity;
  if (!identityResponse.ok || !Number.isSafeInteger(identity.id) || identity.id <= 0)
    throw new HTTPException(502, { message: "Could not read your GitHub identity." });
  const sessionToken = crypto.randomUUID();
  const session: BrowserSession = {
    userId: encodeURIComponent(`github:${identity.id}`),
    expiresAt: Date.now() + SESSION_SECONDS * 1000,
  };
  await env.OAUTH_KV.put(`browser-session:${await sha256(sessionToken)}`, JSON.stringify(session), {
    expirationTtl: SESSION_SECONDS,
  });
  headers.append("Set-Cookie", cookie(request, "session", sessionToken, SESSION_SECONDS));
  headers.set("Location", "/");
  return new Response(null, { status: 302, headers });
}

export async function browserLogout(request: Request, env: Env): Promise<Response> {
  requireSameOrigin(request);
  const token = cookieValue(request, "session");
  if (token) await env.OAUTH_KV.delete(`browser-session:${await sha256(token)}`);
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": cookie(request, "session", "", 0), "Cache-Control": "no-store" },
  });
}
