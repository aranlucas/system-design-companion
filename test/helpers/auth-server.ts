import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { vi } from "vitest";
import { AUTH_ISSUER } from "@/worker/oidc.ts";

export type AuthFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** A real signing key lets the OIDC client verify signatures rather than bypassing validation. */
export async function authServer() {
  const keys = await generateKeyPair("RS256");

  const publicKey = {
    ...(await exportJWK(keys.publicKey)),
    kid: "test-auth-key",
    alg: "RS256",
    use: "sig",
  };

  let nonce = "";
  let claims: JWTPayload = {};
  let subject = "123";
  let invalidSignature = false;
  const wrongKeys = await generateKeyPair("RS256");

  const upstream = vi.fn<AuthFetch>(async (input) => {
    const url = input instanceof Request ? input.url : String(input);

    if (url === `${AUTH_ISSUER}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: AUTH_ISSUER,
        authorization_endpoint: `${AUTH_ISSUER}/oauth2/authorize`,
        token_endpoint: `${AUTH_ISSUER}/oauth2/token`,
        jwks_uri: `${AUTH_ISSUER}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        authorization_response_iss_parameter_supported: true,
      });
    }

    if (url === `${AUTH_ISSUER}/jwks`) {
      return Response.json({ keys: [publicKey] });
    }

    if (url === `${AUTH_ISSUER}/oauth2/token`) {
      const idToken = await new SignJWT({ nonce, ...claims })
        .setProtectedHeader({ alg: "RS256", kid: "test-auth-key" })
        .setIssuer(claims.iss ?? AUTH_ISSUER)
        .setAudience(String(claims.aud ?? "test-client"))
        .setSubject(subject)
        .setIssuedAt()
        .setExpirationTime(claims.exp ?? "5m")
        .sign(invalidSignature ? wrongKeys.privateKey : keys.privateKey);

      return Response.json({
        access_token: "upstream-token",
        token_type: "Bearer",
        id_token: idToken,
      });
    }

    throw new Error(`Unexpected auth request: ${url}`);
  });

  return {
    upstream,
    authorize(url: URL) {
      nonce = url.searchParams.get("nonce") ?? "";
    },
    overrideClaims(value: JWTPayload) {
      claims = value;
    },
    subject(value: string) {
      subject = value;
    },
    corruptSignature() {
      invalidSignature = true;
    },
  };
}
