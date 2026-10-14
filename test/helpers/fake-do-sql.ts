import { z } from "zod";

/** Minimal DO SQLite stand-in covering the elements/meta/tombstones statements room.ts uses. */
export class FakeDOSql {
  elements = new Map<string, string>();
  meta = new Map<string, string>();
  tombstones = new Map<string, number>();

  exec(query: string, ...params: unknown[]): Array<Record<string, string | number>> {
    const q = query.trim();

    if (q.startsWith("CREATE TABLE")) {
      return [];
    }

    if (q.startsWith("SELECT json FROM elements")) {
      return [...this.elements.values()].map((json) => ({ json }));
    }

    if (q.startsWith("SELECT id, deleted_at FROM tombstones")) {
      return [...this.tombstones].map(([id, at]) => ({ id, deleted_at: at }));
    }

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

    if (q.startsWith("SELECT k, v FROM meta")) {
      return [...this.meta.entries()].map(([k, v]) => ({ k, v }));
    }

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
