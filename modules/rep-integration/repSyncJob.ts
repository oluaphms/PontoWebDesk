/**
 * Job de sincronização automática dos relógios REP
 * Fluxo: conectar → baixar marcações → converter → rep_punch_logs + time_records → atualizar ultima_sincronizacao
 * Deve ser executado a cada 5 minutos (cron ou Vercel Cron)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { mergeHubProviderIntoRepDevice } from './repHubMerge';
import { getPunchesForSync, testConnectionForSync } from './repSyncFetch';
import type { PunchFromDevice, RepDevice } from './types';
import {
  ingestPunchesFromDevice,
  logRepAction,
  updateDeviceLastSync,
  type IngestPunchesFromDeviceOptions,
} from './repService';

function filterPunchesToLocalToday(punches: PunchFromDevice[]): PunchFromDevice[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const start = new Date(y, m, d, 0, 0, 0, 0);
  const end = new Date(y, m, d, 23, 59, 59, 999);
  return punches.filter((p) => {
    const t = new Date(p.data_hora);
    return !Number.isNaN(t.getTime()) && t >= start && t <= end;
  });
}

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

/** Recuo em `since` para não perder batidas por desvio de relógio ou ordem de atualização da última sync. */
const SINCE_SYNC_GRACE_MS = 3 * 60 * 1000;
/** Piso para download / outras etapas; ingestão usa também `ingestStepTimeoutMs`. */
const SYNC_STEP_TIMEOUT_MS = (() => {
  const raw =
    typeof process !== 'undefined' && process.env?.REP_SYNC_STEP_TIMEOUT_MS
      ? String(process.env.REP_SYNC_STEP_TIMEOUT_MS).trim()
      : '';
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 30_000) return Math.min(4 * 60 * 60_000, n);
  return 6 * 60_000;
})();

/** ~120 ms por batida (RPC em lotes), com teto 4 h — evita timeout a meio de históricos grandes. */
const REP_INGEST_MS_PER_PUNCH = 120;
const REP_INGEST_TIMEOUT_MAX_MS = 4 * 60 * 60_000;

function ingestStepTimeoutMs(punchCount: number): number {
  const floor = SYNC_STEP_TIMEOUT_MS;
  if (!Number.isFinite(punchCount) || punchCount <= 0) return floor;
  const scaled = punchCount * REP_INGEST_MS_PER_PUNCH;
  return Math.min(REP_INGEST_TIMEOUT_MAX_MS, Math.max(floor, scaled));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          `Tempo esgotado (${Math.round(timeoutMs / 1000)}s) na etapa "${label}" da sincronização REP.`
        )
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/**
 * Sincroniza um único dispositivo REP (rede ou API)
 */
export async function syncRepDevice(
  supabase: SupabaseClient,
  deviceId: string,
  ingestOptions?: IngestPunchesFromDeviceOptions
): Promise<{
  ok: boolean;
  imported: number;
  staged?: number;
  duplicated?: number;
  userNotFound?: number;
  /** Quantas marcações vieram do relógio (antes de gravar). */
  received?: number;
  ingestErrors?: string[];
  error?: string;
}> {
  const { data: device, error: fetchError } = await supabase
    .from('rep_devices')
    .select('*')
    .eq('id', deviceId)
    .eq('ativo', true)
    .maybeSingle();

  if (fetchError || !device) {
    return { ok: false, imported: 0, error: fetchError?.message || 'Dispositivo não encontrado' };
  }

  const merged = await mergeHubProviderIntoRepDevice(supabase, device as RepDevice);

  if (merged.tipo_conexao === 'arquivo') {
    return { ok: true, imported: 0 }; // arquivo não sincroniza automaticamente
  }

  await updateDeviceLastSync(supabase, deviceId, 'sincronizando');

  try {
    let since = merged.ultima_sincronizacao ? new Date(merged.ultima_sincronizacao) : undefined;
    if (since) {
      since = new Date(since.getTime() - SINCE_SYNC_GRACE_MS);
    }
    let punches = await withTimeout(
      getPunchesForSync(supabase, merged, since),
      SYNC_STEP_TIMEOUT_MS,
      'download de batidas'
    );

    if (ingestOptions?.receiveScope === 'today_only') {
      punches = filterPunchesToLocalToday(punches);
    }

    const ingestMs = ingestStepTimeoutMs(punches.length);
    const result = await withTimeout(
      ingestPunchesFromDevice(supabase, merged, punches, ingestOptions),
      ingestMs,
      'gravação das batidas'
    );
    await updateDeviceLastSync(supabase, deviceId, 'ativo');

    await logRepAction(supabase, deviceId, 'sync', result.errors.length ? 'parcial' : 'sucesso', undefined, {
      imported: result.imported,
      staged: result.staged,
      duplicated: result.duplicated,
      userNotFound: result.userNotFound,
      errors: result.errors,
      onlyStaging: ingestOptions?.onlyStaging,
      applySchedule: ingestOptions?.applySchedule,
    });

    return {
      ok: true,
      imported: result.imported,
      staged: result.staged,
      duplicated: result.duplicated,
      userNotFound: result.userNotFound,
      received: punches.length,
      ingestErrors: result.errors.length ? [...result.errors] : undefined,
      error: result.errors[0],
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro ao sincronizar';
    await updateDeviceLastSync(supabase, deviceId, 'erro');
    await logRepAction(supabase, deviceId, 'sync', 'erro', message);
    return { ok: false, imported: 0, error: message };
  }
}

/**
 * Sincroniza todos os dispositivos REP ativos da empresa (ou de todas as empresas)
 */
export async function syncRepDevices(
  supabase: SupabaseClient,
  companyId?: string
): Promise<{ total: number; imported: number; errors: string[] }> {
  let query = supabase.from('rep_devices').select('id').eq('ativo', true).neq('tipo_conexao', 'arquivo');
  if (companyId) {
    query = query.eq('company_id', companyId);
  }
  const { data: devices, error } = await query;

  if (error) {
    return { total: 0, imported: 0, errors: [error.message] };
  }

  const list = devices || [];
  let imported = 0;
  const errors: string[] = [];

  for (const d of list) {
    const r = await syncRepDevice(supabase, d.id);
    if (r.imported) imported += r.imported;
    if (r.error) errors.push(`${d.id}: ${r.error}`);
  }

  return { total: list.length, imported, errors };
}

/**
 * Inicia intervalo de sincronização a cada 5 minutos (para processo long-running, ex: Node worker)
 * Em Vercel/serverless use cron que chama POST /api/rep/sync
 */
export function startRepSyncInterval(
  supabase: SupabaseClient,
  companyId?: string
): () => void {
  const run = () => syncRepDevices(supabase, companyId).catch(() => {});
  const id = setInterval(run, SYNC_INTERVAL_MS);
  run(); // primeira execução imediata
  return () => clearInterval(id);
}

/**
 * Testa conexão de um dispositivo (para uso na UI)
 */
export async function testRepDeviceConnection(
  supabase: SupabaseClient,
  deviceId: string
): Promise<{ ok: boolean; message: string }> {
  const { data: device, error } = await supabase
    .from('rep_devices')
    .select('*')
    .eq('id', deviceId)
    .maybeSingle();

  if (error || !device) {
    return { ok: false, message: 'Dispositivo não encontrado' };
  }

  const merged = await mergeHubProviderIntoRepDevice(supabase, device as RepDevice);
  return testConnectionForSync(supabase, merged);
}
