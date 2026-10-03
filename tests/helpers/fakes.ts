import type { JsonValue } from "../../src/shared/schemas.ts";

const libraryInsertParamsSchema = z.tuple([
  z.string(),
  z.string(),
]) satisfies z.ZodType<LibraryInsertParams>;

const eventSubscriptionParamsSchema = z.tuple([
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.number(),
  z.number(),
  z.string(),
  z.string(),
  z.string(),
  z.string().nullable(),
  z.number(),
]) satisfies z.ZodType<EventSubscriptionParams>;

const eventSubscriptionFilterSchema = z.tuple([
  z.string(),
  z.string(),
  z.number(),
]) satisfies z.ZodType<EventSubscriptionFilter>;

const diagramInsertParamsSchema = z.tuple([
  z.string(),
  z.string(),
  z.string(),
  z.string().nullable(),
  z.number(),
  z.number(),
]) satisfies z.ZodType<DiagramInsertParams>;

const legacyDiagramInsertParamsSchema = z.tuple([
  z.string(),
  z.string(),
  z.string(),
  z.number(),
  z.number(),
]) satisfies z.ZodType<LegacyDiagramInsertParams>;

const snapshotInsertParamsSchema = z.tuple([
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.number(),
  z.number(),
]) satisfies z.ZodType<SnapshotInsertParams>;

const renameParamsSchema = z.tuple([
  z.string(),
  z.number(),
  z.string(),
]) satisfies z.ZodType<RenameParams>;

const cursorParamsSchema = z.tuple([z.number(), z.string()]) satisfies z.ZodType<CursorParams>;

const snapshotListParamsSchema = z.tuple([
  z.string(),
  z.number(),
]) satisfies z.ZodType<SnapshotListParams>;

import { z } from "zod";
import { awaitedRpc, type OwnerMethods } from "./awaited-rpc.ts";
import { d1Adapter } from "./d1-adapter.ts";
import { strictFake } from "./strict-fake.ts";
import type { Viewport } from "../../src/shared/protocol.ts";
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

type BudgetEntry = { window: number; count: number };

type FakeStatement = { run: () => Promise<Record<string, never>> };

type KvEntry = { value: string; expiration?: number };

/** KV persistence shared by real OAuthProvider instances in integration tests. */
export class FakeKV {
  readonly values = new Map<string, KvEntry>();
  get(key: string, options?: Partial<KVNamespaceGetOptions<undefined>>): Promise<string | null>;
  get(key: string, type: "text"): Promise<string | null>;
  get<ExpectedValue = JsonValue>(key: string, type: "json"): Promise<ExpectedValue | null>;
  get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
  get(key: string, type: "stream"): Promise<ReadableStream | null>;
  get(key: string, options?: KVNamespaceGetOptions<"text">): Promise<string | null>;
  get<ExpectedValue = JsonValue>(
    key: string,
    options?: KVNamespaceGetOptions<"json">,
  ): Promise<ExpectedValue | null>;
  get(key: string, options?: KVNamespaceGetOptions<"arrayBuffer">): Promise<ArrayBuffer | null>;
  get(key: string, options?: KVNamespaceGetOptions<"stream">): Promise<ReadableStream | null>;
  get(key: Array<string>, type: "text"): Promise<Map<string, string | null>>;
  get<ExpectedValue = JsonValue>(
    key: Array<string>,
    type: "json",
  ): Promise<Map<string, ExpectedValue | null>>;
  get(
    key: Array<string>,
    options?: Partial<KVNamespaceGetOptions<undefined>>,
  ): Promise<Map<string, string | null>>;
  get(
    key: Array<string>,
    options?: KVNamespaceGetOptions<"text">,
  ): Promise<Map<string, string | null>>;
  get<ExpectedValue = JsonValue>(
    key: Array<string>,
    options?: KVNamespaceGetOptions<"json">,
  ): Promise<Map<string, ExpectedValue | null>>;
  async get<T = JsonValue>(
    key: string | string[],
    options?:
      | Partial<KVNamespaceGetOptions<undefined | "text" | "json" | "arrayBuffer" | "stream">>
      | "json"
      | "text"
      | "arrayBuffer"
      | "stream",
  ): Promise<string | T | ArrayBuffer | ReadableStream | null | Map<string, string | T | null>> {
    const kind = z.string().safeParse(options);

    const format = kind.success
      ? kind.data
      : z.object({ type: z.string().optional() }).parse(options ?? {}).type;

    const read = (name: string) => {
      const entry = this.values.get(name);

      return !entry || (entry.expiration && entry.expiration <= Date.now() / 1000)
        ? null
        : entry.value;
    };

    const json = (value: string | null): T | null => {
      if (value === null) return null;

      // SAFETY: KV's generic JSON overload delegates the serialized value contract to its caller, exactly as JSON.parse does; this fake does not claim schema validation.
      return JSON.parse(value) as T;
    };

    if (Array.isArray(key)) {
      if (format !== undefined && format !== "text" && format !== "json")
        throw new Error("Unsupported multi-key KV format");

      return new Map(key.map((name) => [name, format === "json" ? json(read(name)) : read(name)]));
    }

    const value = read(key);

    if (value === null) return null;

    if (format === "json") return json(value);

    if (format === "arrayBuffer") return new Response(value).arrayBuffer();

    if (format === "stream") return new Response(value).body!;

    return value;
  }
  async put(
    key: string,
    input: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: KVNamespacePutOptions,
  ): Promise<void> {
    const value = await new Response(input).text();
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
  async list<Metadata = JsonValue>(
    options: KVNamespaceListOptions = {},
  ): Promise<KVNamespaceListResult<Metadata>> {
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
      cacheStatus: null,
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

/** Minimal D1 stand-in covering exactly the statements store.ts / room.ts use. */
type CountRow = { count: number };

type OwnerRow = { user_id: string };

type AccessRow = { access_key: string };

type LibraryResult = { id: string; name: string; key: string | null; createdAt: number };

type TemplateResult = { id: string; name: string; description: string | null };

type SnapshotResult = {
  id: string;
  name: string;
  kind: string;
  createdAt: number;
  elements: number;
};

type DatabaseRow =
  | DiagramRow
  | EventSubscriptionRow
  | CountRow
  | OwnerRow
  | AccessRow
  | LibraryResult
  | TemplateResult
  | SnapshotResult;

export class FakeD1 {
  owners = new Map<string, string>();
  budgets = new Map<string, BudgetEntry>();
  diagrams = new Map<string, DiagramRow>();
  snapshots: SnapshotRow[] = [];
  library = new Map<string, string>();
  deleted = new Set<string>();
  event_subscriptions = new Map<string, EventSubscriptionRow>();

  async batch(stmts: FakeStatement[]): Promise<Record<string, never>[]> {
    return Promise.all(stmts.map((stmt) => stmt.run()));
  }

  prepare(sql: string) {
    const noBind = {
      run: async (): Promise<Record<string, never>> => {
        this.run(sql, []);

        return {};
      },
      first: async <T>(): Promise<T | null> => {
        // SAFETY: The supported SQL dispatcher constructs the rows for this statement; T is the caller-selected result contract of the D1 API. Unsupported statements throw.
        return this.first(sql, []) as T | null;
      },
      all: async <T>(): Promise<D1Results<T>> => {
        // SAFETY: The supported SQL dispatcher constructs the rows for this statement; T is the caller-selected result contract of the D1 API. Unsupported statements throw.
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
            // SAFETY: The supported SQL dispatcher constructs the rows for this statement; T is the caller-selected result contract of the D1 API. Unsupported statements throw.
            return this.first(sql, params) as T | null;
          },
          all: async <T>(): Promise<D1Results<T>> => {
            // SAFETY: The supported SQL dispatcher constructs the rows for this statement; T is the caller-selected result contract of the D1 API. Unsupported statements throw.
            return { results: this.all(sql, params) as T[] };
          },
        };
      },
    };
  }

  private run(sql: string, p: unknown[]): void {
    if (sql.startsWith("CREATE ")) return;

    if (sql.includes("INSERT INTO diagram_owners")) {
      this.owners.set(z.string().parse(p[0]), z.string().parse(p[1]));

      return;
    }

    if (sql.includes("INSERT OR IGNORE INTO deleted_diagrams")) {
      this.deleted.add(z.string().parse(p[0]));

      return;
    }

    if (sql.includes("INSERT OR IGNORE INTO diagram_library")) {
      const [id, key] = libraryInsertParamsSchema.parse(p);

      if (!this.library.has(id)) this.library.set(id, key);

      return;
    }

    if (sql.includes("INSERT INTO diagrams")) {
      if (sql.includes("description")) {
        const [id, name, key_hash, description, created_at, updated_at] =
          diagramInsertParamsSchema.parse(p);

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
        const [id, name, key_hash, created_at, updated_at] =
          legacyDiagramInsertParamsSchema.parse(p);

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
      const [id, diagram_id, name, kind, created_at, element_count] =
        snapshotInsertParamsSchema.parse(p);

      this.snapshots.push({ id, diagram_id, name, kind, created_at, element_count });

      return;
    }

    if (sql.includes("UPDATE diagrams SET name")) {
      const [name, updated_at, id] = renameParamsSchema.parse(p);
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
      ] = eventSubscriptionParamsSchema.parse(p);

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

    if (sql.includes("DELETE FROM snapshots WHERE id")) {
      this.snapshots = this.snapshots.filter((row) => row.id !== p[0]);

      return;
    }

    if (sql.includes("DELETE FROM snapshots WHERE diagram_id")) {
      this.snapshots = this.snapshots.filter((row) => row.diagram_id !== p[0]);

      return;
    }

    if (sql.includes("DELETE FROM diagram_library")) {
      this.library.delete(z.string().parse(p[0]));

      return;
    }

    if (sql.includes("DELETE FROM diagrams WHERE id")) {
      this.diagrams.delete(z.string().parse(p[0]));

      return;
    }

    if (sql.includes("DELETE FROM mcp_event_subscriptions WHERE diagram_id")) {
      for (const [id, row] of this.event_subscriptions)
        if (row.diagram_id === p[0]) this.event_subscriptions.delete(id);

      return;
    }

    if (sql.includes("DELETE FROM mcp_event_subscriptions")) {
      this.event_subscriptions.delete(z.string().parse(p[0]));

      return;
    }

    throw new Error(`FakeD1.run: unsupported SQL: ${sql}`);
  }

  private first(sql: string, p: unknown[]): DatabaseRow | null {
    if (sql.includes("INSERT INTO request_budgets")) {
      const key = z.string().parse(p[0]);
      const window = z.number().parse(p[1]);
      const limit = z.number().parse(p[2]);
      const existing = this.budgets.get(key);

      if (existing?.window === window && existing.count >= limit) return null;
      const count = existing?.window === window ? existing.count + 1 : 1;
      this.budgets.set(key, { window, count });

      return { count };
    }

    if (sql.includes("FROM diagram_owners")) {
      const user_id = this.owners.get(z.string().parse(p[0]));

      return user_id ? { user_id } : null;
    }

    if (sql.includes("FROM mcp_event_subscriptions")) {
      return this.event_subscriptions.get(z.string().parse(p[0])) ?? null;
    }

    if (sql.includes("FROM diagram_library WHERE diagram_id = ?")) {
      const access_key = this.library.get(z.string().parse(p[0]));

      return access_key ? { access_key } : null;
    }

    if (sql.includes("FROM diagrams WHERE id = ?"))
      return this.deleted.has(z.string().parse(p[0]))
        ? null
        : (this.diagrams.get(z.string().parse(p[0])) ?? null);
    throw new Error(`FakeD1.first: unsupported SQL: ${sql}`);
  }

  private all(sql: string, p: unknown[]): DatabaseRow[] {
    if (sql.includes("FROM diagrams d LEFT JOIN diagram_library")) {
      const hasCursor = sql.includes("(d.created_at, d.id) <");
      const [time, id] = hasCursor ? cursorParamsSchema.parse(p.slice(1, 3)) : [0, ""];
      const limit = z.number().parse(p.at(-1));

      return [...this.diagrams.values()]
        .filter((d) => !d.is_template && !this.deleted.has(d.id))
        .filter((d) => this.owners.get(d.id) === p[0])
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
      return [...this.diagrams.values()].flatMap((r) =>
        r.is_template === 1 && !this.deleted.has(r.id) && this.owners.get(r.id) === p[0]
          ? [{ id: r.id, name: r.name, description: r.description }]
          : [],
      );
    }

    if (sql.includes("FROM snapshots WHERE diagram_id = ?")) {
      const [diagramId, limit] = snapshotListParamsSchema.parse(p);

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
      const [diagram_id, event_name, now] = eventSubscriptionFilterSchema.parse(p);

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
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options?: R2PutOptions,
  ): Promise<R2Object> {
    if (options?.onlyIf) throw new Error("Conditional R2 writes are not implemented");
    const text = z.string().safeParse(value);

    const bytes = text.success
      ? new TextEncoder().encode(text.data)
      : new Uint8Array(await new Response(value).arrayBuffer());

    const httpMetadata =
      options?.httpMetadata instanceof Headers
        ? { contentType: options.httpMetadata.get("content-type") ?? undefined }
        : options?.httpMetadata;

    this.objects.set(key, { bytes, httpMetadata });

    return strictFake<R2Object>({ key, size: bytes.length }, { nonThenable: true });
  }

  async list(options: R2ListOptions = {}): Promise<R2Objects> {
    return {
      truncated: false,
      delimitedPrefixes: [],
      objects: [...this.objects.keys()].flatMap((key) =>
        key.startsWith(options.prefix ?? "")
          ? [strictFake<R2Object>({ key }, { nonThenable: true })]
          : [],
      ),
    };
  }

  async delete(keys: string | string[]) {
    for (const key of [keys].flat()) this.objects.delete(key);
  }

  async head(key: string) {
    return this.objects.has(key) ? strictFake<R2Object>({ key }, { nonThenable: true }) : null;
  }

  async get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null> {
    if (options?.onlyIf || options?.range)
      throw new Error("Conditional/ranged R2 reads are not implemented");
    const v = this.objects.get(key);

    if (!v) return null;

    return strictFake<R2ObjectBody>(
      {
        httpMetadata: v.httpMetadata ?? {},
        get body() {
          return new Response(v.bytes).body!;
        },
        json: async <T>() => {
          // SAFETY: R2 json<T> uses the caller-selected decoded JSON contract; this mirrors that API rather than claiming runtime validation.
          return JSON.parse(new TextDecoder().decode(v.bytes)) as T;
        },
      },
      { nonThenable: true },
    );
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
      this.tombstones.set(z.string().parse(params[0]), z.number().parse(params[1]));

      return [];
    }

    if (q === "DELETE FROM elements") {
      this.elements.clear();

      return [];
    }

    if (q === "DELETE FROM tombstones") {
      this.tombstones.clear();

      return [];
    }

    if (q === "DELETE FROM meta") {
      this.meta.clear();

      return [];
    }

    if (q.startsWith("DELETE FROM tombstones WHERE id = ?")) {
      this.tombstones.delete(z.string().parse(params[0]));

      return [];
    }

    if (q.startsWith("DELETE FROM elements WHERE id = ?")) {
      this.elements.delete(z.string().parse(params[0]));

      return [];
    }

    if (q.startsWith("SELECT k, v FROM meta"))
      return [...this.meta.entries()].map(([k, v]) => ({ k, v }));

    if (q.startsWith("INSERT OR REPLACE INTO meta")) {
      this.meta.set(z.string().parse(params[0]), z.string().parse(params[1]));

      return [];
    }

    if (q.startsWith("INSERT OR REPLACE INTO elements")) {
      this.elements.set(z.string().parse(params[0]), z.string().parse(params[1]));

      return [];
    }

    throw new Error(`FakeDOSql.exec: unsupported SQL: ${query}`);
  }
}

type StoredSqlRow = Record<string, string | number>;

function sqliteCursor<T extends Record<string, SqlStorageValue>>(
  rows: StoredSqlRow[],
): SqlStorageCursor<T> {
  // SAFETY: FakeDOSql dispatches only supported SQL statements and constructs their declared columns. T is the caller-selected row contract of the real SqlStorage.exec API; unsupported statements throw.
  const typed = rows as T[];
  const iterator = typed.values();

  return strictFake<SqlStorageCursor<T>>({
    [Symbol.iterator]: () => typed.values(),
    next: () => iterator.next(),
    toArray: () => [...typed],
    one: () => {
      if (typed.length !== 1) throw new Error("Expected exactly one SQL row");

      return typed[0];
    },
    columnNames: Object.keys(rows[0] ?? {}),
    rowsRead: rows.length,
    rowsWritten: 0,
  });
}

export function makeRoomCtx() {
  const sql = new FakeDOSql();
  const sockets = new Set<WebSocket>();
  const pending: Promise<unknown>[] = [];

  const storage = strictFake<DurableObjectStorage>({
    sql: strictFake<SqlStorage>({
      exec: <T extends Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]) =>
        sqliteCursor<T>(sql.exec(query, ...bindings)),
    }),
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
  });

  const ctx = strictFake<DurableObjectState>({
    storage,
    getWebSockets: () => [...sockets],
    acceptWebSocket: (ws: WebSocket) => {
      sockets.add(ws);
    },
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => await fn(),
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
  });

  return {
    sql,
    drain: () => Promise.all(pending),
    ctx,
    addWs: (ws: WebSocket) => {
      sockets.add(ws);
    },
  };
}

interface FakeAttachment {
  sid?: string;
  username?: string;
  selection: string[];
  focusedAt: number;
  viewport?: Viewport;
}

interface InspectableSocket extends WebSocket {
  sent: string[];
  serializeAttachment: (attachment: FakeAttachment) => void;
  deserializeAttachment: () => FakeAttachment;
}

/** A typed fake tab socket; unimplemented platform members throw through strictFake. */
export function makeWs(): InspectableSocket {
  let attachment: FakeAttachment = { selection: [], focusedAt: 0 };
  const sent: string[] = [];

  return strictFake<InspectableSocket>({
    sent,
    serializeAttachment: (value: FakeAttachment) => {
      attachment = value;
    },
    deserializeAttachment: () => attachment,
    send: (data: string | ArrayBuffer | ArrayBufferView) => {
      if (data instanceof ArrayBuffer || ArrayBuffer.isView(data))
        throw new Error("Fake tab expects text frames");
      sent.push(data);
    },
    close: () => {},
  });
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
  kv.values.set(
    "browser-session:bafde89c041e1756082b933aaf16cad8e65dec48de748479352f657e89dd6da5",
    {
      value: JSON.stringify({ userId: "github%3A1", expiresAt: Date.now() + 60_000 }),
    },
  );
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

  const env: Env = {
    ASSETS: strictFake<Fetcher>({}),
    ROOM: strictFake<DurableObjectNamespace<DiagramRoom>>({}),
    DB: d1Adapter(db),
    BUCKET: strictFake<R2Bucket>(bucket),
    OAUTH_KV: strictFake<KVNamespace>(kv),
    GITHUB_CLIENT_ID: "",
    GITHUB_CLIENT_SECRET: "",
    MCP_EVENT_CALLBACK_HOSTS: "receiver.example.com",
  };

  env.ROOM = strictFake<DurableObjectNamespace<DiagramRoom>>({
    idFromName: (name: string) => strictFake<DurableObjectId>({ name, toString: () => name }),
    get: (objectId: DurableObjectId) => {
      const id = objectId.toString();
      let r = rooms.get(id);

      if (!r) {
        r = new DiagramRoom(makeRoomCtx().ctx, env);
        rooms.set(id, r);
      }

      const room = r;

      const methods = {
        getGraph: (...args) => room.getGraph(...args),
        getSelection: (...args) => room.getSelection(...args),
        seed: (...args) => room.seed(...args),
        applyPatch: (...args) => room.applyPatch(...args),
        importMermaid: (...args) => room.importMermaid(...args),
        getRaw: (...args) => room.getRaw(...args),
        init: (...args) => room.init(...args),
        deactivate: (...args) => room.deactivate(...args),
        erase: (...args) => room.erase(...args),
        rename: (...args) => room.rename(...args),
        info: (...args) => room.info(...args),
        tidy: (...args) => room.tidy(...args),
        layout: (...args) => room.layout(...args),
        screenshot: (...args) => room.screenshot(...args),
        focusView: (...args) => room.focusView(...args),
        snapshot: (...args) => room.snapshot(...args),
        listSnapshots: (...args) => room.listSnapshots(...args),
        restore: (...args) => room.restore(...args),
        saveAsTemplate: (...args) => room.saveAsTemplate(...args),
      } satisfies OwnerMethods<Omit<DiagramRoom, "fetch" | "connect">>;

      return awaitedRpc<DiagramRoom>(methods, (input, init) =>
        room.fetch(input instanceof Request && !init ? input : new Request(input, init)),
      );
    },
  });

  return { env, db, bucket, rooms, kv };
}

/** The execution context Cloudflare passes every Worker fetch. */
export function testCtx(): ExecutionContext {
  return strictFake<ExecutionContext>({
    waitUntil: () => {},
    passThroughOnException: () => {},
  });
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
  const room = new DiagramRoom(makeRoomCtx().ctx, env);
  await room.init(id, name);

  return room;
}
