import { randomUUID } from 'node:crypto';
import { pool } from '../db/index.js';
import { getPunchColumns, getTimeRecordColumns, getTimeRecordInsertRpc } from './punchSchema.js';
import { validatePhotoUrl } from '../upload/fileValidation.js';
import type { PoolClient } from 'pg';
import { logger } from '../logger/logger.js';
import { verifySignedPhotoUrl } from './uploadStorageService.js';

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

function isSignedInternalUploadPhotoUrl(raw: string): boolean {
  try {
    const url = new URL(raw.startsWith('/') ? raw : raw, 'https://internal-upload.local');
    if (!/^\/api\/uploads\/files\/[\w-]+\/[\w.-]+$/.test(url.pathname)) return true;
    const parts = url.pathname.split('/').filter(Boolean);
    const userId = decodeURIComponent(parts[3] || '');
    const fileName = decodeURIComponent(parts[4] || '');
    return verifySignedPhotoUrl(userId, fileName, url.searchParams.get('exp') || '', url.searchParams.get('sig') || '');
  } catch {
    return false;
  }
}

function statusFromLastPunchType(type: unknown): string {
  const normalized = normalizeType(type);
  if (!normalized) return 'empty_day';
  if (normalized === 'entrada' || normalized === 'intervalo_volta') return 'working';
  if (normalized === 'intervalo_saida') return 'break';
  if (normalized === 'saida') return 'off_duty';
  return 'unknown';
}

/** Grava photo_url na coluna dedicada (RPC canônica só persiste em metadata). */
async function enrichTimeRecordPhoto(
  client: PoolClient,
  recordId: string | null,
  photoUrl: string | null,
): Promise<void> {
  const id = String(recordId || '').trim();
  const url = String(photoUrl || '').trim();
  if (!id || !url) return;

  const cols = await getTimeRecordColumns();
  const sets: string[] = [];
  const values: unknown[] = [id];
  let idx = 2;

  if (cols.hasPhotoUrl) {
    sets.push(`photo_url = $${idx++}`);
    values.push(url);
  }
  if (cols.hasMetadata) {
    sets.push(`metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('photo_url', $${idx++}::text)`);
    values.push(url);
  }
  if (cols.hasRawData) {
    sets.push(`raw_data = COALESCE(raw_data, '{}'::jsonb) || jsonb_build_object('photo_url', $${idx++}::text)`);
    values.push(url);
  }
  if (!sets.length) return;

  await client.query(
    `UPDATE public.time_records SET ${sets.join(', ')} WHERE id::text = $1::text`,
    values,
  );
  logger.info({
    module: 'punch.service',
    action: 'SELFIE_FLOW_PHOTO_PERSISTED',
    message: '[SELFIE-FLOW] url salva no banco (coluna photo_url / metadata)',
    meta: { timeRecordId: id, hasPhotoColumn: cols.hasPhotoUrl },
  });
}

async function logLatestPunchBeforeInsert(
  client: PoolClient,
  input: { userId: string; companyId: string; timestamp: string; type: string },
): Promise<void> {
  const sql = `select id, user_id, company_id, type, timestamp, created_at
     from time_records
    where company_id::text = $1
      and user_id::text = $2
      and ((coalesce(timestamp, created_at) at time zone 'America/Sao_Paulo')::date =
           (($3::timestamptz at time zone 'America/Sao_Paulo')::date))
    order by coalesce(timestamp, created_at) desc
    limit 1`;
  try {
    const result = await client.query(sql, [input.companyId, input.userId, input.timestamp]);
    const latest = result.rows[0] ?? null;
    logger.info({
      module: 'punch.service',
      action: 'PUNCH_SEQUENCE_CONTEXT',
      message: 'Contexto de sequência antes de registrar ponto',
      userId: input.userId,
      companyId: input.companyId,
      meta: {
        employeeId: input.userId,
        nextType: input.type,
        nextTimestamp: input.timestamp,
        latestPunch: latest,
        calculatedStatus: statusFromLastPunchType(latest?.type),
        sql,
        params: [input.companyId, input.userId, input.timestamp],
        returnedRows: result.rowCount ?? result.rows.length,
      },
    });
  } catch (error) {
    logger.warn({
      module: 'punch.service',
      action: 'PUNCH_SEQUENCE_CONTEXT_FAILED',
      message: 'Falha ao consultar última batida antes do registro',
      userId: input.userId,
      companyId: input.companyId,
      error,
      meta: {
        employeeId: input.userId,
        nextType: input.type,
        nextTimestamp: input.timestamp,
        sql,
      },
    });
  }
}

async function setRequestJwtContext(client: PoolClient, input: { userId: string; companyId: string }): Promise<void> {
  await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [input.userId]);
  await client.query(`select set_config('request.jwt.claim.user_id', $1, true)`, [input.userId]);
  await client.query(`select set_config('request.jwt.claim.company_id', $1, true)`, [input.companyId]);
  await client.query(`select set_config('request.jwt.claim.role', $1, true)`, ['employee']);
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({
      sub: input.userId,
      user_id: input.userId,
      company_id: input.companyId,
      role: 'employee',
    }),
  ]);
}

function buildRpcMetadata(punch: PunchInput, punchHash: string, photoUrl: string | null): Record<string, unknown> {
  const lat = finiteNumberOrNull(punch.latitude);
  const lng = finiteNumberOrNull(punch.longitude);
  const geoSnapshot =
    lat != null && lng != null
      ? {
          latitude_original: lat,
          longitude_original: lng,
          accuracy_meters: finiteNumberOrNull(punch.accuracy),
          captured_at: String(punch.timestamp || new Date().toISOString()),
          provider: 'browser_geolocation',
        }
      : null;
  return {
    method: String(punch.method || 'api').trim() || 'api',
    source: normalizeSource(punch.source),
    photo_url: photoUrl,
    punch_hash: punchHash,
    payload: punch,
    ...(geoSnapshot ? { geo_snapshot: geoSnapshot } : {}),
  };
}

function punchResultId(mirrorRecordId: string | null, punchAuditId?: string | null): string {
  return String(mirrorRecordId || punchAuditId || '').trim();
}

/** Grava lat/lng e geo_snapshot no time_records após insert (RPC não preenche colunas de GPS). */
async function enrichTimeRecordGeo(
  client: PoolClient,
  recordId: string | null,
  punch: PunchInput,
  timestamp: string,
): Promise<void> {
  const id = String(recordId || '').trim();
  if (!id) return;
  const lat = finiteNumberOrNull(punch.latitude);
  const lng = finiteNumberOrNull(punch.longitude);
  if (lat == null || lng == null) return;

  const cols = await getTimeRecordColumns();
  const acc = finiteNumberOrNull(punch.accuracy);
  const geoSnapshot = {
    latitude_original: lat,
    longitude_original: lng,
    accuracy_meters: acc,
    captured_at: timestamp,
    provider: 'browser_geolocation',
  };

  const sets: string[] = [];
  const values: unknown[] = [id];
  let idx = 2;
  if (cols.hasLatitude) {
    sets.push(`latitude = $${idx++}`);
    values.push(lat);
  }
  if (cols.hasLongitude) {
    sets.push(`longitude = $${idx++}`);
    values.push(lng);
  }
  if (cols.hasAccuracy && acc != null) {
    sets.push(`accuracy = $${idx++}`);
    values.push(acc);
  }
  if (cols.hasLocation) {
    sets.push(`location = $${idx++}::jsonb`);
    values.push(JSON.stringify({ lat, lng, latitude: lat, longitude: lng, accuracy: acc }));
  }
  if (cols.hasRawData) {
    sets.push(
      `raw_data = COALESCE(raw_data, '{}'::jsonb) || jsonb_build_object('geo_snapshot', $${idx++}::jsonb)`,
    );
    values.push(JSON.stringify(geoSnapshot));
  } else if (cols.hasMetadata) {
    sets.push(
      `metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('geo_snapshot', $${idx++}::jsonb)`,
    );
    values.push(JSON.stringify(geoSnapshot));
  }
  if (!sets.length) return;
  await client.query(`UPDATE public.time_records SET ${sets.join(', ')} WHERE id::text = $1::text`, values);
}

function finiteNumberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function appendInsertValue(
  columns: string[],
  values: unknown[],
  casts: string[],
  column: string,
  value: unknown,
  sqlCast: string,
): void {
  columns.push(column);
  values.push(value);
  casts.push(`$${values.length}::${sqlCast}`);
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
  const columns: string[] = [];
  const values: unknown[] = [];
  const cast: string[] = [];
  const recordId = randomUUID();
  const metadata = buildRpcMetadata(input.punch, input.punchHash, input.photoUrl);

  if (cols.hasId) {
    const idCast = cols.idType === 'uuid' ? 'uuid' : 'text';
    appendInsertValue(columns, values, cast, 'id', recordId, idCast);
  }
  appendInsertValue(columns, values, cast, 'user_id', input.userId, userIdCast);
  appendInsertValue(columns, values, cast, 'company_id', input.companyId, companyIdCast);
  appendInsertValue(columns, values, cast, 'type', input.type, 'text');
  const method = String(input.punch.method || 'api').trim() || 'api';

  if (cols.hasTimestamp) {
    appendInsertValue(columns, values, cast, 'timestamp', input.timestamp, 'timestamptz');
  }
  if (cols.hasCreatedAt) {
    appendInsertValue(columns, values, cast, 'created_at', input.timestamp, 'timestamptz');
  }
  if (cols.hasUpdatedAt) {
    appendInsertValue(columns, values, cast, 'updated_at', input.timestamp, 'timestamptz');
  }

  if (cols.hasMethod) {
    appendInsertValue(columns, values, cast, 'method', method, 'text');
  }
  if (cols.hasSource) {
    appendInsertValue(columns, values, cast, 'source', input.source, 'text');
  }
  if (cols.hasPunchHash) {
    appendInsertValue(columns, values, cast, 'punch_hash', input.punchHash, 'text');
  }
  if (cols.hasMetadata) {
    appendInsertValue(columns, values, cast, 'metadata', JSON.stringify(metadata), 'jsonb');
  }
  if (cols.hasRawData) {
    appendInsertValue(columns, values, cast, 'raw_data', JSON.stringify(metadata), 'jsonb');
  }
  if (cols.hasPhotoUrl) {
    appendInsertValue(columns, values, cast, 'photo_url', input.photoUrl, 'text');
  }
  if (cols.hasLocation) {
    appendInsertValue(columns, values, cast, 'location', JSON.stringify(input.punch.location ?? null), 'jsonb');
  }
  if (cols.hasLatitude) {
    appendInsertValue(columns, values, cast, 'latitude', finiteNumberOrNull(input.punch.latitude), 'numeric');
  }
  if (cols.hasLongitude) {
    appendInsertValue(columns, values, cast, 'longitude', finiteNumberOrNull(input.punch.longitude), 'numeric');
  }
  if (cols.hasAccuracy) {
    appendInsertValue(columns, values, cast, 'accuracy', finiteNumberOrNull(input.punch.accuracy), 'numeric');
  }
  if (cols.hasDeviceId) {
    appendInsertValue(columns, values, cast, 'device_id', input.punch.deviceId ?? null, 'text');
  }
  if (cols.hasDeviceType) {
    appendInsertValue(columns, values, cast, 'device_type', input.punch.deviceType ?? 'web', 'text');
  }
  if (cols.hasIpAddress) {
    appendInsertValue(columns, values, cast, 'ip_address', input.punch.ipAddress ?? null, 'text');
  }
  if (cols.hasFraudScore) {
    appendInsertValue(columns, values, cast, 'fraud_score', finiteNumberOrNull(input.punch.fraudScore) ?? 0, 'numeric');
  }
  if (cols.hasFraudFlags) {
    appendInsertValue(columns, values, cast, 'fraud_flags', JSON.stringify(input.punch.fraudFlags ?? []), 'jsonb');
  }
  if (cols.hasIsManual) {
    appendInsertValue(columns, values, cast, 'is_manual', method === 'manual', 'boolean');
  }
  if (cols.hasManualReason) {
    appendInsertValue(columns, values, cast, 'manual_reason', input.punch.manualReason ?? input.punch.justification ?? null, 'text');
  }
  if (cols.hasOrigin) {
    appendInsertValue(columns, values, cast, 'origin', 'mobile', 'text');
  }
  if (cols.hasSourceType) {
    appendInsertValue(columns, values, cast, 'source_type', 'app', 'text');
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

export async function insertPunchSafe(punch: PunchInput): Promise<{ success: boolean; duplicate?: boolean; id?: string; punch_hash: string; time_record_id?: string | null }> {
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
  if (photoUrl && !isSignedInternalUploadPhotoUrl(photoUrl)) {
    logger.warn({
      module: 'punch.service',
      action: 'SELFIE_FLOW_PHOTO_REJECTED',
      message: '[SELFIE-FLOW] URL de selfie rejeitada (assinatura inválida ou expirada)',
      userId,
      companyId,
    });
    return { success: false, punch_hash: punchHash };
  }
  if (photoUrl) {
    logger.info({
      module: 'punch.service',
      action: 'SELFIE_FLOW_PHOTO_ACCEPTED',
      message: '[SELFIE-FLOW] URL de selfie aceita para registro',
      userId,
      companyId,
    });
  }

  const cols = await getPunchColumns();
  const source = normalizeSource(punch.source);
  const client = await pool.connect();
  try {
    await client.query('begin');
    await setRequestJwtContext(client, { userId, companyId });
    await logLatestPunchBeforeInsert(client, { userId, companyId, timestamp, type });
    if (cols.hasPunchHash) {
      const existing = await client.query(
        'select id from punches where punch_hash = $1 limit 1',
        [punchHash],
      );
      if (existing.rowCount && existing.rows[0]?.id) {
        const dupPunchId = String(existing.rows[0].id);
        await promoteExistingPunchIfNeeded(client, dupPunchId);
        let dupMirrorId: string | null = null;
        try {
          const dupRow = await client.query(
            `select tr.id
               from public.time_records tr
              where tr.company_id::text = $1
                and tr.user_id::text = $2
                and tr.timestamp = $3::timestamptz
                and tr.type = $4
              order by tr.created_at desc
              limit 1`,
            [companyId, userId, timestamp, type],
          );
          dupMirrorId = dupRow.rows[0]?.id ? String(dupRow.rows[0].id) : null;
        } catch {
          dupMirrorId = null;
        }
        await client.query('commit');
        return {
          success: true,
          duplicate: true,
          id: punchResultId(dupMirrorId, dupPunchId),
          time_record_id: dupMirrorId,
          punch_hash: punchHash,
        };
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
    if (mirrorRecordId && photoUrl) {
      try {
        await enrichTimeRecordPhoto(client, mirrorRecordId, photoUrl);
      } catch (error) {
        logger.warn({
          module: 'punch.service',
          action: 'SELFIE_FLOW_PHOTO_PERSIST_FAILED',
          message: '[SELFIE-FLOW] falha ao gravar photo_url na coluna (metadata já contém URL)',
          userId,
          companyId,
          error,
          meta: { timeRecordId: mirrorRecordId },
        });
      }
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

    try {
      await enrichTimeRecordGeo(client, mirrorRecordId, punch, timestamp);
    } catch (error) {
      logger.warn({
        module: 'punch.service',
        action: 'PUNCH_GEO_ENRICH_SKIPPED',
        message: 'Falha ao enriquecer GPS no time_records (não bloqueia o ponto)',
        userId,
        companyId,
        error,
        meta: { timeRecordId: mirrorRecordId },
      });
    }

    await client.query('savepoint punch_audit_optional');
    try {
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
        const punchAuditId = inserted.rows[0]?.id ? String(inserted.rows[0].id) : null;
        return {
          success: true,
          id: punchResultId(mirrorRecordId, punchAuditId),
          time_record_id: mirrorRecordId,
          punch_hash: punchHash,
        };
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
        const punchAuditId = inserted.rows[0]?.id ? String(inserted.rows[0].id) : null;
        return {
          success: true,
          id: punchResultId(mirrorRecordId, punchAuditId),
          time_record_id: mirrorRecordId,
          punch_hash: punchHash,
        };
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
      const punchAuditId = inserted.rows[0]?.id ? String(inserted.rows[0].id) : null;
      return {
        success: true,
        id: punchResultId(mirrorRecordId, punchAuditId),
        time_record_id: mirrorRecordId,
        punch_hash: punchHash,
      };
    } catch (error) {
      await client.query('rollback to savepoint punch_audit_optional');
      logger.warn({
        module: 'punch.service',
        action: 'PUNCH_AUDIT_INSERT_SKIPPED',
        message: 'Falha ao gravar tabela auxiliar punches; time_records foi preservado',
        userId,
        companyId,
        error,
        meta: {
          employeeId: userId,
          timeRecordId: mirrorRecordId,
          type,
          timestamp,
        },
      });
    }
    await client.query('commit');
    return {
      success: true,
      id: punchResultId(mirrorRecordId, null),
      time_record_id: mirrorRecordId,
      punch_hash: punchHash,
    };
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
