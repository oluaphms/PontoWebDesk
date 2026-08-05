import type { PoolConfig } from 'pg';

/**
 * Monta config do Pool sem depender só do parser de URL do `pg`
 * (senhas com @ e URLs mal formadas geram "client password must be a string").
 */
export function buildPgPoolConfig(): PoolConfig {
  const host = process.env.PGHOST || process.env.PG_HOST;
  const port = process.env.PGPORT || process.env.PG_PORT;
  const user = process.env.PGUSER || process.env.PG_USER;
  const password = process.env.PGPASSWORD || process.env.PG_PASSWORD;
  const database = process.env.PGDATABASE || process.env.PG_DATABASE;

  if (host && user && database) {
    const sslEnabled =
      process.env.DATABASE_SSL === 'true' ||
      process.env.DATABASE_SSL === '1' ||
      process.env.PGSSLMODE === 'require';
    return {
      host,
      port: port ? Number(port) : 5432,
      user,
      password: password != null ? String(password) : undefined,
      database,
      ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
      max: Number(process.env.PG_POOL_MAX || 20),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    };
  }

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    return {
      max: Number(process.env.PG_POOL_MAX || 20),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    };
  }

  try {
    const parsed = new URL(connectionString);
    const sslEnabled =
      process.env.DATABASE_SSL === 'true' ||
      process.env.DATABASE_SSL === '1' ||
      process.env.PGSSLMODE === 'require';
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 5432,
      user: decodeURIComponent(parsed.username || ''),
      password: String(decodeURIComponent(parsed.password || '')),
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '') || ''),
      ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
      max: Number(process.env.PG_POOL_MAX || 20),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    };
  } catch {
    const sslEnabled =
      process.env.DATABASE_SSL === 'true' ||
      process.env.DATABASE_SSL === '1' ||
      process.env.PGSSLMODE === 'require';
    return {
      connectionString,
      ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
      max: Number(process.env.PG_POOL_MAX || 20),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    };
  }
}
