import { z } from "zod";
// OAuth 2.1 authorization for the MCP endpoint.
//
// The canvas itself stays capability-link based: /d/:id?k=… is unchanged, so the
// interview workflow is exactly as before. Only /mcp sits behind OAuth, because
// ChatGPT requires an authenticated principal before it will accept an event
// subscription, and the same token tells us who an agent is acting as.
//
// Identity comes from the shared Auth service through a first-party browser session.
import {
  AuthorizationError,
  insufficientScope,
  getOAuthApi,
  OAuthProvider,
  type ConsentDescription,
  type OAuthHelpers,
  type OAuthProviderOptions,
} from "@cloudflare/workers-oauth-provider";
import {
  AUTHORIZE_ENDPOINT,
  MCP_ROUTE,
  TOKEN_ENDPOINT,
  REGISTRATION_ENDPOINT,
} from "./oauth-paths.ts";
import { browserUser, browserLogin, browserAuthConfigured } from "./browser-auth.ts";
import { toMcpPrincipal, oauthContextSchema } from "./principal.ts";

/** Everything the authorization server can grant. */
const SCOPES_SUPPORTED = ["mcp:read", "mcp:write"];

/** The minimum for any MCP access, so clients ask for it first. */
const REQUIRED_SCOPES = ["mcp:read"];

/** Plain-language descriptions shown next to each scope on the consent page. */
const SCOPE_BLURB = {
  "mcp:read": "read and watch diagrams whose share links you give this agent",
  "mcp:write": "create diagrams and edit diagrams shared with this agent",
};

const scopeDescriptions = new Map(Object.entries(SCOPE_BLURB));

/** The resource server's half: token in, MCP handler out. */
type McpApiHandler = ExportedHandler<Env> & { fetch: NonNullable<ExportedHandler<Env>["fetch"]> };

/**
 * One provider per origin. The canonical resource is baked in at construction, so
 * the instance is memoized rather than rebuilt per request. A deployment serves
 * one origin in production and one in `wrangler dev`, so this map stays tiny.
 */
const providers = new Map<string, OAuthProvider<Env>>();

/**
 * The full provider for a request origin, with `app` handling every path the
 * provider does not own itself (the canvas, the API, the WebSockets, /authorize).
 */
export function oauthProvider(origin: string, app: ExportedHandler<Env>) {
  const cached = providers.get(origin);

  if (cached) {
    return cached;
  }

  const provider = new OAuthProvider<Env>(providerOptions(origin, app));
  providers.set(origin, provider);

  return provider;
}

function providerOptions(
  origin: string,
  defaultHandler: ExportedHandler<Env>,
): OAuthProviderOptions<Env> {
  return {
    apiRoute: MCP_ROUTE,
    apiHandler: mcpApiHandler,
    defaultHandler,
    authorizeEndpoint: AUTHORIZE_ENDPOINT,
    tokenEndpoint: TOKEN_ENDPOINT,
    clientRegistrationEndpoint: REGISTRATION_ENDPOINT,
    // MCP 2026-07-28 prefers Client ID Metadata Documents and deprecates dynamic
    // registration; DCR stays as the compatibility path for older clients.
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: SCOPES_SUPPORTED,
    requiredScopes: REQUIRED_SCOPES,
    resourceMetadata: {
      resource: `${origin}${MCP_ROUTE}`,
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      resource_name: "System Design Companion",
    },
  };
}

/**
 * The MCP endpoint. The SDK bundle and its schemas stay unloaded until a token has
 * actually been presented, as they did behind the plain Hono route.
 */
const mcpApiHandler: McpApiHandler = {
  async fetch(request, env, ctx) {
    const context = oauthContextSchema.parse(ctx);

    if (!context.auth.scope.includes("mcp:read")) {
      return insufficientScope(context.auth, ["mcp:read"]);
    }

    const { handleMcp } = await import("./mcp.ts");

    // The provider puts `auth` on the context at runtime; its own
    // ExportedHandler type does not declare it.
    return handleMcp(request, env, toMcpPrincipal(context));
  },
};

/** Whether this deployment can actually sign a user in. */
export function oauthConfigured(env: Env): boolean {
  return browserAuthConfigured(env);
}

/** The /authorize route, mounted by index.ts. */
export async function oauthRoutes(request: Request, env: Env): Promise<Response> {
  const origin = new URL(request.url).origin;

  if (!oauthConfigured(env)) {
    return notConfigured(origin);
  }

  // The provider object is only a vehicle for the helpers, so a throwaway one
  // is enough: nothing here dispatches through it.
  const oauth = getOAuthApi(providerOptions(origin, app), env);

  try {
    if (request.method === "POST") {
      return await decide(request, env, oauth);
    }

    if (request.method === "GET") {
      return await startAuthorization(request, env, origin, oauth);
    }

    return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      if (error.redirectTo) {
        return Response.redirect(error.redirectTo, 302);
      }

      return renderMessage(400, error.description);
    }

    throw error;
  }
}

/** Placeholder for the helpers, which only need a valid default handler to exist. */
const app: ExportedHandler<Env> = { fetch: () => new Response(null, { status: 404 }) };

/** GET /authorize: parse the client's request, then ask the user. */
async function startAuthorization(
  request: Request,
  env: Env,
  origin: string,
  oauth: OAuthHelpers,
): Promise<Response> {
  const authRequest = await oauth.parseAuthRequest(request);

  if (!(await browserUser(request, env))) {
    const url = new URL(request.url);

    return browserLogin(request, env, url.pathname + url.search);
  }

  const consent = await oauth.describeConsent(authRequest);
  const { handle, headers } = await oauth.beginConsent(authRequest);
  headers.set("content-type", "text/html; charset=utf-8");

  return new Response(consentPage(consent, handle, origin), { headers });
}

/** POST /authorize: the user pressed Allow or Deny. */
async function decide(request: Request, env: Env, oauth: OAuthHelpers): Promise<Response> {
  const form = await request.formData();
  const parsedHandle = z.string().min(1).safeParse(form.get("handle"));

  if (!parsedHandle.success) {
    return renderMessage(400, "Malformed consent form.");
  }

  const handle = parsedHandle.data;

  if (form.get("decision") !== "allow") {
    const { redirectTo, headers } = await oauth.denyConsent(request, handle);
    headers.set("Location", redirectTo);

    return new Response(null, { status: 302, headers });
  }

  // The page decides the scope, but only from what the server supports.
  const scope = form
    .getAll("scope")
    .map(String)
    .filter((s) => SCOPES_SUPPORTED.includes(s));

  const approved = await oauth.approveConsent(request, handle, { scope });
  const existingUser = await browserUser(request, env);

  if (existingUser) {
    return completeUserAuthorization(existingUser, approved.request, approved.headers, oauth);
  }

  return renderMessage(401, "Your sign-in expired. Restart authorization to continue.");
}

type AuthorizationRequest = Parameters<OAuthHelpers["completeAuthorization"]>[0]["request"];

async function completeUserAuthorization(
  userId: string,
  authRequest: AuthorizationRequest,
  headers: Headers,
  oauth: OAuthHelpers,
) {
  const authorizationId = crypto.randomUUID();

  const { redirectTo } = await oauth.completeAuthorization({
    request: authRequest,
    // Namespaced so an Auth subject can never collide with another provider's subject.
    userId,
    metadata: { authorizationId },
    scope: authRequest.scope,
    props: { authorizationId },
  });

  headers.set("Location", redirectTo);

  return new Response(null, { status: 302, headers });
}

function notConfigured(origin: string): Response {
  return renderMessage(
    503,
    `Sign-in is not configured on this deployment. The MCP endpoint is ${origin}${MCP_ROUTE}, ` +
      `and an administrator needs to set AUTH_CLIENT_ID and AUTH_CLIENT_SECRET.`,
  );
}

function renderMessage(status: number, message: string): Response {
  const body =
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Sign-in problem</title>` +
    `<body style="font:15px/1.5 system-ui;max-width:34rem;margin:4rem auto;padding:0 1rem">` +
    `<h1 style="font-size:1.2rem">Sign-in problem</h1><p>${escape(message)}</p>` +
    `<p><a href="/">Back to System Design Companion</a></p>`;

  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

// Every string below can come from the client or from Auth, so it is escaped
// before it reaches the page. The anti-framing headers come from beginConsent().
function consentPage(consent: ConsentDescription, handle: string, origin: string): string {
  const who = consent.clientDomain
    ? `<strong>${escape(consent.clientDomain)}</strong>`
    : `<strong>${escape(consent.clientName)}</strong>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Authorize ${escape(consent.clientName)}</title>
<style>
  body{font:15px/1.5 system-ui,-apple-system,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem;color:#1b1b1f}
  h1{font-size:1.25rem;margin-bottom:.25rem}
  .muted{color:#6b6b76}
  .card{border:1px solid #e3e3e8;border-radius:.75rem;padding:1.25rem;margin:1.5rem 0}
  dl{display:grid;grid-template-columns:auto 1fr;gap:.35rem 1rem;margin:0}
  dt{color:#6b6b76}dd{margin:0;word-break:break-all}
  .scope{display:flex;gap:.5rem;align-items:baseline;padding:.3rem 0}
  .row{display:flex;gap:.75rem;margin-top:1.5rem}
  button{font:inherit;padding:.6rem 1.2rem;border-radius:.5rem;border:1px solid #c9c9d0;cursor:pointer;flex:1}
  button[type=submit].allow{background:#1b1b1f;color:#fff;border-color:#1b1b1f}
  .warn{color:#8a4b00}
</style></head><body>
<h1>Authorize access</h1>
<p class="muted">System Design Companion on ${escape(origin)}</p>
<div class="card">
  <p>${who} wants to connect to your diagrams through your agent.</p>
  <dl>
    <dt>Signs you in with</dt><dd>Your System Design Companion account</dd>
    <dt>Sends back to</dt><dd>${escape(consent.redirectUri)}</dd>
  </dl>
  ${consent.redirectIsLoopback ? '<p class="warn">This redirect points at a local app, so any local process could receive it.</p>' : ""}
</div>
<form method="post" action="${escape(AUTHORIZE_ENDPOINT)}">
  <input type="hidden" name="handle" value="${escape(handle)}" />
  <p class="muted" style="margin-bottom:.25rem">This agent is asking for:</p>
  ${consent.scope
    .map(
      (s) =>
        `<label class="scope"><input type="checkbox" name="scope" value="${escape(s)}" checked />` +
        `<span><code>${escape(s)}</code> <span class="muted">${escape(scopeDescriptions.get(s) ?? "")}</span></span></label>`,
    )
    .join("\n  ")}
  <div class="row">
    <button type="submit" name="decision" value="deny">Deny</button>
    <button class="allow" type="submit" name="decision" value="allow">Allow</button>
  </div>
</form>
<p class="muted" style="font-size:.85rem">Your agent’s tokens are stored by this deployment. You can revoke access from your agent's connector settings at any time.</p>
</body></html>`;
}

function escape(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Check the original consent grant, so a disconnected installation loses its subscriptions. */
export async function eventAuthorizationActive(
  env: Env,
  userId: string,
  authorizationId: string,
  resource: string,
): Promise<boolean> {
  const oauth = getOAuthApi(providerOptions(new URL(resource).origin, app), env);
  let cursor: string | undefined;

  do {
    // oxlint-disable-next-line no-await-in-loop -- follow the provider's pagination
    const grants = await oauth.listUserGrants(userId, { cursor, limit: 100 });

    if (
      grants.items.some(
        (grant) =>
          z.object({ authorizationId: z.string() }).safeParse(grant.metadata).data
            ?.authorizationId === authorizationId &&
          grant.scope.includes("mcp:read") &&
          (grant.resource === resource ||
            (Array.isArray(grant.resource) && grant.resource.includes(resource))) &&
          (!grant.expiresAt || grant.expiresAt > Date.now() / 1000),
      )
    ) {
      return true;
    }

    cursor = grants.cursor;
  } while (cursor);

  return false;
}
