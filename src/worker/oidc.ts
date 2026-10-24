import * as oidc from "openid-client";
import { HTTPException } from "hono/http-exception";
import { AUTH_CALLBACK_PATH } from "./oauth-paths.ts";
import type { LoginState } from "./browser-auth.ts";

export const AUTH_ISSUER = "https://auth.aranlucas.workers.dev/api/auth";

function configuration(env: Env) {
  if (!env.AUTH_CLIENT_ID || !env.AUTH_CLIENT_SECRET) {
    throw new HTTPException(503, { message: "Auth sign-in is not configured." });
  }

  return oidc.discovery(
    new URL(AUTH_ISSUER),
    env.AUTH_CLIENT_ID,
    { id_token_signed_response_alg: "RS256" },
    oidc.ClientSecretBasic(env.AUTH_CLIENT_SECRET),
    { timeout: 10, execute: [oidc.enableNonRepudiationChecks] },
  );
}

/** Only the homepage and our MCP consent route can be resumed after sign-in. */
function loginDestination(request: Request, returnTo: string): string {
  const url = new URL(returnTo, request.url);

  return url.origin === new URL(request.url).origin && url.pathname === "/authorize"
    ? url.pathname + url.search
    : "/";
}

export async function startLogin(request: Request, env: Env, returnTo: string) {
  const config = await configuration(env);

  const login: LoginState = {
    state: oidc.randomState(),
    nonce: oidc.randomNonce(),
    verifier: oidc.randomPKCECodeVerifier(),
    expiresAt: Date.now() + 600_000,
    returnTo: loginDestination(request, returnTo),
  };

  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: new URL(AUTH_CALLBACK_PATH, request.url).href,
    scope: "openid",
    state: login.state,
    nonce: login.nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(login.verifier),
    code_challenge_method: "S256",
  });

  return { url, login };
}

export async function finishLogin(request: Request, env: Env, login: LoginState): Promise<string> {
  try {
    const config = await configuration(env);

    const tokens = await oidc.authorizationCodeGrant(config, new URL(request.url), {
      expectedState: login.state,
      expectedNonce: login.nonce,
      pkceCodeVerifier: login.verifier,
      idTokenExpected: true,
    });

    const subject = tokens.claims()?.sub;

    if (!subject) {
      throw new Error("Auth did not return a subject.");
    }

    // Namespace the verified subject; never merge owners by email or display name.
    return encodeURIComponent(`auth:${subject}`);
  } catch {
    throw new HTTPException(502, { message: "Auth sign-in failed. Please try again." });
  }
}
