import {
  createChatGPTHandler,
  type ChatGPTHandler,
  type KeyValueStore,
} from "@opencoredev/loginwithchatgpt-server";
import { HTTPException } from "hono/http-exception";
import { decodeJwt } from "jose";
import { z } from "zod";
import { ensureSchema, sha256 } from "./store.ts";

interface StoredValue {
  value: string;
}

interface CachedHandler {
  secret: string;
  auth: ChatGPTHandler;
}

type SetOptions<T> = Parameters<KeyValueStore<T>["set"]>[2];

const handlers = new WeakMap<D1Database, CachedHandler>();

const identitySchema = z.object({
  iss: z.literal("https://auth.openai.com"),
  sub: z.string().min(1),
});

/** Resolve a person within their workspace, never just a shared workspace or an email. */
export async function chatgptUser(request: Request, env: Env): Promise<string | null> {
  if (!env.LWC_SECRET) {
    return null;
  }

  const tokens = await chatgptAuth(env).dangerouslyGetTokens(request);

  if (!tokens?.idToken || !tokens.accountId) {
    return null;
  }

  // Only SDK tokens obtained from OpenAI over TLS and kept in our encrypted store
  // reach this decoder. No caller can submit an identity token to this endpoint.
  try {
    const claims = decodeJwt(tokens.idToken);
    const parsed = identitySchema.safeParse(claims);

    if (!parsed.success) {
      return null;
    }

    return encodeURIComponent(
      `chatgpt:${await sha256(JSON.stringify([parsed.data.iss, parsed.data.sub, tokens.accountId]))}`,
    );
  } catch {
    return null;
  }
}

/** The SDK encrypts tokens before storage. D1 keeps sessions shared across Workers. */
function sessionStore<T>(env: Env, namespace: string): KeyValueStore<T> {
  return {
    async get(key) {
      await ensureSchema(env);

      const row = await env.DB.prepare(
        "SELECT value FROM chatgpt_state WHERE key = ? AND expires_at > ?",
      )
        .bind(`${namespace}:${key}`, Date.now())
        .first<StoredValue>();

      // SAFETY: only this typed SDK adapter writes these private records; T is its storage contract.
      return row ? (JSON.parse(row.value) as T) : undefined;
    },
    async set(key: string, value: T, options?: SetOptions<T>) {
      await ensureSchema(env);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM chatgpt_state WHERE expires_at <= ?").bind(Date.now()),
        env.DB.prepare(
          "INSERT INTO chatgpt_state (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
        ).bind(
          `${namespace}:${key}`,
          JSON.stringify(value),
          Date.now() + (options?.ttlMs ?? 30 * 86400_000),
        ),
      ]);
    },
    async delete(key) {
      await ensureSchema(env);
      await env.DB.prepare("DELETE FROM chatgpt_state WHERE key = ?")
        .bind(`${namespace}:${key}`)
        .run();
    },
  };
}

export function chatgptAuth(env: Env): ChatGPTHandler {
  if (!env.LWC_SECRET) {
    throw new HTTPException(503, {
      message: "ChatGPT sign-in is not configured on this workspace.",
    });
  }

  const cached = handlers.get(env.DB);

  if (cached?.secret === env.LWC_SECRET) {
    return cached.auth;
  }

  const auth = createChatGPTHandler({
    secret: env.LWC_SECRET,
    // Server-only identity resolution needs the stable ID-token subject. No HTTP
    // route exposes this helper or returns bearer credentials to the browser.
    dangerouslyAllowTokenExport: true,
    sessionStore: sessionStore(env, "session"),
    responsesProxy: {
      maxRequestBytes: 256 * 1024,
      rateLimit: { limit: 12, windowMs: 60_000, store: sessionStore(env, "rate") },
    },
  });

  handlers.set(env.DB, { secret: env.LWC_SECRET, auth });

  return auth;
}
