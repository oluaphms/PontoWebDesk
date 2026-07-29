/**
 * PgMasterUserStore — usuários Master persistidos em PostgreSQL (public.master_users).
 * Ativado quando MASTER_PERSISTENCE=postgres. Não altera auth operacional.
 */
import {
  asJson,
  jsonParam,
  masterSql,
  toIsoRequired,
  type MasterSqlQuery,
} from '../../adapters/postgres/masterSql.js';
import type { MasterRole, MasterUser } from '../masterAuth.types.js';
import type { MasterUserStore } from '../ports/MasterUserStore.js';

type MasterUserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  password_hash: string;
  active: boolean;
  is_founder: boolean | null;
  meta: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

function mapRow(row: MasterUserRow): MasterUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as MasterRole,
    passwordHash: row.password_hash,
    active: Boolean(row.active),
    isFounder: row.is_founder === true,
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
    meta: asJson(row.meta),
  };
}

export class PgMasterUserStore implements MasterUserStore {
  constructor(private readonly sql: MasterSqlQuery = masterSql) {}

  async save(user: MasterUser): Promise<MasterUser> {
    const result = await this.sql<MasterUserRow>(
      `INSERT INTO public.master_users (
         id, email, name, role, password_hash, active, is_founder, meta, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         name = EXCLUDED.name,
         role = EXCLUDED.role,
         password_hash = EXCLUDED.password_hash,
         active = EXCLUDED.active,
         is_founder = CASE
           WHEN public.master_users.is_founder IS TRUE THEN TRUE
           ELSE EXCLUDED.is_founder
         END,
         meta = EXCLUDED.meta,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [
        user.id,
        user.email.trim().toLowerCase(),
        user.name,
        user.role,
        user.passwordHash,
        user.active,
        user.isFounder === true,
        jsonParam(user.meta ?? {}),
        user.createdAt,
        user.updatedAt,
      ],
    );
    return mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<MasterUser | null> {
    const result = await this.sql<MasterUserRow>(
      `SELECT * FROM public.master_users WHERE id = $1 LIMIT 1`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findByEmail(email: string): Promise<MasterUser | null> {
    const result = await this.sql<MasterUserRow>(
      `SELECT * FROM public.master_users WHERE lower(email) = lower($1) LIMIT 1`,
      [email.trim()],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async list(): Promise<MasterUser[]> {
    const result = await this.sql<MasterUserRow>(
      `SELECT * FROM public.master_users ORDER BY created_at ASC`,
    );
    return result.rows.map(mapRow);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.sql(
      `DELETE FROM public.master_users WHERE id = $1 AND is_founder IS NOT TRUE RETURNING id`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
