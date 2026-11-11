import { HTTPException } from "hono/http-exception";

export const MAX_JSON_BYTES = 1024 * 1024;

export const MAX_SCENE_ELEMENTS = 5000;

export const MAX_PATCH_OPS = 200;

type BudgetRow = { count: number };

/** Enforce the limit while reading, including chunked bodies without Content-Length. */
export async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!body) {
    return new Uint8Array();
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- consume the stream in order
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      length += value.byteLength;

      if (length > maxBytes) {
        throw new HTTPException(413, { message: "Request body is too large." });
      }

      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

export interface UpdateRate {
  perSecond: number;
  burst: number;
}

/** Canvas tabs flush local changes at most every 60 ms (~17/s) while drawing or dragging. */
export const SOCKET_UPDATE_RATE: UpdateRate = { perSecond: 20, burst: 100 };

/** Board-wide ceiling, so many sockets opened from one link cannot multiply the allowance. */
export const ROOM_UPDATE_RATE: UpdateRate = { perSecond: 60, burst: 300 };

/**
 * Continuous-refill allowance held in memory. A board's Durable Object is its only
 * instance, so counting there is exact and costs no I/O per canvas message.
 */
export class TokenBucket {
  private tokens: number;
  private updatedAt: number;

  constructor(
    private readonly rate: UpdateRate,
    now = Date.now(),
  ) {
    this.tokens = rate.burst;
    this.updatedAt = now;
  }

  take(now = Date.now()) {
    const refill = (Math.max(0, now - this.updatedAt) / 1000) * this.rate.perSecond;
    this.tokens = Math.min(this.rate.burst, this.tokens + refill);
    this.updatedAt = now;

    if (this.tokens < 1) {
      return false;
    }

    this.tokens -= 1;

    return true;
  }
}

/** D1's atomic upsert makes the allowance consistent across Worker isolates. */
export async function takeBudget(env: Env, key: string, limit: number, seconds = 60) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS request_budgets (key TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL)",
  ).run();

  const row =
    await env.DB.prepare(`INSERT INTO request_budgets (key, window, count) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window = excluded.window THEN count + 1 ELSE 1 END,
    window = excluded.window WHERE window != excluded.window OR count < ? RETURNING count`)
      .bind(key, Math.floor(Date.now() / (seconds * 1000)), limit)
      .first<BudgetRow>();

  if (!row) {
    throw new HTTPException(429, { message: "Too many requests. Try again shortly." });
  }
}
