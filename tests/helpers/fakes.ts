// In-memory fakes for Cloudflare bindings (D1, R2, Durable Object storage/sockets)
// so worker logic can be exercised under vitest without workerd.
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

/** Minimal D1 stand-in covering exactly the statements store.ts / room.ts use. */
export class FakeD1 {
  diagrams = new Map<string, DiagramRow>();
  snapshots: SnapshotRow[] = [];

  async batch(_stmts: unknown[]): Promise<unknown[]> {
    return []; // ensureSchema() DDL: no-op
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
      // oxlint-disable-next-line no-unnecessary-type-parameters
      all: async <T>(): Promise<{ results: T[] }> => {
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
          // oxlint-disable-next-line no-unnecessary-type-parameters
          all: async <T>(): Promise<{ results: T[] }> => {
            return { results: this.all(sql, params) as T[] };
          },
        };
      },
    };
  }

  private run(sql: string, p: unknown[]): void {
    if (sql.includes("INSERT INTO diagrams")) {
      if (sql.includes("description")) {
        const [id, name, key_hash, description, created_at, updated_at] = p as [
          string,
          string,
          string,
          string | null,
          number,
          number,
        ];
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
        const [id, name, key_hash, created_at, updated_at] = p as [
          string,
          string,
          string,
          number,
          number,
        ];
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
      const [id, diagram_id, name, kind, created_at, element_count] = p as [
        string,
        string,
        string,
        string,
        number,
        number,
      ];
      this.snapshots.push({ id, diagram_id, name, kind, created_at, element_count });
      return;
    }
    if (sql.includes("UPDATE diagrams SET name")) {
      const [name, updated_at, id] = p as [string, number, string];
      const row = this.diagrams.get(id);
      if (row) {
        row.name = name;
        row.updated_at = updated_at;
      }
      return;
    }
    throw new Error(`FakeD1.run: unsupported SQL: ${sql}`);
  }

  private first(sql: string, p: unknown[]): unknown {
    if (sql.includes("FROM diagrams WHERE id = ?"))
      return this.diagrams.get(p[0] as string) ?? null;
    throw new Error(`FakeD1.first: unsupported SQL: ${sql}`);
  }

  private all(sql: string, p: unknown[]): unknown[] {
    if (sql.includes("WHERE is_template = 1")) {
      return [...this.diagrams.values()]
        .filter((r) => r.is_template === 1)
        .map((r) => ({ id: r.id, name: r.name, description: r.description }));
    }
    if (sql.includes("FROM snapshots WHERE diagram_id = ?")) {
      const [diagramId, limit] = p as [string, number];
      return this.snapshots
        .filter((s) => s.diagram_id === diagramId)
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, limit)
        .map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.kind,
          createdAt: s.created_at,
          elements: s.element_count,
        }));
    }
    throw new Error(`FakeD1.all: unsupported SQL: ${sql}`);
  }
}

/** Minimal R2 stand-in: put/get JSON blobs by key. */
export class FakeR2 {
  objects = new Map<string, string>();

  async put(key: string, value: string): Promise<void> {
    this.objects.set(key, value);
  }

  async get(key: string): Promise<{ json: () => Promise<unknown> } | null> {
    const v = this.objects.get(key);
    if (v === undefined) return null;
    return { json: async () => JSON.parse(v) as unknown };
  }
}

/** Minimal DO SQLite stand-in covering the elements/meta statements room.ts uses. */
export class FakeDOSql {
  elements = new Map<string, string>();
  meta = new Map<string, string>();

  exec(query: string, ...params: unknown[]): Array<Record<string, string>> {
    const q = query.trim();
    if (q.startsWith("CREATE TABLE")) return [];
    if (q.startsWith("SELECT json FROM elements"))
      return [...this.elements.values()].map((json) => ({ json }));
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
  return {
    sql,
    ctx: {
      storage: { sql },
      getWebSockets: () => [...sockets],
      acceptWebSocket: (ws: unknown) => {
        sockets.add(ws);
      },
      blockConcurrencyWhile: async (fn: () => Promise<unknown>) => {
        await fn();
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
}

/** Env whose ROOM binding serves REAL DiagramRoom instances on fake storage. */
export function makeEnv(): TestEnv {
  const db = new FakeD1();
  const bucket = new FakeR2();
  const rooms = new Map<string, DiagramRoom>();
  const env = { DB: db, BUCKET: bucket, ROOM: null } as unknown as Env;
  (env as unknown as { ROOM: unknown }).ROOM = {
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
  return { env, db, bucket, rooms };
}

/** A live room on throwaway storage (for room-level tests that bypass HTTP). */
export async function makeRoom(env: Env, id = "test-diagram", name = "Test") {
  const room = new DiagramRoom(makeRoomCtx().ctx as unknown as DurableObjectState, env);
  await room.init(id, name);
  return room;
}
