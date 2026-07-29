import { observabilityConsole } from '../logger/observabilityConsole.js';
import '../loadEnv.js';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { buildPgPoolConfig } from './pgConfig.js';
import {
  applyTenantRlsTransaction,
  applyTrustedBootstrapRlsTransaction,
  applyMasterControlPlaneRlsTransaction,
} from './tenantRls.js';
import {
  getMasterDomainTxClient,
  masterDomainTxAls,
  type MasterDomainTxStore,
} from './masterDomainTx.js';

export {
  getMasterDomainTxClient,
  isMasterDomainTransactionActive,
  recordMasterDomainStep,
} from './masterDomainTx.js';

const pgConfig = buildPgPoolConfig();
const hasDbTarget = Boolean(
  pgConfig.connectionString ||
    (pgConfig.host && pgConfig.user && pgConfig.database),
);

const innerPool = new Pool(pgConfig);
const POOL_INSTANCE_ID = `innerPool_${process.pid}_${Date.now()}`;

/** Diagnóstico somente leitura: expõe a instância e a config efetiva do Pool. */
export function getPoolDiagnostics(): {
  file: string;
  poolLine: number;
  exportLine: number;
  functionName: string;
  poolInstance: string;
  connectionString: string | null;
  host: string | null;
  port: number | null;
  database: string | null;
  user: string | null;
} {
  const fromEnvUrl = process.env.DATABASE_URL?.trim() || null;
  return {
    file: 'backend/src/db/index.ts',
    poolLine: 17,
    exportLine: 123,
    functionName: 'withRlsTransaction(bootstrap) via queryTrustedBootstrap / withTrustedBootstrapClient',
    poolInstance: POOL_INSTANCE_ID,
    connectionString: pgConfig.connectionString
      ? String(pgConfig.connectionString)
      : fromEnvUrl,
    host: pgConfig.host != null ? String(pgConfig.host) : null,
    port: pgConfig.port != null ? Number(pgConfig.port) : null,
    database: pgConfig.database != null ? String(pgConfig.database) : null,
    user: pgConfig.user != null ? String(pgConfig.user) : null,
  };
}

/** Executa callback na mesma conexão/transação bootstrap (RLS off). Só diagnóstico/uso interno. */
export function withTrustedBootstrapClient<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withRlsTransaction('bootstrap', fn);
}

type QueryFn = PoolClient['query'];

function extractQueryText(args: unknown[]): string | null {
  const first = args[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object' && 'text' in (first as Record<string, unknown>)) {
    return String((first as { text?: unknown }).text ?? '');
  }
  return null;
}

function isBeginStatement(sql: string | null): boolean {
  return Boolean(sql && /^\s*(begin|start\s+transaction)\b/i.test(sql));
}

/**
 * Após BEGIN explícito, aplica GUCs de tenant na mesma transação.
 * Necessário porque set_config(..., true) é local à transação.
 */
function wrapClientWithTenantRls(client: PoolClient): PoolClient {
  const originalQuery = client.query.bind(client) as QueryFn;
  const wrappedQuery = ((...args: unknown[]) => {
    const text = extractQueryText(args);
    const begin = isBeginStatement(text);
    const result = (originalQuery as (...a: unknown[]) => unknown)(...args);
    if (!begin) return result;
    return Promise.resolve(result).then(async (queryResult) => {
      await applyTenantRlsTransaction(client);
      return queryResult;
    });
  }) as QueryFn;
  client.query = wrappedQuery;
  return client;
}

async function withRlsTransaction<T>(
  mode: 'tenant' | 'bootstrap' | 'master',
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await innerPool.connect();
  try {
    await client.query('BEGIN');
    try {
      if (mode === 'bootstrap') {
        await applyTrustedBootstrapRlsTransaction(client);
      } else if (mode === 'master') {
        await applyMasterControlPlaneRlsTransaction(client);
      } else {
        await applyTenantRlsTransaction(client);
      }
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback failure
      }
      throw error;
    }
  } finally {
    client.release();
  }
}

/**
 * Fronteira transacional do domínio Master.
 * Vários writers (queryMaster) no callback compartilham o mesmo BEGIN/COMMIT.
 * Chamadas aninhadas fazem join na mesma conexão.
 */
export async function runMasterDomainTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  options?: { crashAfterStep?: string | null },
): Promise<T> {
  const existing = masterDomainTxAls.getStore();
  if (existing?.client) {
    existing.depth += 1;
    const prevCrash = existing.crashAfterStep;
    if (options?.crashAfterStep != null) existing.crashAfterStep = options.crashAfterStep;
    try {
      return await fn(existing.client);
    } finally {
      existing.crashAfterStep = prevCrash;
      existing.depth -= 1;
    }
  }

  return withRlsTransaction('master', async (client) => {
    const store: MasterDomainTxStore = {
      client,
      depth: 1,
      crashAfterStep: options?.crashAfterStep ?? null,
      steps: [],
    };
    return masterDomainTxAls.run(store, () => fn(client));
  });
}

export const pool = {
  query<R extends QueryResultRow = QueryResultRow>(
    queryText: string,
    values?: unknown[],
  ): Promise<QueryResult<R>> {
    return withRlsTransaction('tenant', (client) => client.query<R>(queryText, values));
  },

  /**
   * Consultas de bootstrap autenticado (login / revalidação de JWT).
   * Mantém RLS desligada na transação apenas para descobrir o tenant após
   * validar credenciais ou assinatura JWT — não altera AuthSessionProvider.
   */
  queryTrustedBootstrap<R extends QueryResultRow = QueryResultRow>(
    queryText: string,
    values?: unknown[],
  ): Promise<QueryResult<R>> {
    return withRlsTransaction('bootstrap', (client) => client.query<R>(queryText, values));
  },

  /**
   * Consultas do Painel Master (control plane).
   * RLS de tenant desligada — tabelas master_* não usam company_id operacional.
   * Se houver MasterDomainTransaction ativa, junta na mesma TX (crash-safe).
   */
  queryMaster<R extends QueryResultRow = QueryResultRow>(
    queryText: string,
    values?: unknown[],
  ): Promise<QueryResult<R>> {
    const txClient = getMasterDomainTxClient();
    if (txClient) {
      return txClient.query<R>(queryText, values);
    }
    return withRlsTransaction('master', (client) => client.query<R>(queryText, values));
  },

  connect(): Promise<PoolClient> {
    return innerPool.connect().then((client) => wrapClientWithTenantRls(client));
  },

  end(): Promise<void> {
    return innerPool.end();
  },

  on: innerPool.on.bind(innerPool) as typeof innerPool.on,
};

export async function checkDatabaseConnection(): Promise<boolean> {
  if (!hasDbTarget) return false;
  try {
    const client = await innerPool.connect();
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
