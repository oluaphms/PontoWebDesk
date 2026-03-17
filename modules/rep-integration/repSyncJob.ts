/**
 * Job de sincronização automática dos relógios REP
 * Fluxo: conectar → baixar marcações → converter → rep_punch_logs + time_records → atualizar ultima_sincronizacao
 * Deve ser executado a cada 5 minutos (cron ou Vercel Cron)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getPunchesFromDevice, testConnection } from './repDeviceManager';
import { ingestPunchesFromDevice, logRepAction, updateDeviceLastSync } from './repService';

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Sincroniza um único dispositivo REP (rede ou API)
 */
export async function syncRepDevice(
  supabase: SupabaseClient,
  deviceId: string
): Promise<{ ok: boolean; imported: number; error?: string }> {
  const { data: device, error: fetchError } = await supabase
    .from('rep_devices')
    .select('*')
    .eq('id', deviceId)
    .eq('ativo', true)
    .single();

  if (fetchError || !device) {
    return { ok: false, imported: 0, error: fetchError?.message || 'Dispositivo não encontrado' };
  }

  if (device.tipo_conexao === 'arquivo') {
    return { ok: true, imported: 0 }; // arquivo não sincroniza automaticamente
  }

  await updateDeviceLastSync(supabase, deviceId, 'sincronizando');

  try {
    const since = device.ultima_sincronizacao ? new Date(device.ultima_sincronizacao) : undefined;
    const punches = await getPunchesFromDevice(device, since);

    const result = await ingestPunchesFromDevice(supabase, device, punches);
    await updateDeviceLastSync(supabase, deviceId, 'ativo');

    await logRepAction(supabase, deviceId, 'sync', result.errors.length ? 'parcial' : 'sucesso', undefined, {
      imported: result.imported,
      duplicated: result.duplicated,
      userNotFound: result.userNotFound,
      errors: result.errors,
    });

    return { ok: true, imported: result.imported, error: result.errors[0] };
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
    .single();

  if (error || !device) {
    return { ok: false, message: 'Dispositivo não encontrado' };
  }

  return testConnection(device);
}
