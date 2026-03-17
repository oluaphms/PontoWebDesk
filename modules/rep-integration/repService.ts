/**
 * Serviço de integração REP - ingestão de marcações, logs e consolidação em time_records
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParsedAfdRecord, RepDevice, PunchFromDevice } from './types';
import { afdRecordToIsoDateTime } from './repParser';

export interface IngestResult {
  success: boolean;
  imported: number;
  duplicated: number;
  userNotFound: number;
  errors: string[];
}

/**
 * Ingere uma marcação vinda do REP (RPC rep_ingest_punch)
 */
export async function ingestPunch(
  supabase: SupabaseClient,
  params: {
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
): Promise<{ success: boolean; time_record_id?: string; user_not_found?: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('rep_ingest_punch', {
    p_company_id: params.company_id,
    p_rep_device_id: params.rep_device_id ?? null,
    p_pis: params.pis ?? null,
    p_cpf: params.cpf ?? null,
    p_matricula: params.matricula ?? null,
    p_nome_funcionario: params.nome_funcionario ?? null,
    p_data_hora: params.data_hora,
    p_tipo_marcacao: params.tipo_marcacao,
    p_nsr: params.nsr ?? null,
    p_raw_data: params.raw_data ?? {},
  });

  if (error) {
    return { success: false, error: error.message };
  }
  const result = data as { success?: boolean; time_record_id?: string; user_not_found?: boolean; error?: string; duplicate?: boolean };
  if (result.duplicate) {
    return { success: true, error: 'NSR já importado' };
  }
  return {
    success: result.success === true,
    time_record_id: result.time_record_id,
    user_not_found: result.user_not_found,
    error: result.error,
  };
}

/**
 * Ingere lote de registros AFD parseados
 */
export async function ingestAfdRecords(
  supabase: SupabaseClient,
  companyId: string,
  repDeviceId: string | null,
  records: ParsedAfdRecord[],
  timezone?: string
): Promise<IngestResult> {
  const result: IngestResult = { success: true, imported: 0, duplicated: 0, userNotFound: 0, errors: [] };

  for (const rec of records) {
    const dataHora = `${rec.data}T${rec.hora}:00.000Z`;
    const iso = timezone ? afdRecordToIsoDateTime(rec, timezone) : dataHora;

    const r = await ingestPunch(supabase, {
      company_id: companyId,
      rep_device_id: repDeviceId,
      pis: rec.cpfOuPis,
      cpf: rec.cpfOuPis,
      matricula: null,
      nome_funcionario: null,
      data_hora: iso,
      tipo_marcacao: rec.tipo,
      nsr: rec.nsr,
      raw_data: { raw: rec.raw },
    });

    if (!r.success && r.error?.includes('já importado')) {
      result.duplicated += 1;
    } else if (r.success && r.user_not_found) {
      result.userNotFound += 1;
    } else if (r.success) {
      result.imported += 1;
    } else {
      result.errors.push(r.error || 'Erro desconhecido');
    }
  }

  return result;
}

/**
 * Ingere lote de marcações vindas do dispositivo (fetch)
 */
export async function ingestPunchesFromDevice(
  supabase: SupabaseClient,
  device: RepDevice,
  punches: PunchFromDevice[]
): Promise<IngestResult> {
  const result: IngestResult = { success: true, imported: 0, duplicated: 0, userNotFound: 0, errors: [] };

  for (const p of punches) {
    const r = await ingestPunch(supabase, {
      company_id: device.company_id,
      rep_device_id: device.id,
      pis: p.pis ?? null,
      cpf: p.cpf ?? null,
      matricula: p.matricula ?? null,
      nome_funcionario: p.nome ?? null,
      data_hora: p.data_hora,
      tipo_marcacao: p.tipo || 'E',
      nsr: p.nsr ?? null,
      raw_data: p.raw ?? {},
    });

    if (!r.success && r.error?.includes('já importado')) {
      result.duplicated += 1;
    } else if (r.success && r.user_not_found) {
      result.userNotFound += 1;
    } else if (r.success) {
      result.imported += 1;
    } else {
      result.errors.push(r.error || 'Erro desconhecido');
    }
  }

  return result;
}

/**
 * Registra log de integração REP
 */
export async function logRepAction(
  supabase: SupabaseClient,
  repDeviceId: string | null,
  acao: string,
  status: 'sucesso' | 'erro' | 'parcial',
  mensagem?: string,
  detalhes?: Record<string, unknown>
): Promise<void> {
  await supabase.from('rep_logs').insert({
    rep_device_id: repDeviceId,
    acao,
    status,
    mensagem: mensagem ?? null,
    detalhes: detalhes ?? {},
  });
}

/**
 * Atualiza ultima_sincronizacao do dispositivo
 */
export async function updateDeviceLastSync(
  supabase: SupabaseClient,
  deviceId: string,
  status: 'ativo' | 'erro' | 'sincronizando'
): Promise<void> {
  await supabase
    .from('rep_devices')
    .update({
      ultima_sincronizacao: new Date().toISOString(),
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', deviceId);
}
