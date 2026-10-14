import { DatabaseSync } from "node:sqlite";
import { SQLiteStatement } from "@test/helpers/sqlite-statement.ts";
import { promiseResult } from "@/shared/promise-result.ts";

export class SQLiteD1 {
  readonly sql = new DatabaseSync(":memory:");

  prepare(sql: string) {
    return new SQLiteStatement(this.sql, sql);
  }

  batch(statements: SQLiteStatement[]) {
    return promiseResult(() => {
      this.sql.exec("BEGIN");

      try {
        const results = statements.map((statement) => statement.execute());
        this.sql.exec("COMMIT");

        return results;
      } catch (error) {
        this.sql.exec("ROLLBACK");
        throw error;
      }
    });
  }
}
