// The paths the OAuth provider owns, kept in their own module so the Worker's
// main chunk can name them without pulling in the provider itself.
//
// The provider is ~250 kB of JavaScript and only /mcp and the OAuth endpoints
// need it. Every canvas request would otherwise pay to load it, so the default
// export checks the path first and only then reaches for the provider.

export const MCP_ROUTE = "/mcp";

export const AUTHORIZE_ENDPOINT = "/authorize";

export const CALLBACK_PATH = "/github/callback";

export const TOKEN_ENDPOINT = "/oauth/token";

export const REGISTRATION_ENDPOINT = "/oauth/register";

const PROTECTED_RESOURCE_METADATA = "/.well-known/oauth-protected-resource";

/** Whether the OAuth provider handles this path, or Hono does. */
export function isOAuthPath(pathname: string): boolean {
  if (pathname === MCP_ROUTE || pathname === AUTHORIZE_ENDPOINT) return true;

  if (pathname === CALLBACK_PATH) return true;

  if (pathname === TOKEN_ENDPOINT || pathname === REGISTRATION_ENDPOINT) return true;

  if (pathname === "/.well-known/oauth-authorization-server") return true;

  // RFC 9728 documents are path-specific: /.well-known/oauth-protected-resource/mcp.
  return (
    pathname === PROTECTED_RESOURCE_METADATA ||
    pathname.startsWith(`${PROTECTED_RESOURCE_METADATA}/`)
  );
}

/** The path prefixes the assets router must send to the Worker, not to index.html. */
export const RUN_WORKER_FIRST = [
  "/api/*",
  "/ws/*",
  MCP_ROUTE,
  AUTHORIZE_ENDPOINT,
  "/github/*",
  "/oauth/*",
  "/.well-known/oauth-*",
  "/.well-known/openai-apps-challenge",
];
