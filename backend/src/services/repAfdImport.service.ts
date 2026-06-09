import { createHash } from 'node:crypto';
import { pool } from '../db/index.js';
import { logger } from '../logger/logger.js';
import { resolveUserForRepPunch } from './repUserMatch.service.js';
import {
  afdRecordToIsoUtc,
  matriculaFromAfdPisField,
  parseAfdFile,
  parseTxtOrCsv,
  type ParsedAfdRecord,
} from './repAfdParser.service.js';

export type AfdImportResult = {
  importId: string;
  total: number;
  imported: number;
  duplicated: number;
  ignored: number;
  user_not_found: number;
  employees_found: number;
  errors: string[];
  processing_ms: number;
  recalc_targets: Array<{ user_id: string; date: string }>;
};

function normalizeDigits(value: unknown): string | null {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits || null;
}

function normalizeUuid(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
}

function punchHashForAfd(companyId: string, deviceId: string | null, rec: ParsedAfdRecord, iso: string): string {
  const key = `${companyId}|${deviceId ?? ''}|${rec.nsr}|${iso}|${rec.cpfOuPis}|AFD_IMPORT`;
  return createHash('sha256').update(key).digest('hex');
}

let cachedHasPunchHashParam: boolean | null = null;

async function repIngestHasPunchHashParam(): Promise<boolean> {
  if (cachedHasPunchHashParam !== null) return cachedHasPunchHashParam;
  const result = await pool.query(
    `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'rep_ingest_punch'
        and array_position(p.proargnames, 'p_punch_hash') is not null limit 1`,
  );
  cachedHasPunchHashParam = (result.rowCount ?? 0) > 0;
  return cachedHasPunchHashParam;
}

async function markAfdImportOrigin(repLogId: string): Promise<void> {
  await pool.query(
    `update public.rep_punch_logs
        set origem = 'AFD_IMPORT', source = 'AFD_IMPORT'
      where id::text = $1`,
    [repLogId],
  );
}

async function ingestOneAfdRecord(input: {
  companyId: string;
  repDeviceId: string | null;
  rec: ParsedAfdRecord;
  forceUserId: string | null;
  timeZone: string;
  hasPunchHashParam: boolean;
}): Promise<{
  status: 'imported' | 'duplicate' | 'user_not_found' | 'error' | 'ignored';
  repLogId?: string;
  userId?: string;
  civilDate?: string;
  error?: string;
}> {
  const { companyId, repDeviceId, rec, forceUserId, timeZone, hasPunchHashParam } = input;
  const iso = afdRecordToIsoUtc(rec, timeZone);
  const matricula = matriculaFromAfdPisField(rec.cpfOuPis) ?? null;
  const punchHash = punchHashForAfd(companyId, repDeviceId, rec, iso);
  const rawData = {
    source: 'AFD_IMPORT',
    origem: 'AFD_IMPORT',
    ingest: 'afd-import',
    raw: rec.raw,
    cpfOuPis: rec.cpfOuPis,
    nsr: rec.nsr,
    tipo: rec.tipo,
  };

  const match = await resolveUserForRepPunch({
    companyId,
    employeeId: forceUserId,
    pis: normalizeDigits(rec.cpfOuPis),
    cpf: normalizeDigits(rec.cpfOuPis),
    matricula,
    rawData,
  });
  const resolvedUserId = forceUserId ?? match.userId ?? null;

  const baseParams = [
    companyId,
    repDeviceId,
    normalizeDigits(rec.cpfOuPis),
    normalizeDigits(rec.cpfOuPis),
    matricula,
    null,
    iso,
    rec.tipo || 'E',
    rec.nsr,
    JSON.stringify(rawData),
    false,
    false,
    resolvedUserId,
    false,
  ];

  const sql = hasPunchHashParam
    ? `select public.rep_ingest_punch($1::text, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::timestamptz, $8::text, $9::bigint, $10::jsonb, $11::boolean, $12::boolean, $13::uuid, $14::boolean, $15::text) as result`
    : `select public.rep_ingest_punch($1::text, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::timestamptz, $8::text, $9::bigint, $10::jsonb, $11::boolean, $12::boolean, $13::uuid, $14::boolean) as result`;
  const params = hasPunchHashParam ? [...baseParams, punchHash] : baseParams;

  try {
    const result = await pool.query(sql, params);
    const out = (result.rows[0]?.result ?? {}) as Record<string, unknown>;
    if (out.success === false) {
      return { status: 'error', error: String(out.error || 'ingest_failed') };
    }
    if (out.duplicate === true) {
      return { status: 'duplicate' };
    }
    const repLogId = String(out.rep_log_id || '').trim();
    if (repLogId) await markAfdImportOrigin(repLogId);
    if (out.user_not_found === true) {
      return { status: 'user_not_found', repLogId: repLogId || undefined };
    }
    const userId = String(out.user_id || resolvedUserId || '').trim() || undefined;
    const civilDate = iso.slice(0, 10);
    return { status: 'imported', repLogId: repLogId || undefined, userId, civilDate };
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

async function promotePending(companyId: string, repDeviceId: string | null): Promise<void> {
  try {
    await pool.query(
      `select public.rep_promote_pending_rep_punch_logs($1::text, $2::uuid, null::timestamptz, null::timestamptz, null::uuid, null::uuid)`,
      [companyId, repDeviceId],
    );
  } catch (e) {
    logger.warn({
      module: 'rep.afd_import',
      action: 'PROMOTE_PENDING_WARN',
      companyId,
      message: 'Falha ao promover pendentes após importação AFD',
      error: e,
    });
  }
}

export async function processAfdImport(input: {
  companyId: string;
  userId: string;
  userName?: string | null;
  filename: string;
  fileContent: string;
  repDeviceId?: string | null;
  forceUserId?: string | null;
  timeZone?: string;
}): Promise<AfdImportResult> {
  const t0 = Date.now();
  const companyId = input.companyId.trim();
  const repDeviceId = normalizeUuid(input.repDeviceId);
  const forceUserId = normalizeUuid(input.forceUserId);
  const timeZone = input.timeZone?.trim() || 'America/Sao_Paulo';

  const isCsv = input.fileContent.includes(',') && (input.fileContent.split('\n')[0] || '').includes(',');
  const records = isCsv ? parseTxtOrCsv(input.fileContent, ',') : parseAfdFile(input.fileContent);
  const linesRead = input.fileContent.split(/\r?\n/).filter((l) => l.trim()).length;
  const ignored = Math.max(0, linesRead - records.length);

  const importInsert = await pool.query(
    `insert into public.afd_imports
       (company_id, arquivo, usuario_id, usuario_nome, registros_lidos, ignorados, status)
     values ($1::uuid, $2, $3, $4, $5, $6, 'processing')
     returning id::text`,
    [companyId, input.filename, input.userId, input.userName ?? null, records.length, ignored],
  );
  const importId = String(importInsert.rows[0]?.id || '');

  if (records.length === 0) {
    await pool.query(
      `update public.afd_imports set status = 'error', erros = $2::jsonb, tempo_processamento_ms = $3, updated_at = now() where id::text = $1`,
      [importId, JSON.stringify(['Nenhum registro válido no arquivo']), Date.now() - t0],
    );
    return {
      importId,
      total: 0,
      imported: 0,
      duplicated: 0,
      ignored,
      user_not_found: 0,
      employees_found: 0,
      errors: ['Nenhum registro válido encontrado no arquivo'],
      processing_ms: Date.now() - t0,
      recalc_targets: [],
    };
  }

  let imported = 0;
  let duplicated = 0;
  let userNotFound = 0;
  const errors: string[] = [];
  const employeeIds = new Set<string>();
  const recalcTargets = new Map<string, { user_id: string; date: string }>();

  const hasPunchHashParam = await repIngestHasPunchHashParam();
  for (const rec of records) {
    const r = await ingestOneAfdRecord({
      companyId,
      repDeviceId,
      rec,
      forceUserId,
      timeZone,
      hasPunchHashParam,
    });
    if (r.status === 'imported') {
      imported += 1;
      if (r.userId) {
        employeeIds.add(r.userId);
        if (r.civilDate) {
          recalcTargets.set(`${r.userId}|${r.civilDate}`, { user_id: r.userId, date: r.civilDate });
        }
      }
    } else if (r.status === 'duplicate') {
      duplicated += 1;
    } else if (r.status === 'user_not_found') {
      userNotFound += 1;
    } else if (r.status === 'error' && errors.length < 20) {
      errors.push(r.error || 'erro');
    }
  }

  await promotePending(companyId, repDeviceId);

  const processingMs = Date.now() - t0;
  const status = errors.length > 0 && imported === 0 ? 'error' : 'done';

  await pool.query(
    `update public.afd_imports
        set novos_registros = $2,
            duplicados = $3,
            nao_localizados = $4,
            funcionarios_encontrados = $5,
            erros = $6::jsonb,
            status = $7,
            rep_device_id = $8::uuid,
            tempo_processamento_ms = $9,
            detalhes = $10::jsonb,
            updated_at = now()
      where id::text = $1`,
    [
      importId,
      imported,
      duplicated,
      userNotFound,
      employeeIds.size,
      JSON.stringify(errors.slice(0, 50)),
      status,
      repDeviceId,
      processingMs,
      JSON.stringify({ recalc_targets: [...recalcTargets.values()] }),
    ],
  );

  logger.info({
    module: 'rep.afd_import',
    action: 'AFD_IMPORT_DONE',
    companyId,
    message: 'Importação AFD concluída',
    meta: { importId, imported, duplicated, userNotFound, processingMs },
  });

  return {
    importId,
    total: records.length,
    imported,
    duplicated,
    ignored,
    user_not_found: userNotFound,
    employees_found: employeeIds.size,
    errors,
    processing_ms: processingMs,
    recalc_targets: [...recalcTargets.values()],
  };
}

export async function listAfdImports(companyId: string, limit = 50): Promise<Record<string, unknown>[]> {
  const result = await pool.query(
    `select id::text, arquivo, usuario_id, usuario_nome, data_importacao, registros_lidos,
            novos_registros, duplicados, ignorados, nao_localizados, funcionarios_encontrados,
            status, tempo_processamento_ms, erros, detalhes, created_at
       from public.afd_imports
      where company_id::text = $1
      order by data_importacao desc
      limit $2`,
    [companyId, limit],
  );
  return result.rows as Record<string, unknown>[];
}

export async function getAfdImportById(companyId: string, importId: string): Promise<Record<string, unknown> | null> {
  const result = await pool.query(
    `select id::text, arquivo, usuario_id, usuario_nome, data_importacao, registros_lidos,
            novos_registros, duplicados, ignorados, nao_localizados, funcionarios_encontrados,
            status, tempo_processamento_ms, erros, detalhes, rep_device_id::text, created_at
       from public.afd_imports
      where company_id::text = $1 and id::text = $2
      limit 1`,
    [companyId, importId],
  );
  return (result.rows[0] as Record<string, unknown>) ?? null;
}
