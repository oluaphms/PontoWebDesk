/**
 * Serviço de integração REP - ingestão de marcações, logs e consolidação em time_records
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParsedAfdRecord, RepDevice, PunchFromDevice } from './types';
import { afdRecordToIsoDateTime, matriculaFromAfdPisField } from './repParser';

export interface IngestResult {
  success: boolean;
  imported: number;
  duplicated: number;
  userNotFound: number;
  errors: string[];
  /** Marcações só em rep_punch_logs (modo fila temporária) */
  staged?: number;
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
    /** Só grava rep_punch_logs; não cria time_records até consolidar */
    only_staging?: boolean;
    /** Na entrada, marca is_late conforme escala + tolerância */
    apply_schedule?: boolean;
    /** Se definido, todas as batidas desta chamada gravam neste utilizador (importação AFD / reatribuição). */
    force_user_id?: string | null;
  }
): Promise<{
  success: boolean;
  time_record_id?: string;
  user_not_found?: boolean;
  /** NSR já existia em rep_punch_logs para este relógio. */
  duplicate?: boolean;
  error?: string;
}> {
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
    p_only_staging: params.only_staging ?? false,
    p_apply_schedule: params.apply_schedule ?? false,
    p_force_user_id: params.force_user_id ?? null,
  });

  if (error) {
    return { success: false, error: error.message };
  }
  const result = data as {
    success?: boolean;
    time_record_id?: string;
    user_not_found?: boolean;
    error?: string;
    duplicate?: boolean;
  };
  if (result.duplicate) {
    return { success: true, duplicate: true, error: 'NSR já importado' };
  }
  return {
    success: result.success === true,
    time_record_id: result.time_record_id,
    user_not_found: result.user_not_found === true,
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
  timezone?: string,
  /** Atribui todas as linhas do ficheiro a este colaborador (ignora PIS/CPF do AFD). */
  forceUserId?: string | null
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
      matricula: matriculaFromAfdPisField(rec.cpfOuPis) ?? null,
      nome_funcionario: null,
      data_hora: iso,
      tipo_marcacao: rec.tipo,
      nsr: rec.nsr,
      raw_data: { raw: rec.raw },
      force_user_id: forceUserId ?? null,
    });

    if (r.duplicate || (r.error && r.error.includes('já importado'))) {
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
export type RepIngestBatchProgress = {
  /** Índice do lote concluído (1..totalBatches). */
  batchIndex: number;
  totalBatches: number;
  /** Quantas batidas já processadas neste lote acumulado. */
  processedCount: number;
  /** Total de batidas a gravar. */
  total: number;
  /** Paralelismo usado (RPCs em paralelo por lote). */
  concurrency: number;
};

export type IngestPunchesFromDeviceOptions = {
  onlyStaging?: boolean;
  applySchedule?: boolean;
  /**
   * Usado em `syncRepDevice` após baixar as batidas: restringe à data local de hoje.
   * `incremental` = sem filtro extra (comportamento padrão).
   */
  receiveScope?: 'incremental' | 'today_only';
  /**
   * Chamado ao concluir cada lote de ingestão (amostrado em importações muito grandes
   * para não gerar milhares de linhas — no máximo ~50 eventos).
   */
  onBatchProgress?: (p: RepIngestBatchProgress) => void;
};

function foldIngestPunchRow(
  r: Awaited<ReturnType<typeof ingestPunch>>,
  onlyStaging: boolean,
  result: IngestResult
): void {
  if (r.duplicate || (r.error && r.error.includes('já importado'))) {
    result.duplicated += 1;
    return;
  }
  if (r.success && r.user_not_found) {
    /** Com fila temporária, «sem usuário» é esperado: conta só em staged, não duplicar em userNotFound. */
    if (onlyStaging) {
      result.staged = (result.staged ?? 0) + 1;
    } else {
      result.userNotFound += 1;
    }
  } else if (r.success) {
    if (onlyStaging) {
      result.staged = (result.staged ?? 0) + 1;
    } else {
      result.imported += 1;
    }
  } else if (result.errors.length < 100) {
    result.errors.push(r.error || 'Erro desconhecido');
  }
}

/**
 * RPCs em paralelo (lotes) + yield ao event loop: evita UI «congelada» por milhares de batidas sequenciais.
 */
export function getRepIngestConcurrency(): number {
  const raw =
    typeof process !== 'undefined' && process.env?.REP_INGEST_CONCURRENCY
      ? String(process.env.REP_INGEST_CONCURRENCY).trim()
      : '';
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 1) return Math.min(16, n);
  return 4;
}

export async function ingestPunchesFromDevice(
  supabase: SupabaseClient,
  device: RepDevice,
  punches: PunchFromDevice[],
  options?: IngestPunchesFromDeviceOptions
): Promise<IngestResult> {
  const result: IngestResult = {
    success: true,
    imported: 0,
    duplicated: 0,
    userNotFound: 0,
    errors: [],
    staged: 0,
  };
  const onlyStaging = options?.onlyStaging ?? false;
  const applySchedule = options?.applySchedule ?? false;
  const concurrency = getRepIngestConcurrency();
  const onBatchProgress = options?.onBatchProgress;
  const total = punches.length;
  const totalBatches = total > 0 ? Math.ceil(total / concurrency) : 0;
  /** Máximo de callbacks de progresso (importações enormes). */
  const maxProgressSamples = 50;
  const progressStep =
    totalBatches <= maxProgressSamples ? 1 : Math.max(1, Math.ceil(totalBatches / maxProgressSamples));

  for (let i = 0; i < punches.length; i += concurrency) {
    const slice = punches.slice(i, i + concurrency);
    const batch = await Promise.all(
      slice.map((p) =>
        ingestPunch(supabase, {
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
          only_staging: onlyStaging,
          apply_schedule: applySchedule,
        })
      )
    );
    for (const r of batch) {
      foldIngestPunchRow(r, onlyStaging, result);
    }
    if (onBatchProgress && totalBatches > 0) {
      const batchIndex = Math.floor(i / concurrency) + 1;
      const processedCount = Math.min(i + slice.length, total);
      const isFirst = batchIndex === 1;
      const isLast = batchIndex === totalBatches;
      const onStep = totalBatches <= maxProgressSamples || batchIndex % progressStep === 0;
      if (isFirst || isLast || onStep) {
        onBatchProgress({
          batchIndex,
          totalBatches,
          processedCount,
          total,
          concurrency,
        });
      }
    }
    if (i + concurrency < punches.length) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  }

  return result;
}

export type PromotePendingRepPunchLogsOptions = {
  /** Inclusivo; mesmo critério que «só hoje» no sync (calendário local → ISO). */
  localWindow?: { startIso: string; endIso: string } | null;
  /** Só cria espelho se o colaborador resolvido pelo AFD for este; outras batidas ficam na fila. */
  onlyUserId?: string | null;
};

/**
 * Cria registros de ponto (time_records) para marcações que ficaram só em rep_punch_logs (modo staging).
 */
export async function promotePendingRepPunchLogs(
  supabase: SupabaseClient,
  companyId: string,
  repDeviceId: string,
  options?: PromotePendingRepPunchLogsOptions
): Promise<{
  success: boolean;
  promoted?: number;
  skippedNoUser?: number;
  /** Com filtro por colaborador: batidas que casa(m) com outro utilizador. */
  skippedOtherUser?: number;
  error?: string;
}> {
  const win = options?.localWindow;
  const onlyUid = options?.onlyUserId?.trim();
  const { data, error } = await supabase.rpc('rep_promote_pending_rep_punch_logs', {
    p_company_id: companyId,
    p_rep_device_id: repDeviceId,
    p_local_window_start: win?.startIso ?? null,
    p_local_window_end: win?.endIso ?? null,
    p_only_user_id: onlyUid && onlyUid.length > 0 ? onlyUid : null,
  });
  if (error) {
    return { success: false, error: error.message };
  }
  const row = data as {
    success?: boolean;
    promoted?: number;
    skipped_no_user?: number;
    skipped_other_user?: number;
  };
  return {
    success: row.success === true,
    promoted: row.promoted,
    skippedNoUser: row.skipped_no_user,
    skippedOtherUser: row.skipped_other_user,
  };
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
