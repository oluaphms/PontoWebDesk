/**
 * Helpers de persistência PostgreSQL do Painel Master.
 * Usa pool.queryMaster (RLS tenant desligada).
 */
import { pool } from '../../../db/index.js';
import type { QueryResult, QueryResultRow } from 'pg';

export type MasterSqlQuery = <R extends QueryResultRow = QueryResultRow>(
  queryText: string,
  values?: unknown[],
) => Promise<QueryResult<R>>;

/** Query padrão do control plane Master. */
export const masterSql: MasterSqlQuery = (queryText, values) =>
  pool.queryMaster(queryText, values);

export function toIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const s = String(value);
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : s || null;
}

export function toIsoRequired(value: unknown, fallback = new Date().toISOString()): string {
  return toIso(value) ?? fallback;
}

export function asJson(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function jsonParam(value: unknown): string {
  return JSON.stringify(value ?? {});
}
