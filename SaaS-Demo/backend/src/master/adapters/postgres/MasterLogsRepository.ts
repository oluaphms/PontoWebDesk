/**
 * MasterLogsRepository — logs do dashboard Master em PostgreSQL.
 */
import { randomUUID } from 'node:crypto';
import type {
  DashboardLogEntry,
  DashboardLogLevel,
  MasterDashboardModuleId,
} from '../../dashboard/dashboard.types.js';
import type { AppendLogInput } from '../../dashboard/modules/logs.module.js';
import {
  asJson,
  jsonParam,
  masterSql,
  toIsoRequired,
  type MasterSqlQuery,
} from './masterSql.js';

type LogRow = {
  id: string;
  module: string;
  level: string;
  action: string;
  message: string;
  at: Date | string;
  meta: unknown;
};

function mapRow(row: LogRow): DashboardLogEntry {
  return {
    id: row.id,
    module: row.module as DashboardLogEntry['module'],
    level: row.level as DashboardLogLevel,
    action: row.action,
    message: row.message,
    at: toIsoRequired(row.at),
    meta: asJson(row.meta),
  };
}

/**
 * Compatível com DashboardLogsModule (mesma superfície async).
 */
export class MasterLogsRepository {
  constructor(private readonly sql: MasterSqlQuery = masterSql) {}

  async append(input: AppendLogInput): Promise<DashboardLogEntry> {
    const id = `log_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const at = new Date().toISOString();
    const result = await this.sql<LogRow>(
      `INSERT INTO public.master_logs (id, module, level, action, message, at, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       RETURNING *`,
      [
        id,
        input.module,
        input.level ?? 'info',
        input.action,
        input.message,
        at,
        jsonParam(input.meta ?? {}),
      ],
    );
    return mapRow(result.rows[0]);
  }

  async list(limit = 100): Promise<DashboardLogEntry[]> {
    const safe = Math.min(Math.max(1, Math.floor(limit)), 500);
    const result = await this.sql<LogRow>(
      `SELECT * FROM public.master_logs ORDER BY at DESC LIMIT $1`,
      [safe],
    );
    return result.rows.map(mapRow);
  }

  async listByModule(
    module: MasterDashboardModuleId | 'system',
    limit = 100,
  ): Promise<DashboardLogEntry[]> {
    const safe = Math.min(Math.max(1, Math.floor(limit)), 500);
    const result = await this.sql<LogRow>(
      `SELECT * FROM public.master_logs WHERE module = $1 ORDER BY at DESC LIMIT $2`,
      [module, safe],
    );
    return result.rows.map(mapRow);
  }

  async count(): Promise<number> {
    const result = await this.sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.master_logs`,
    );
    return Number(result.rows[0]?.n || 0);
  }

  clear(): void {
    void this.sql(`DELETE FROM public.master_logs`);
  }
}
