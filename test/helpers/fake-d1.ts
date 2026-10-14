import { promiseResult } from "@/shared/promise-result.ts";
import { z } from "zod";

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

  batch(stmts: FakeStatement[]): Promise<Record<string, never>[]> {
    return promiseResult(() => {
      return Promise.all(stmts.map((stmt) => stmt.run()));
    });
  }

  prepare(sql: string) {
    const noBind = {
      run: (): Promise<Record<string, never>> => {
        return promiseResult(() => {
          this.run(sql, []);

          return {};
        });
      },
      first: <T>(): Promise<T | null> => {
        return promiseResult(() => {
          // SAFETY: The supported SQL dispatcher constructs the rows for this statement; T is the caller-selected result contract of the D1 API. Unsupported statements throw.
          return this.first(sql, []) as T | null;
        });
      },
      all: <T>(): Promise<D1Results<T>> => {
        return promiseResult(() => {
          // SAFETY: The supported SQL dispatcher constructs the rows for this statement; T is the caller-selected result contract of the D1 API. Unsupported statements throw.
          return { results: this.all(sql, []) as T[] };
        });
      },
    };

    return {
      ...noBind,
      bind: (...params: unknown[]) => {
        return {
          run: (): Promise<Record<string, never>> => {
            return promiseResult(() => {
              this.run(sql, params);

              return {};
            });
          },
          first: <T>(): Promise<T | null> => {
            return promiseResult(() => {
              // SAFETY: The supported SQL dispatcher constructs the rows for this statement; T is the caller-selected result contract of the D1 API. Unsupported statements throw.
              return this.first(sql, params) as T | null;
            });
          },
          all: <T>(): Promise<D1Results<T>> => {
            return promiseResult(() => {
              // SAFETY: The supported SQL dispatcher constructs the rows for this statement; T is the caller-selected result contract of the D1 API. Unsupported statements throw.
              return { results: this.all(sql, params) as T[] };
            });
          },
        };
      },
    };
  }

  private run(sql: string, p: unknown[]): void {
    if (sql.startsWith("CREATE ")) {
      return;
    }

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

      if (!this.library.has(id)) {
        this.library.set(id, key);
      }

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
      for (const [id, row] of this.event_subscriptions) {
        if (row.diagram_id === p[0]) {
          this.event_subscriptions.delete(id);
        }
      }

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

      if (existing?.window === window && existing.count >= limit) {
        return null;
      }

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

    if (sql.includes("FROM diagrams WHERE id = ?")) {
      return this.deleted.has(z.string().parse(p[0]))
        ? null
        : (this.diagrams.get(z.string().parse(p[0])) ?? null);
    }

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
