import type { PrismaService } from "../prisma.service.js";

/** Test-only bridge: the caller owns authorization, connection safety, schema,
 * transaction BEGIN/COMMIT/ROLLBACK, and cleanup. No environment/driver lookup,
 * app bootstrap, PrismaClient construction, or copied IngestService behavior. */
export interface SqlQueryResult<T> {
  rows: T[];
  rowCount?: number | null;
  affectedRows?: number;
}
export interface SqlConnection {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<SqlQueryResult<T>>;
}
export interface IngestSqlTransactionProvider {
  transaction<T>(body: (connection: SqlConnection) => Promise<T>): Promise<T>;
}
export interface IngestSqlHooks {
  beforeTransaction?(connection: SqlConnection): Promise<void> | void;
  beforeStatement?(sql: string, params: unknown[], connection: SqlConnection): Promise<void> | void;
  beforeCommit?(connection: SqlConnection): Promise<void> | void;
}

export function createIngestServiceSqlAdapter(
  provider: IngestSqlTransactionProvider,
  hooks: IngestSqlHooks = {},
): PrismaService {
  const adapter = {
    $transaction: async <T>(body: (tx: {
      $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<number>;
    }) => Promise<T>) => provider.transaction(async connection => {
      await hooks.beforeTransaction?.(connection);
      const result = await body({ $executeRawUnsafe: async (sql, ...params) => {
        await hooks.beforeStatement?.(sql, params, connection);
        const executed = await connection.query(sql, params);
        // SELECT counts intentionally remain nonzero: service classification,
        // not this adapter, must exclude health/lock reads from G/L changes.
        return executed.affectedRows ?? executed.rowCount ?? executed.rows.length;
      } });
      await hooks.beforeCommit?.(connection);
      return result;
    }),
  };
  return adapter as unknown as PrismaService;
}
