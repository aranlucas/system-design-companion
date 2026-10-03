// Execute lifecycle SQL locally, including D1's transactional batch semantics.
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";

interface SqlRows<T> {
  results: T[];
}

type Row = Record<string, SQLOutputValue>;

function isSqlInput(value: unknown): value is SQLInputValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    ArrayBuffer.isView(value)
  )
    return true;

  return false;
}

class SQLiteStatement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]) {
    const params = values.map((value) => {
      if (isSqlInput(value)) return value;
      throw new Error("Unsupported SQL parameter");
    });

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
    // SAFETY: node:sqlite supplies the row for this SQL statement; T is the caller-selected D1 result contract, not a claim of runtime schema validation.
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T>(): Promise<SqlRows<T>> {
    // SAFETY: node:sqlite supplies rows for this SQL statement; T is the caller-selected D1 result contract.
    return { results: this.db.prepare(this.sql).all(...this.params) as T[] };
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
