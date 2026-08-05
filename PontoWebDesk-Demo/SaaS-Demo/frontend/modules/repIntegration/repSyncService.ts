/**
 * Serviço de sincronização automática de relógios REP
 * Fluxo: buscar dispositivos ativos → conectar → baixar marcações → validar NSR → salvar → atualizar última sincronização
 * Executar a cada 5 minutos (cron ou Vercel Cron)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchPunches } from './repDeviceManager';
import { getREPAdapter } from './repAdapters';
import type { RepDeviceConfig } from './types';

export interface IngestPunchParams {
  company_id: string;
  rep_device_id?: string | null;
  pis?: string | null;
  cpf?: string | null;
  matricula?: string | null;
  nome_funcionario?: string | null;
  data_hora: string;
  tipo_marcacao: string;
  nsr?: number | null;
  raw_data?: Record<string, unknown>;
}

export type IngestPunchFn = (supabase: SupabaseClient, params: IngestPunchParams) => Promise<{
  success: boolean;
  time_record_id?: string;
  user_not_found?: boolean;
  error?: string;
}>;

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Converte dispositivo da tabela rep_devices para RepDeviceConfig (com nome alias)
 */
function toRepDeviceConfig(row: Record<string, unknown>): RepDeviceConfig {
  return {
    id: row.id as string,
    company_id: row.company_id as string,
    nome_dispositivo: (row.nome_dispositivo ?? row.nome) as string,
    nome: row.nome_dispositivo as string,
    fabricante: row.fabricante as string | null,
    modelo: row.modelo as string | null,
    ip: row.ip as string | null,
    porta: row.porta as number | null,
    usuario: row.usuario as string | null,
    senha: row.senha as string | null,
    tipo_conexao: (row.tipo_conexao || 'rede') as 'rede' | 'arquivo' | 'api',
    status: row.status as RepDeviceConfig['status'],
    ultima_sincronizacao: row.ultima_sincronizacao as string | null,
    ativo: row.ativo !== false,
    config_extra: row.config_extra as Record<string, unknown> | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/**
 * Sincroniza um único dispositivo REP
 */
export async function syncDevice(
  supabase: SupabaseClient,
  deviceId: string,
  ingestPunch: IngestPunchFn
): Promise<{ ok: boolean; imported: number; error?: string }> {
  const { data: deviceRow, error: fetchError } = await supabase
    .from('rep_devices')
    .select('id,company_id,nome_dispositivo,provider_type,identifier_type,fabricante,modelo,ip,porta,tipo_conexao,status,ultima_sincronizacao,ativo,config_extra,created_at,updated_at')
    .eq('id', deviceId)
    .eq('ativo', true)
    .maybeSingle();

  if (fetchError || !deviceRow) {
    return { ok: false, imported: 0, error: fetchError?.message || 'Dispositivo não encontrado' };
  }

  const device = toRepDeviceConfig(deviceRow as Record<string, unknown>);
  if (device.tipo_conexao === 'arquivo') {
    return { ok: true, imported: 0 };
  }

  await supabase
    .from('rep_devices')
    .update({
      status: 'sincronizando',
      updated_at: new Date().toISOString(),
    })
    .eq('id', deviceId);

  try {
    let lastNSR: number | undefined;
    const adapter = getREPAdapter(device);
    if (adapter) {
      const status = await adapter.getDeviceStatus(device);
      lastNSR = status.lastNsr;
    }
    const punches = await fetchPunches(device, lastNSR);

    let imported = 0;
    const errors: string[] = [];
    for (const p of punches) {
      const r = await ingestPunch(supabase, {
        company_id: device.company_id,
        rep_device_id: deviceId,
        pis: p.pis ?? null,
        cpf: p.cpf ?? null,
        matricula: p.matricula ?? null,
        nome_funcionario: p.nome ?? null,
        data_hora: p.data_hora,
        tipo_marcacao: p.tipo || 'E',
        nsr: p.nsr ?? null,
        raw_data: p.raw ?? {},
      });
      if (r.success && !r.user_not_found) imported += 1;
      if (r.error && !r.error.includes('já importado')) errors.push(r.error);
    }

    await supabase
      .from('rep_devices')
      .update({
        ultima_sincronizacao: new Date().toISOString(),
        status: 'ativo',
        updated_at: new Date().toISOString(),
      })
      .eq('id', deviceId);

    await supabase.from('rep_logs').insert({
      rep_device_id: deviceId,
      acao: 'sync',
      status: errors.length ? 'parcial' : 'sucesso',
      mensagem: errors[0] ?? null,
      detalhes: { imported, total: punches.length, errors },
    });

    return { ok: true, imported, error: errors[0] };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro ao sincronizar';
    await supabase
      .from('rep_devices')
      .update({ status: 'erro', updated_at: new Date().toISOString() })
      .eq('id', deviceId);
    await supabase.from('rep_logs').insert({
      rep_device_id: deviceId,
      acao: 'sync',
      status: 'erro',
      mensagem: message,
    });
    return { ok: false, imported: 0, error: message };
  }
}

/**
 * Sincroniza todos os dispositivos REP ativos (opcionalmente filtrado por company_id)
 */
export async function syncDevices(
  supabase: SupabaseClient,
  ingestPunch: IngestPunchFn,
  companyId?: string
): Promise<{ total: number; imported: number; errors: string[] }> {
  let query = supabase
    .from('rep_devices')
    .select('id')
    .eq('ativo', true)
    .neq('tipo_conexao', 'arquivo');
  if (companyId) query = query.eq('company_id', companyId);
  const { data: devices, error } = await query;

  if (error) return { total: 0, imported: 0, errors: [error.message] };
  const list = devices ?? [];
  let imported = 0;
  const errors: string[] = [];
  for (const d of list) {
    const r = await syncDevice(supabase, d.id, ingestPunch);
    if (r.imported) imported += r.imported;
    if (r.error) errors.push(`${d.id}: ${r.error}`);
  }
  return { total: list.length, imported, errors };
}

/**
 * Intervalo de sincronização a cada 5 minutos (processo long-running).
 * Em serverless use cron que chama API POST /api/rep/sync
 */
export function getSyncIntervalMs(): number {
  return SYNC_INTERVAL_MS;
}
