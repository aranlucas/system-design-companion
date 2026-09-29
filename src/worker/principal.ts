// The authenticated caller behind an MCP request, and how it reaches the SDK.
//
// The OAuth provider verifies the bearer token and hands the handler a verified
// principal; the MCP SDK takes that as `AuthInfo` on `createMcpHandler`. Events
// need the same principal, so it travels as one value from oauth.ts to mcp.ts.

import type { OAuthResourceContext } from "@cloudflare/workers-oauth-provider";

/** Who is making this MCP call, as verified by the authorization server. */
export interface McpPrincipal {
  /** Stable subject the token was issued for. Namespaces the subscription key. */
  userId: string;
  /** Opaque identifier of the consent grant; no token is stored in subscriptions. */
  authorizationId: string;
  resource: string;
  /** OAuth client the token was issued to, e.g. the ChatGPT connector id. */
  clientId: string;
  /** Scopes the token carries. */
  scopes: string[];
  /** Absolute expiry, in seconds since the epoch. */
  expiresAt?: number;
}

type OAuthProps = { authorizationId?: string };
export type OAuthHandlerContext = OAuthResourceContext<OAuthProps>;

/** A token the authorization server issued always names a user, so this cannot fail. */
export function toMcpPrincipal(ctx: OAuthHandlerContext): McpPrincipal {
  const { auth, props } = ctx;
  if (!props?.authorizationId) throw new Error("access token carried no authorization identity");
  if (!auth.userId) throw new Error("access token carried no subject");
  return {
    userId: auth.userId,
    authorizationId: props.authorizationId,
    resource: auth.audience,
    clientId: auth.clientId ?? "unknown",
    scopes: auth.scope,
    expiresAt: auth.expiresAt,
  };
}
