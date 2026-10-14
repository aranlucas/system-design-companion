import { promiseResult } from "@/shared/promise-result.ts";
import { FakeKV } from "@test/helpers/fake-kv.ts";
import { FakeD1 } from "@test/helpers/fake-d1.ts";
import { FakeR2 } from "@test/helpers/fake-r2.ts";
import { FakeDOSql } from "@test/helpers/fake-do-sql.ts";
import { awaitedRpc, type OwnerMethods } from "@test/helpers/awaited-rpc.ts";
import { d1Adapter } from "@test/helpers/d1-adapter.ts";
import { strictFake } from "@test/helpers/strict-fake.ts";
import type { Viewport } from "@/shared/protocol.ts";
import type { McpPrincipal } from "@/worker/principal.ts";
import { DiagramRoom } from "@/worker/room.ts";

export { FakeKV } from "@test/helpers/fake-kv.ts";

export {
  FakeD1,
  type DiagramRow,
  type SnapshotRow,
  type EventSubscriptionRow,
} from "@test/helpers/fake-d1.ts";

export { FakeR2 } from "@test/helpers/fake-r2.ts";

export { FakeDOSql } from "@test/helpers/fake-do-sql.ts";

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
      if (typed.length !== 1) {
        throw new Error("Expected exactly one SQL row");
      }

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
    blockConcurrencyWhile: <T>(fn: () => Promise<T>) => promiseResult(() => fn()),
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
      if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
        throw new TypeError("Fake tab expects text frames");
      }

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
    ROOM: strictFake<DurableObjectNamespace<DiagramRoom>>({
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
    }),
    DB: d1Adapter(db),
    BUCKET: strictFake<R2Bucket>(bucket),
    OAUTH_KV: strictFake<KVNamespace>(kv),
    GITHUB_CLIENT_ID: "",
    GITHUB_CLIENT_SECRET: "",
    MCP_EVENT_CALLBACK_HOSTS: "receiver.example.com",
  };

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
