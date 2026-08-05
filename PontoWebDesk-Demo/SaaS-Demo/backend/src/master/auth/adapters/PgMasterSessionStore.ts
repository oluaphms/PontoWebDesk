/**
 * PgMasterSessionStore — sessões Master persistidas em PostgreSQL (public.master_sessions).
 * Ativado quando MASTER_PERSISTENCE=postgres. Sobrevive a restart do backend.
 */
import {
  masterSql,
  toIso,
  toIsoRequired,
  type MasterSqlQuery,
} from '../../adapters/postgres/masterSql.js';
import type {
  MasterSessionRecord,
  MasterSessionStore,
} from '../ports/MasterSessionStore.js';

type MasterSessionRow = {
  id: string;
  user_id: string;
  jti: string;
  refresh_family_id: string;
  refresh_token_hash: string;
  used_refresh_hashes: unknown;
  device: string | null;
  ip: string | null;
  issued_at: Date | string;
  last_activity_at: Date | string;
  access_expires_at: Date | string;
  refresh_expires_at: Date | string;
  revoked_at: Date | string | null;
  revoke_reason: string | null;
};

function toHashArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapRow(row: MasterSessionRow): MasterSessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    jti: row.jti,
    refreshFamilyId: row.refresh_family_id,
    refreshTokenHash: row.refresh_token_hash,
    usedRefreshHashes: toHashArray(row.used_refresh_hashes),
    device: row.device,
    ip: row.ip,
    issuedAt: toIsoRequired(row.issued_at),
    lastActivityAt: toIsoRequired(row.last_activity_at),
    accessExpiresAt: toIsoRequired(row.access_expires_at),
    refreshExpiresAt: toIsoRequired(row.refresh_expires_at),
    revokedAt: toIso(row.revoked_at),
    revokeReason: row.revoke_reason,
  };
}

export class PgMasterSessionStore implements MasterSessionStore {
  constructor(private readonly sql: MasterSqlQuery = masterSql) {}

  async save(row: MasterSessionRecord): Promise<MasterSessionRecord> {
    const result = await this.sql<MasterSessionRow>(
      `INSERT INTO public.master_sessions (
         id, user_id, jti, refresh_family_id, refresh_token_hash, used_refresh_hashes,
         device, ip, issued_at, last_activity_at, access_expires_at, refresh_expires_at,
         revoked_at, revoke_reason
       ) VALUES (
         $1,$2,$3,$4,$5,$6::jsonb,
         $7,$8,$9,$10,$11,$12,
         $13,$14
       )
       ON CONFLICT (id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         jti = EXCLUDED.jti,
         refresh_family_id = EXCLUDED.refresh_family_id,
         refresh_token_hash = EXCLUDED.refresh_token_hash,
         used_refresh_hashes = EXCLUDED.used_refresh_hashes,
         device = EXCLUDED.device,
         ip = EXCLUDED.ip,
         last_activity_at = EXCLUDED.last_activity_at,
         access_expires_at = EXCLUDED.access_expires_at,
         refresh_expires_at = EXCLUDED.refresh_expires_at,
         revoked_at = EXCLUDED.revoked_at,
         revoke_reason = EXCLUDED.revoke_reason
       RETURNING *`,
      [
        row.id,
        row.userId,
        row.jti,
        row.refreshFamilyId,
        row.refreshTokenHash,
        JSON.stringify(row.usedRefreshHashes ?? []),
        row.device,
        row.ip,
        row.issuedAt,
        row.lastActivityAt,
        row.accessExpiresAt,
        row.refreshExpiresAt,
        row.revokedAt,
        row.revokeReason,
      ],
    );
    return mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<MasterSessionRecord | null> {
    const result = await this.sql<MasterSessionRow>(
      `SELECT * FROM public.master_sessions WHERE id = $1 LIMIT 1`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findByJti(jti: string): Promise<MasterSessionRecord | null> {
    const result = await this.sql<MasterSessionRow>(
      `SELECT * FROM public.master_sessions WHERE jti = $1 LIMIT 1`,
      [jti],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findByRefreshHash(hash: string): Promise<MasterSessionRecord | null> {
    const result = await this.sql<MasterSessionRow>(
      `SELECT * FROM public.master_sessions
        WHERE refresh_token_hash = $1
           OR used_refresh_hashes @> to_jsonb($1::text)
        ORDER BY last_activity_at DESC
        LIMIT 1`,
      [hash],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async listByUser(userId: string): Promise<MasterSessionRecord[]> {
    const result = await this.sql<MasterSessionRow>(
      `SELECT * FROM public.master_sessions
        WHERE user_id = $1
        ORDER BY issued_at DESC`,
      [userId],
    );
    return result.rows.map(mapRow);
  }

  async listActiveByUser(userId: string): Promise<MasterSessionRecord[]> {
    const result = await this.sql<MasterSessionRow>(
      `SELECT * FROM public.master_sessions
        WHERE user_id = $1
          AND revoked_at IS NULL
          AND refresh_expires_at > now()
        ORDER BY issued_at DESC`,
      [userId],
    );
    return result.rows.map(mapRow);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.sql(
      `DELETE FROM public.master_sessions WHERE id = $1 RETURNING id`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async clear(): Promise<void> {
    await this.sql(`DELETE FROM public.master_sessions`);
  }
}
