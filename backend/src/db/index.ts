import { observabilityConsole } from '../logger/observabilityConsole.js';
import '../loadEnv.js';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { buildPgPoolConfig } from './pgConfig.js';
import { applyTenantRlsSession } from './tenantRls.js';

const pgConfig = buildPgPoolConfig();
const hasDbTarget = Boolean(
  pgConfig.connectionString ||
    (pgConfig.host && pgConfig.user && pgConfig.database),
);

const innerPool = new Pool(pgConfig);

async function withTenantRlsClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await innerPool.connect();
  try {
    await applyTenantRlsSession(client);
    return await fn(client);
  } finally {
    client.release();
  }
}

export const pool = {
  query<R extends QueryResultRow = QueryResultRow>(
    queryText: string,
    values?: unknown[],
  ): Promise<QueryResult<R>> {
    return withTenantRlsClient((client) => client.query<R>(queryText, values));
  },
  connect(): Promise<PoolClient> {
    return innerPool.connect().then(async (client) => {
      await applyTenantRlsSession(client);
      return client;
    });
  },
  end(): Promise<void> {
    return innerPool.end();
  },
  on(event: string, listener: (...args: unknown[]) => void): typeof innerPool {
    return innerPool.on(event, listener);
  },
};

export async function checkDatabaseConnection(): Promise<boolean> {
  if (!hasDbTarget) return false;
  try {
    const client = await pool.connect();
    try {
      await client.query('select 1 as ok');
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    observabilityConsole.error('[DB] conexão falhou:', err);
    return false;
  }
}
