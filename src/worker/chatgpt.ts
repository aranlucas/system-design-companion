import {
  createChatGPTHandler,
  type ChatGPTHandler,
  type KeyValueStore,
} from "@opencoredev/loginwithchatgpt-server";
import { HTTPException } from "hono/http-exception";
import { ensureSchema } from "./store.ts";

interface StoredValue {
  value: string;
}

interface CachedHandler {
  secret: string;
  auth: ChatGPTHandler;
}

type SetOptions<T> = Parameters<KeyValueStore<T>["set"]>[2];

const handlers = new WeakMap<D1Database, CachedHandler>();

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
    sessionStore: sessionStore(env, "session"),
    responsesProxy: {
      allowedModels: ["gpt-5.5"],
      maxRequestBytes: 256 * 1024,
      rateLimit: { limit: 12, windowMs: 60_000, store: sessionStore(env, "rate") },
    },
  });

  handlers.set(env.DB, { secret: env.LWC_SECRET, auth });

  return auth;
}
