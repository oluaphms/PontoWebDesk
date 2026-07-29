/**
 * MasterAuditRepository — auditoria HTTP Master em PostgreSQL.
 * Fase 5: IP, navegador, empresa, antes/depois.
 * Fase 5.1: append-only (somente INSERT — sem UPDATE/UPSERT/DELETE/clear).
 */
import { randomUUID } from 'node:crypto';
import type {
  MasterAuditAppendInput,
  MasterAuditEntry,
  MasterAuditPage,
  MasterAuditQuery,
} from '../../api/services/audit.service.js';
import {
  AUDIT_FAILURE_SQL,
  decodeAuditCursor,
  encodeAuditCursor,
  normalizeAuditQuery,
  snapshotForAudit,
} from '../../api/services/audit.service.js';
import {
  asJson,
  jsonParam,
  masterSql,
  toIsoRequired,
  type MasterSqlQuery,
} from './masterSql.js';

type AuditRow = {
  id: string;
  at: Date | string;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_role?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  action: string;
  resource: string;
  message: string;
  before_state?: unknown;
  after_state?: unknown;
  meta: unknown;
};

function nullableJson(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function mapRow(row: AuditRow): MasterAuditEntry {
  const meta = asJson(row.meta);
  return {
    id: row.id,
    at: toIsoRequired(row.at),
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    actorRole: row.actor_role ?? (typeof meta.actorRole === 'string' ? meta.actorRole : null),
    ip: row.ip ?? (typeof meta.ip === 'string' ? meta.ip : null),
    userAgent:
      row.user_agent ?? (typeof meta.userAgent === 'string' ? meta.userAgent : null),
    companyId:
      row.company_id ??
      (typeof meta.companyId === 'string'
        ? meta.companyId
        : typeof meta.tenantId === 'string'
          ? meta.tenantId
          : null),
    companyName:
      row.company_name ??
      (typeof meta.companyName === 'string' ? meta.companyName : null),
    action: row.action,
    resource: row.resource,
    message: row.message,
    before: nullableJson(row.before_state) ?? nullableJson(meta.before),
    after: nullableJson(row.after_state) ?? nullableJson(meta.after),
    meta,
  };
}

export class MasterAuditRepository {
  constructor(private readonly sql: MasterSqlQuery = masterSql) {}

  async append(input: MasterAuditAppendInput): Promise<MasterAuditEntry> {
    const id = `aud_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const at = new Date().toISOString();
    return this.insert({
      id,
      at,
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail ?? null,
      actorRole: input.actorRole ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      companyId: input.companyId ?? null,
      companyName: input.companyName ?? null,
      action: input.action,
      resource: input.resource,
      message: input.message,
      before: input.before ? snapshotForAudit(input.before) : null,
      after: input.after ? snapshotForAudit(input.after) : null,
      meta: input.meta,
    });
  }

  /**
   * Dual-write a partir do AuditService InMemory.
   * Somente INSERT — nunca sobrescreve (Fase 5.1 append-only).
   */
  async save(entry: MasterAuditEntry): Promise<MasterAuditEntry> {
    return this.insert(entry);
  }

  private async insert(entry: MasterAuditEntry): Promise<MasterAuditEntry> {
    const result = await this.sql<AuditRow>(
      `INSERT INTO public.master_audit (
         id, at, actor_user_id, actor_email, actor_role,
         ip, user_agent, company_id, company_name,
         action, resource, message, before_state, after_state, meta
       ) VALUES (
         $1,$2,$3,$4,$5,
         $6,$7,$8,$9,
         $10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb
       )
       RETURNING *`,
      [
        entry.id,
        entry.at,
        entry.actorUserId ?? null,
        entry.actorEmail ?? null,
        entry.actorRole ?? null,
        entry.ip ?? null,
        entry.userAgent ?? null,
        entry.companyId ?? null,
        entry.companyName ?? null,
        entry.action,
        entry.resource,
        entry.message,
        entry.before == null ? null : jsonParam(entry.before),
        entry.after == null ? null : jsonParam(entry.after),
        jsonParam(entry.meta ?? {}),
      ],
    );
    return mapRow(result.rows[0]);
  }

  async list(limit = 100): Promise<MasterAuditEntry[]> {
    const safe = Math.min(Math.max(1, Math.floor(limit)), 500);
    const result = await this.sql<AuditRow>(
      `SELECT * FROM public.master_audit ORDER BY at DESC, id DESC LIMIT $1`,
      [safe],
    );
    return result.rows.map(mapRow);
  }

  async count(): Promise<number> {
    const result = await this.sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.master_audit`,
    );
    return Number(result.rows[0]?.n || 0);
  }

  /**
   * Consulta escalável direto no PostgreSQL (Fase 5.2).
   * Filtros server-side + paginação (offset/cursor) + ordenação.
   * Não usa buffer em memória.
   */
  async query(query: MasterAuditQuery = {}): Promise<MasterAuditPage> {
    const q = normalizeAuditQuery(query);
    const where: string[] = [];
    const params: unknown[] = [];
    const push = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    if (q.from) where.push(`at >= ${push(q.from)}`);
    if (q.to) where.push(`at <= ${push(q.to)}`);
    if (q.companyId) where.push(`company_id = ${push(q.companyId)}`);
    if (q.ip) where.push(`ip ILIKE ${push(`%${q.ip}%`)}`);
    if (q.resource) where.push(`resource = ${push(q.resource)}`);
    if (q.action) where.push(`action ILIKE ${push(`${q.action}%`)}`);
    if (q.actor) {
      where.push(
        `(actor_user_id = ${push(q.actor)} OR actor_email ILIKE ${push(`%${q.actor}%`)})`,
      );
    }
    if (q.result === 'failure') where.push(AUDIT_FAILURE_SQL);
    else if (q.result === 'success') where.push(`NOT (${AUDIT_FAILURE_SQL})`);

    // Keyset (cursor) — precede offset.
    const cursor = decodeAuditCursor(q.cursor);
    if (cursor) {
      const atParam = push(cursor.at);
      const idParam = push(cursor.id);
      const cmp = q.order === 'asc' ? '>' : '<';
      where.push(`(at, id) ${cmp} (${atParam}, ${idParam})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const dir = q.order === 'asc' ? 'ASC' : 'DESC';

    const countResult = await this.sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.master_audit ${whereSql}`,
      params,
    );
    const total = Number(countResult.rows[0]?.n || 0);

    const limitParam = push(q.limit);
    let sql = `SELECT * FROM public.master_audit ${whereSql} ORDER BY at ${dir}, id ${dir} LIMIT ${limitParam}`;
    let effectiveOffset = 0;
    if (!cursor && q.offset > 0) {
      const offsetParam = push(q.offset);
      sql += ` OFFSET ${offsetParam}`;
      effectiveOffset = q.offset;
    }

    const result = await this.sql<AuditRow>(sql, params);
    const rows = result.rows.map(mapRow);
    const last = rows[rows.length - 1];
    const consumed = (cursor ? 0 : effectiveOffset) + rows.length;
    const hasMore = consumed < total;
    return {
      rows,
      total,
      limit: q.limit,
      offset: effectiveOffset,
      order: q.order,
      nextCursor: hasMore && last ? encodeAuditCursor(last) : null,
      hasMore,
    };
  }
}
