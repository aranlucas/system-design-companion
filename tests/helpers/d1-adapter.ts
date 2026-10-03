import { strictFake } from "./strict-fake.ts";

interface SqlRows<T> {
  results: T[];
}

interface StatementCore {
  run(): Promise<Record<string, never>>;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<SqlRows<T>>;
}

interface StatementSource<S extends StatementCore> extends StatementCore {
  bind(...values: unknown[]): S;
}

interface DatabaseSource<S extends StatementCore> {
  prepare(query: string): StatementSource<S>;
  batch(statements: S[]): Promise<Record<string, never>[]>;
}

function result<T>(results: T[]): D1Result<T> {
  return { success: true, results, meta: strictFake<D1Response["meta"]>({}) };
}

/** Exposes only the D1 capabilities our SQL backends implement; unsupported metadata throws. */
export function d1Adapter<S extends StatementCore>(source: DatabaseSource<S>): D1Database {
  const statements = new WeakMap<D1PreparedStatement, S>();

  function prepare(query: string, values: unknown[] = []): D1PreparedStatement {
    const underlying = source.prepare(query).bind(...values);

    const statement = strictFake<D1PreparedStatement>({
      bind: (...next) => prepare(query, next),
      async first<T>(column?: string): Promise<T | null> {
        if (column !== undefined)
          throw new Error("Column selection is not implemented by this fake");

        return underlying.first<T>();
      },
      async run<T>(): Promise<D1Result<T>> {
        await underlying.run();

        return result<T>([]);
      },
      async all<T>(): Promise<D1Result<T>> {
        return result((await underlying.all<T>()).results);
      },
    });

    statements.set(statement, underlying);

    return statement;
  }

  return strictFake<D1Database>({
    prepare,
    async batch<T>(batch: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const originals = batch.map((statement) => {
        const original = statements.get(statement);

        if (!original) throw new Error("Statement belongs to another fake database");

        return original;
      });

      const completed = await source.batch(originals);

      return completed.map(() => result<T>([]));
    },
  });
}
