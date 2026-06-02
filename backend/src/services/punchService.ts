import { pool } from '../db/index.js';
import { getPunchColumns, getTimeRecordColumns, getTimeRecordInsertRpc } from './punchSchema.js';
import { validatePhotoUrl } from '../upload/fileValidation.js';
import type { PoolClient } from 'pg';
import { logger } from '../logger/logger.js';

type PunchInput = {
  client_id?: string;
  userId?: string;
  user_id?: string;
  companyId?: string;
  company_id?: string;
  timestamp?: string;
  type?: string;
  punch_hash?: string;
  [key: string]: unknown;
};

function safePunchHash(p: PunchInput): string {
  const value = String(p.punch_hash || '').trim();
  if (value) return value;
  const userId = String(p.user_id || p.userId || '').trim();
  const companyId = String(p.company_id || p.companyId || '').trim();
  const type = String(p.type || '').trim();
  const ts = String(p.timestamp || '').trim();
  return `${companyId}:${userId}:${type}:${ts}`;
}

function normalizeSource(input: unknown): string {
  const source = String(input || 'web').trim().toLowerCase();
  if (!source) return 'web';
  if (source === 'mobile' || source === 'app') return 'web';
  return source;
}

function normalizeType(raw: unknown): string {
  const type = String(raw || '').trim().toLowerCase();
  if (!type) return '';
  if (type === 'in' || type === 'clock_in' || type === 'entrada') return 'entrada';
  if (type === 'out' || type === 'clock_out' || type === 'saida' || type === 'saída') return 'saida';
  if (type === 'break_start' || type === 'intervalo_saida') return 'intervalo_saida';
  if (type === 'break_end' || type === 'intervalo_volta') return 'intervalo_volta';
  return type;
}

function buildRpcMetadata(punch: PunchInput, punchHash: string, photoUrl: string | null): Record<string, unknown> {
  return {
    method: String(punch.method || 'api').trim() || 'api',
    source: normalizeSource(punch.source),
    photo_url: photoUrl,
    punch_hash: punchHash,
    payload: punch,
  };
}

async function insertIntoTimeRecordsViaRpc(
  client: PoolClient,
  input: {
    userId: string;
    companyId: string;
    type: string;
    timestamp: string;
    source: string;
    punchHash: string;
    photoUrl: string | null;
    punch: PunchInput;
  },
): Promise<{ id: string | null }> {
  const rpc = await getTimeRecordInsertRpc();
  if (!rpc.fnName) return { id: null };
  const args = [
    input.userId,
    input.companyId,
    input.timestamp,
    input.type,
    input.source,
    JSON.stringify(buildRpcMetadata(input.punch, input.punchHash, input.photoUrl)),
    false,
  ];
  const sql = `select public.${rpc.fnName}($1::uuid, $2::uuid, $3::timestamptz, $4::text, $5::text, $6::jsonb, $7::boolean) as result`;
  const result = await client.query(sql, args);
  const payload = result.rows[0]?.result;
  logger.info({
    module: 'punch.service',
    action: 'TIME_RECORDS_INSERT_RPC',
    message: 'RPC de insert em time_records executada',
    userId: input.userId,
    companyId: input.companyId,
    meta: {
      employeeId: input.userId,
      sql,
      params: args,
      returnedRows: result.rowCount ?? result.rows.length,
      result: payload ?? null,
    },
  });
  if (!payload || typeof payload !== 'object') return { id: null };
  const row = payload as Record<string, unknown>;
  const idValue = row.id ?? row.record_id ?? null;
  return { id: idValue == null ? null : String(idValue) };
}

async function insertIntoTimeRecordsFallback(
  client: PoolClient,
  input: {
    userId: string;
    companyId: string;
    type: string;
    timestamp: string;
    source: string;
    punchHash: string;
    photoUrl: string | null;
    punch: PunchInput;
  },
): Promise<{ id: string }> {
  const cols = await getTimeRecordColumns();
  const userIdCast = cols.userIdType === 'uuid' ? 'uuid' : 'text';
  const companyIdCast = cols.companyIdType === 'uuid' ? 'uuid' : 'text';
  const columns = ['user_id', 'company_id', 'type'];
  const values: unknown[] = [input.userId, input.companyId, input.type];
  const cast: string[] = [`$1::${userIdCast}`, `$2::${companyIdCast}`, '$3::text'];

  if (cols.hasTimestamp) {
    columns.push('timestamp');
    values.push(input.timestamp);
    cast.push(`$${values.length}::timestamptz`);
  } else if (cols.hasCreatedAt) {
    columns.push('created_at');
    values.push(input.timestamp);
    cast.push(`$${values.length}::timestamptz`);
  }

  if (cols.hasMethod) {
    columns.push('method');
    values.push(String(input.punch.method || 'api').trim() || 'api');
    cast.push(`$${values.length}::text`);
  }
  if (cols.hasSource) {
    columns.push('source');
    values.push(input.source);
    cast.push(`$${values.length}::text`);
  }
  if (cols.hasPunchHash) {
    columns.push('punch_hash');
    values.push(input.punchHash);
    cast.push(`$${values.length}::text`);
  }
  if (cols.hasMetadata) {
    columns.push('metadata');
    values.push(JSON.stringify(buildRpcMetadata(input.punch, input.punchHash, input.photoUrl)));
    cast.push(`$${values.length}::jsonb`);
  }
  if (cols.hasPhotoUrl) {
    columns.push('photo_url');
    values.push(input.photoUrl);
    cast.push(`$${values.length}::text`);
  }

  const sql = `insert into time_records (${columns.join(', ')})
     values (${cast.join(', ')})
     returning id`;
  const inserted = await client.query(sql, values);
  logger.info({
    module: 'punch.service',
    action: 'TIME_RECORDS_INSERT_FALLBACK',
    message: 'Insert fallback em time_records executado',
    userId: input.userId,
    companyId: input.companyId,
    meta: {
      employeeId: input.userId,
      sql,
      params: values,
      returnedRows: inserted.rowCount ?? inserted.rows.length,
      timeRecordId: inserted.rows[0]?.id ?? null,
    },
  });
  return { id: String(inserted.rows[0]?.id || '') };
}

async function promoteExistingPunchIfNeeded(client: PoolClient, punchId: string): Promise<void> {
  const id = String(punchId || '').trim();
  if (!id) return;
  try {
    await client.query('select public.promote_punch_to_time_record($1::uuid)', [id]);
  } catch {
    // Ambientes sem a migration continuam compatíveis; a API não deve falhar em duplicidade.
  }
}

export async function insertPunchSafe(punch: PunchInput): Promise<{ success: boolean; duplicate?: boolean; id?: string; punch_hash: string }> {
  const companyId = String(punch.company_id || punch.companyId || '').trim();
  const userId = String(punch.user_id || punch.userId || '').trim();
  const type = normalizeType(punch.type);
  const timestamp = String(punch.timestamp || new Date().toISOString()).trim();
  const punchHash = safePunchHash(punch);

  if (!companyId || !userId || !type) {
    return { success: false, punch_hash: punchHash };
  }

  const rawPhoto = punch.photo_url ?? punch.photoUrl;
  const photoCheck = validatePhotoUrl(rawPhoto == null ? null : String(rawPhoto));
  if (!photoCheck.ok) {
    return { success: false, punch_hash: punchHash };
  }
  const photoUrl = 'url' in photoCheck ? photoCheck.url || null : null;

  const cols = await getPunchColumns();
  const source = normalizeSource(punch.source);
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (cols.hasPunchHash) {
      const existing = await client.query(
        'select id from punches where punch_hash = $1 limit 1',
        [punchHash],
      );
      if (existing.rowCount && existing.rows[0]?.id) {
        await promoteExistingPunchIfNeeded(client, String(existing.rows[0].id));
        await client.query('commit');
        return { success: true, duplicate: true, id: String(existing.rows[0].id), punch_hash: punchHash };
      }
    }

    let mirrorRecordId: string | null = null;
    try {
      const rpcInsert = await insertIntoTimeRecordsViaRpc(client, {
        userId,
        companyId,
        type,
        timestamp,
        source,
        punchHash,
        photoUrl,
        punch,
      });
      mirrorRecordId = rpcInsert.id;
    } catch {
      mirrorRecordId = null;
    }
    if (!mirrorRecordId) {
      const fallbackInsert = await insertIntoTimeRecordsFallback(client, {
        userId,
        companyId,
        type,
        timestamp,
        source,
        punchHash,
        photoUrl,
        punch,
      });
      mirrorRecordId = fallbackInsert.id;
    }
    logger.info({
      module: 'punch.service',
      action: 'PUNCH_TIME_RECORD_CREATED',
      message: 'Registro de ponto espelhado em time_records',
      userId,
      companyId,
      meta: {
        employeeId: userId,
        timeRecordId: mirrorRecordId,
        type,
        timestamp,
        source,
      },
    });

    if (cols.mode === 'api_legacy') {
      const payload = {
        ...punch,
        punch_hash: punchHash,
        photo_url: photoUrl,
        mirror_record_id: mirrorRecordId,
      };
      const inserted = await client.query(
        `insert into punches (company_id, user_id, type, timestamp, punch_hash, payload)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [companyId, userId, type, timestamp, punchHash, JSON.stringify(payload)],
      );
      await client.query('commit');
      return { success: true, id: String(inserted.rows[0]?.id || ''), punch_hash: punchHash };
    }

    if (cols.hasPhotoUrl) {
      const inserted = await client.query(
        `insert into punches (employee_id, company_id, type, method, created_at, source, raw_data, photo_url)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning id`,
        [
          userId,
          companyId,
          type,
          String(punch.method || 'api').trim() || 'api',
          timestamp,
          source,
          JSON.stringify({ ...punch, punch_hash: punchHash, mirror_record_id: mirrorRecordId }),
          photoUrl,
        ],
      );
      await client.query('commit');
      return { success: true, id: String(inserted.rows[0]?.id || ''), punch_hash: punchHash };
    }

    const inserted = await client.query(
      `insert into punches (employee_id, company_id, type, method, created_at, source, raw_data)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [
        userId,
        companyId,
        type,
        String(punch.method || 'api').trim() || 'api',
        timestamp,
        source,
        JSON.stringify({
          ...punch,
          punch_hash: punchHash,
          photo_url: photoUrl,
          mirror_record_id: mirrorRecordId,
        }),
      ],
    );
    await client.query('commit');
    return { success: true, id: String(inserted.rows[0]?.id || ''), punch_hash: punchHash };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function insertPunchBatchSafe(punches: PunchInput[]): Promise<Array<{ client_id?: string; success?: boolean; duplicate?: boolean; punch_hash?: string; result?: { id: string } }>> {
  const limited = punches.slice(0, 50);
  const out: Array<{ client_id?: string; success?: boolean; duplicate?: boolean; punch_hash?: string; result?: { id: string } }> = [];
  for (const item of limited) {
    try {
      const result = await insertPunchSafe(item);
      out.push({
        client_id: typeof item.client_id === 'string' ? item.client_id : undefined,
        success: result.success,
        duplicate: result.duplicate,
        punch_hash: result.punch_hash,
        result: result.id ? { id: result.id } : undefined,
      });
    } catch {
      out.push({
        client_id: typeof item.client_id === 'string' ? item.client_id : undefined,
        success: false,
        punch_hash: safePunchHash(item),
      });
    }
  }
  return out;
}
