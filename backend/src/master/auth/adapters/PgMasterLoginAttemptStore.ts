/**
 * PgMasterLoginAttemptStore — tentativas de login Master em PostgreSQL.
 * Best-effort: falhas de persistência nunca devem quebrar o login.
 */
import {
  masterSql,
  toIsoRequired,
  type MasterSqlQuery,
} from '../../adapters/postgres/masterSql.js';
import type {
  MasterLoginAttempt,
  MasterLoginAttemptRecord,
  MasterLoginAttemptStore,
} from '../ports/MasterLoginAttemptStore.js';

type MasterLoginAttemptRow = {
  id: string | number;
  email: string;
  user_id: string | null;
  success: boolean;
  reason: string | null;
  ip: string | null;
  device: string | null;
  created_at: Date | string;
};

function mapRow(row: MasterLoginAttemptRow): MasterLoginAttemptRecord {
  return {
    id: String(row.id),
    email: row.email,
    userId: row.user_id,
    success: Boolean(row.success),
    reason: row.reason,
    ip: row.ip,
    device: row.device,
    createdAt: toIsoRequired(row.created_at),
  };
}

export class PgMasterLoginAttemptStore implements MasterLoginAttemptStore {
  constructor(private readonly sql: MasterSqlQuery = masterSql) {}

  async record(attempt: MasterLoginAttempt): Promise<void> {
    await this.sql(
      `INSERT INTO public.master_login_attempts (email, user_id, success, reason, ip, device)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        String(attempt.email || '').trim().toLowerCase(),
        attempt.userId ?? null,
        attempt.success,
        attempt.reason ?? null,
        attempt.ip ?? null,
        attempt.device ?? null,
      ],
    );
  }

  async recentByEmail(email: string, limit = 20): Promise<MasterLoginAttemptRecord[]> {
    const result = await this.sql<MasterLoginAttemptRow>(
      `SELECT * FROM public.master_login_attempts
        WHERE lower(email) = lower($1)
        ORDER BY created_at DESC
        LIMIT $2`,
      [email.trim(), limit],
    );
    return result.rows.map(mapRow);
  }
}
