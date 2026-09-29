// In-memory fakes for Cloudflare bindings (D1, R2, Durable Object storage/sockets)
// so worker logic can be exercised under vitest without workerd.
import type { McpPrincipal } from "../../src/worker/principal.ts";
import { DiagramRoom } from "../../src/worker/room.ts";

export interface DiagramRow {
  id: string;
  name: string;
  key_hash: string;
  is_template: number;
  description: string | null;
  created_at: number;
  updated_at: number;
}

export interface SnapshotRow {
  id: string;
  diagram_id: string;
  name: string;
  kind: string;
  created_at: number;
  element_count: number;
}

export interface EventSubscriptionRow {
  id: string;
  user_id: string;
  event_name: string;
  diagram_id: string;
  callback_url: string;
  secret: string;
  include_agent: number;
  expires_at: number;
  authorization_id: string;
  resource: string;
  key_hash: string;
  previous_secret: string | null;
  previous_secret_until: number;
}
type FakeStatement = { run: () => Promise<unknown> };
type KvReadOptions = { type?: "text" | "json" };
type KvWriteOptions = { expirationTtl?: number; expiration?: number };
type KvListOptions = { prefix?: string; cursor?: string; limit?: number };
type KvEntry = { value: string; expiration?: number };

/** KV persistence shared by real OAuthProvider instances in integration tests. */
export class FakeKV {
  readonly values = new Map<string, KvEntry>();
  async get(key: string, options?: KvReadOptions | "json" | "text"): Promise<unknown> {
    const entry = this.values.get(key);
    if (!entry || (entry.expiration && entry.expiration <= Date.now() / 1000)) return null;
    const type = typeof options === "string" ? options : options?.type;
    return type === "json" ? (JSON.parse(entry.value) as unknown) : entry.value;
  }
  async put(key: string, value: string, options?: KvWriteOptions): Promise<void> {
    this.values.set(key, {
      value,
      expiration:
        options?.expiration ??
        (options?.expirationTtl ? Date.now() / 1000 + options.expirationTtl : undefined),
    });
  }
  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
  async list(options: KvListOptions = {}) {
    const names = [...this.values.keys()]
      .filter((name) => name.startsWith(options.prefix ?? ""))
      .filter(
        (name) =>
          !this.values.get(name)!.expiration ||
          this.values.get(name)!.expiration! > Date.now() / 1000,
      )
      .toSorted();
    const offset = Number(options.cursor ?? 0);
    const limit = options.limit ?? 1000;
    return {
      keys: names.slice(offset, offset + limit).map((name) => ({ name })),
      list_complete: offset + limit >= names.length,
      cursor: offset + limit >= names.length ? "" : String(offset + limit),
    };
  }
}

/** What `.all()` resolves to. */
type D1Results<T> = { results: T[] };
/** Bound parameters of each statement the fakes handle, in order. */
type LibraryInsertParams = [id: string, key: string];
type EventSubscriptionParams = [
  id: string,
  user_id: string,
  event_name: string,
  diagram_id: string,
  callback_url: string,
  secret: string,
  include_agent: number,
  expires_at: number,
  authorization_id: string,
  resource: string,
  key_hash: string,
  previous_secret: string | null,
  previous_secret_until: number,
];
type EventSubscriptionFilter = [diagram_id: string, event_name: string, now: number];
type DiagramInsertParams = [
  id: string,
  name: string,
  key_hash: string,
  description: string | null,
  created_at: number,
  updated_at: number,
];
type LegacyDiagramInsertParams = [
  id: string,
  name: string,
  key_hash: string,
  created_at: number,
  updated_at: number,
];
type SnapshotInsertParams = [
  id: string,
  diagram_id: string,
  name: string,
  kind: string,
  created_at: number,
  element_count: number,
];
type RenameParams = [name: string, updated_at: number, id: string];
type CursorParams = [time: number, id: string];
type SnapshotListParams = [diagramId: string, limit: number];
type HttpMetadata = { contentType?: string };
type StoredObject = { bytes: Uint8Array; httpMetadata?: HttpMetadata };
type PutOptions = { httpMetadata?: HttpMetadata };
/** The env binding the fake wires up after creating the env. */
type RoomBinding = { ROOM: unknown };

/** Minimal D1 stand-in covering exactly the statements store.ts / room.ts use. */
export class FakeD1 {
  diagrams = new Map<string, DiagramRow>();
  snapshots: SnapshotRow[] = [];
  library = new Map<string, string>();
  deleted = new Set<string>();
  event_subscriptions = new Map<string, EventSubscriptionRow>();

  async batch(stmts: FakeStatement[]): Promise<unknown[]> {
    return Promise.all(stmts.map((stmt) => stmt.run()));
  }

  prepare(sql: string) {
    const noBind = {
      run: async (): Promise<Record<string, never>> => {
        this.run(sql, []);
        return {};
      },
      first: async <T>(): Promise<T | null> => {
        return this.first(sql, []) as T | null;
      },
      all: async <T>(): Promise<D1Results<T>> => {
        return { results: this.all(sql, []) as T[] };
      },
    };
    return {
      ...noBind,
      bind: (...params: unknown[]) => {
        return {
          run: async (): Promise<Record<string, never>> => {
            this.run(sql, params);
            return {};
          },
          first: async <T>(): Promise<T | null> => {
            return this.first(sql, params) as T | null;
          },
          all: async <T>(): Promise<D1Results<T>> => {
            return { results: this.all(sql, params) as T[] };
          },
        };
      },
    };
  }

  private run(sql: string, p: unknown[]): void {
    if (sql.startsWith("CREATE ")) return;
    if (sql.includes("INSERT OR IGNORE INTO deleted_diagrams")) {
      this.deleted.add(p[0] as string);
      return;
    }
    if (sql.includes("INSERT OR IGNORE INTO diagram_library")) {
      const [id, key] = p as LibraryInsertParams;
      if (!this.library.has(id)) this.library.set(id, key);
      return;
    }
    if (sql.includes("INSERT INTO diagrams")) {
      if (sql.includes("description")) {
        const [id, name, key_hash, description, created_at, updated_at] = p as DiagramInsertParams;
        this.diagrams.set(id, {
          id,
          name,
          key_hash,
          is_template: 1,
          description,
          created_at,
          updated_at,
        });
      } else {
        const [id, name, key_hash, created_at, updated_at] = p as LegacyDiagramInsertParams;
        this.diagrams.set(id, {
          id,
          name,
          key_hash,
          is_template: 0,
          description: null,
          created_at,
          updated_at,
        });
      }
      return;
    }
    if (sql.includes("INSERT INTO snapshots")) {
      const [id, diagram_id, name, kind, created_at, element_count] = p as SnapshotInsertParams;
      this.snapshots.push({ id, diagram_id, name, kind, created_at, element_count });
      return;
    }
    if (sql.includes("UPDATE diagrams SET name")) {
      const [name, updated_at, id] = p as RenameParams;
      const row = this.diagrams.get(id);
      if (row) {
        row.name = name;
        row.updated_at = updated_at;
      }
      return;
    }
    if (sql.includes("INSERT INTO mcp_event_subscriptions")) {
      const [
        id,
        user_id,
        event_name,
        diagram_id,
        callback_url,
        secret,
        include,
        expires_at,
        authorization_id,
        resource,
        key_hash,
        previous_secret,
        previous_secret_until,
      ] = p as EventSubscriptionParams;
      // ON CONFLICT(id) DO UPDATE: a refresh keeps the row and moves the grant.
      this.event_subscriptions.set(id, {
        id,
        user_id,
        event_name,
        diagram_id,
        callback_url,
        secret,
        include_agent: include,
        expires_at,
        authorization_id,
        resource,
        key_hash,
        previous_secret,
        previous_secret_until,
      });
      return;
    }
    if (sql.includes("DELETE FROM mcp_event_subscriptions")) {
      this.event_subscriptions.delete(p[0] as string);
      return;
    }
    throw new Error(`FakeD1.run: unsupported SQL: ${sql}`);
  }

  private first(sql: string, p: unknown[]): unknown {
    if (sql.includes("FROM mcp_event_subscriptions")) {
      return this.event_subscriptions.get(p[0] as string) ?? null;
    }
    if (sql.includes("FROM diagram_library WHERE diagram_id = ?")) {
      const access_key = this.library.get(p[0] as string);
      return access_key ? { access_key } : null;
    }
    if (sql.includes("FROM diagrams WHERE id = ?"))
      return this.deleted.has(p[0] as string) ? null : (this.diagrams.get(p[0] as string) ?? null);
    throw new Error(`FakeD1.first: unsupported SQL: ${sql}`);
  }

  private all(sql: string, p: unknown[]): unknown[] {
    if (sql.includes("FROM diagrams d LEFT JOIN diagram_library")) {
      const hasCursor = sql.includes("(d.created_at, d.id) <");
      const [time, id] = p as CursorParams;
      const limit = p.at(-1) as number;
      return [...this.diagrams.values()]
        .filter((d) => !d.is_template && !this.deleted.has(d.id))
        .filter((d) => !hasCursor || d.created_at < time || (d.created_at === time && d.id < id))
        .toSorted((a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
        .slice(0, limit)
        .map((d) => ({
          id: d.id,
          name: d.name,
          key: this.library.get(d.id) ?? null,
          createdAt: d.created_at,
        }));
    }
    if (sql.includes("WHERE is_template = 1")) {
      return [...this.diagrams.values()]
        .filter((r) => r.is_template === 1)
        .map((r) => ({ id: r.id, name: r.name, description: r.description }));
    }
    if (sql.includes("FROM snapshots WHERE diagram_id = ?")) {
      const [diagramId, limit] = p as SnapshotListParams;
      return this.snapshots
        .filter((s) => s.diagram_id === diagramId)
        .toSorted((a, b) => b.created_at - a.created_at)
        .slice(0, limit)
        .map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.kind,
          createdAt: s.created_at,
          elements: s.element_count,
        }));
    }
    if (sql.includes("FROM mcp_event_subscriptions")) {
      const [diagram_id, event_name, now] = p as EventSubscriptionFilter;
      return [...this.event_subscriptions.values()].filter(
        (s) => s.diagram_id === diagram_id && s.event_name === event_name && s.expires_at > now,
      );
    }
    throw new Error(`FakeD1.all: unsupported SQL: ${sql}`);
  }
}

/** Minimal R2 stand-in: JSON blobs and binary objects by key. */
export class FakeR2 {
  objects = new Map<string, StoredObject>();

  async put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: PutOptions,
  ): Promise<void> {
    const bytes =
      typeof value === "string"
        ? new TextEncoder().encode(value)
        : new Uint8Array(await new Response(value).arrayBuffer());
    this.objects.set(key, { bytes, httpMetadata: options?.httpMetadata });
  }

  async head(key: string) {
    return this.objects.has(key) ? {} : null;
  }

  async get(key: string) {
    const v = this.objects.get(key);
    if (!v) return null;
    return {
      httpMetadata: v.httpMetadata,
      get body() {
        return new Response(v.bytes).body!;
      },
      json: async () => JSON.parse(new TextDecoder().decode(v.bytes)) as unknown,
    };
  }
}

/** Minimal DO SQLite stand-in covering the elements/meta/tombstones statements room.ts uses. */
export class FakeDOSql {
  elements = new Map<string, string>();
  meta = new Map<string, string>();
  tombstones = new Map<string, number>();

  exec(query: string, ...params: unknown[]): Array<Record<string, string | number>> {
    const q = query.trim();
    if (q.startsWith("CREATE TABLE")) return [];
    if (q.startsWith("SELECT json FROM elements"))
      return [...this.elements.values()].map((json) => ({ json }));
    if (q.startsWith("SELECT id, deleted_at FROM tombstones"))
      return [...this.tombstones].map(([id, at]) => ({ id, deleted_at: at }));
    if (q.startsWith("INSERT OR REPLACE INTO tombstones")) {
      this.tombstones.set(params[0] as string, params[1] as number);
      return [];
    }
    if (q.startsWith("DELETE FROM tombstones WHERE id = ?")) {
      this.tombstones.delete(params[0] as string);
      return [];
    }
    if (q.startsWith("DELETE FROM elements WHERE id = ?")) {
      this.elements.delete(params[0] as string);
      return [];
    }
    if (q.startsWith("SELECT k, v FROM meta"))
      return [...this.meta.entries()].map(([k, v]) => ({ k, v }));
    if (q.startsWith("INSERT OR REPLACE INTO meta")) {
      this.meta.set(params[0] as string, params[1] as string);
      return [];
    }
    if (q.startsWith("INSERT OR REPLACE INTO elements")) {
      this.elements.set(params[0] as string, params[1] as string);
      return [];
    }
    throw new Error(`FakeDOSql.exec: unsupported SQL: ${query}`);
  }
}

export function makeRoomCtx() {
  const sql = new FakeDOSql();
  const sockets = new Set<unknown>();
  const pending: Promise<unknown>[] = [];
  return {
    sql,
    /** Settle everything routed through waitUntil, so event delivery is observable. */
    drain: () => Promise.all(pending),
    ctx: {
      storage: {
        sql,
        transactionSync: <T>(fn: () => T): T => {
          const elements = new Map(sql.elements);
          const meta = new Map(sql.meta);
          const tombstones = new Map(sql.tombstones);
          try {
            return fn();
          } catch (error) {
            sql.elements = elements;
            sql.meta = meta;
            sql.tombstones = tombstones;
            throw error;
          }
        },
      },
      getWebSockets: () => [...sockets],
      acceptWebSocket: (ws: unknown) => {
        sockets.add(ws);
      },
      blockConcurrencyWhile: async (fn: () => Promise<unknown>) => {
        await fn();
      },
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise);
      },
    },
    addWs: (ws: unknown) => {
      sockets.add(ws);
    },
  };
}

/** Fake tab WebSocket with an inspectable attachment and outbox. */
export function makeWs() {
  let attachment: unknown = { selection: [], focusedAt: 0 };
  const sent: string[] = [];
  return {
    sent,
    serializeAttachment: (a: unknown) => {
      attachment = a;
    },
    deserializeAttachment: () => attachment,
    send: (data: string) => {
      sent.push(data);
    },
    close: () => {},
  };
}

export interface TestEnv {
  env: Env;
  db: FakeD1;
  bucket: FakeR2;
  rooms: Map<string, DiagramRoom>;
  kv: FakeKV;
}

/** Env whose ROOM binding serves REAL DiagramRoom instances on fake storage. */
export function makeEnv(): TestEnv {
  const db = new FakeD1();
  const bucket = new FakeR2();
  const rooms = new Map<string, DiagramRoom>();
  const kv = new FakeKV();
  kv.values.set("grant:github%3A1:test-grant", {
    value: JSON.stringify({
      id: "test-grant",
      userId: "github%3A1",
      clientId: "test-client",
      scope: ["mcp:read", "mcp:write"],
      resource: "https://design.example/mcp",
      metadata: { authorizationId: "test-authorization" },
      createdAt: Date.now() / 1000,
    }),
  });
  const env = {
    DB: db,
    BUCKET: bucket,
    ROOM: null,
    OAUTH_KV: kv,
    MCP_EVENT_CALLBACK_HOSTS: "receiver.example.com",
  } as unknown as Env;
  (env as unknown as RoomBinding).ROOM = {
    idFromName: (id: string) => id,
    get: (id: string) => {
      let r = rooms.get(id);
      if (!r) {
        r = new DiagramRoom(makeRoomCtx().ctx as unknown as DurableObjectState, env);
        rooms.set(id, r);
      }
      return r;
    },
  };
  return { env, db, bucket, rooms, kv };
}

/** The execution context Cloudflare passes every Worker fetch. */
export function testCtx(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

/** The principal the OAuth provider hands the MCP handler once a token is verified. */
export function testPrincipal(overrides: Partial<McpPrincipal> = {}): McpPrincipal {
  return {
    userId: "github%3A1",
    authorizationId: "test-authorization",
    resource: "https://design.example/mcp",
    clientId: "test-client",
    scopes: ["mcp:read", "mcp:write"],
    ...overrides,
  };
}

/** A live room on throwaway storage (for room-level tests that bypass HTTP). */
export async function makeRoom(env: Env, id = "test-diagram", name = "Test") {
  const room = new DiagramRoom(makeRoomCtx().ctx as unknown as DurableObjectState, env);
  await room.init(id, name);
  return room;
}
