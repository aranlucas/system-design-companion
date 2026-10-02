// Execute lifecycle SQL locally, including D1's transactional batch semantics.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

type Row = Record<string, unknown>;

class SQLiteStatement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: SQLInputValue[] = [],
  ) {}

  bind(...params: SQLInputValue[]) {
    return new SQLiteStatement(this.db, this.sql, params);
  }

  execute() {
    this.db.prepare(this.sql).run(...this.params);
    return {};
  }

  async run() {
    return this.execute();
  }

  async first<T = Row>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all() {
    return { results: this.db.prepare(this.sql).all(...this.params) };
  }
}

export class SQLiteD1 {
  readonly sql = new DatabaseSync(":memory:");

  prepare(sql: string) {
    return new SQLiteStatement(this.sql, sql);
  }

  async batch(statements: SQLiteStatement[]) {
    this.sql.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.execute());
      this.sql.exec("COMMIT");
      return results;
    } catch (error) {
      this.sql.exec("ROLLBACK");
      throw error;
    }
  }
}
