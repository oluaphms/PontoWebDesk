/**
 * REP-P Engine (Portaria 671/2021)
 * Registrador Eletrônico de Ponto via Programa.
 * Responsabilidades: registrar ponto com NSR, hash, comprovante, integridade, exportação AFD/AEJ.
 */

import { PUNCH_SOURCE_WEB } from '../constants/punchSource';
import { db, isSupabaseConfigured } from '../services/supabaseClient';
import {
  enqueueAndMaybeSyncWebPunch,
  flushWebPunchQueue,
  countPendingWebPunches,
  onWebPunchQueueSynced,
} from '../services/punchOfflineQueue';

export { onWebPunchQueueSynced };
import type { SavePunchEvidenceParams } from '../services/punchEvidenceService';
import { PlatformService } from '../platform/PlatformService';
import { getProvider } from '../services/getProvider';

const WEB_PUNCH_QUEUE = PlatformService.isRepWebPunchQueueEnabled();

export interface RegisterPunchParams {
  userId: string;
  companyId: string;
  type: string;
  method: string;
  timestamp?: string;
  recordId?: string;
  location?: { lat: number; lng: number; accuracy?: number };
  photoUrl?: string | null;
  /** `web` = app (default). `clock` = reservado ao pipeline do agente neste fluxo. */
  source?: string;
}

/** Parâmetros para registro com antifraude (rep_register_punch_secure). */
export interface RegisterPunchSecureParams extends RegisterPunchParams {
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  deviceId?: string | null;
  deviceType?: string | null;
  ipAddress?: string | null;
  fraudScore?: number | null;
  fraudFlags?: string[] | null;
}

export interface RegisterPunchResult {
  id: string;
  nsr: number;
  hash: string;
  previous_hash: string;
  timestamp: string;
  receipt_id: string;
}

export interface PointReceiptData {
  titulo: string;
  nsr: number;
  nomeEmpresa: string;
  cnpjEmpresa: string;
  localTrabalho: string;
  nomeTrabalhador: string;
  cpfTrabalhador: string;
  data: string;
  hora: string;
  hash: string;
  tipoRegistro: string;
}

export interface IntegrityResult {
  valid: boolean;
  errors: string[];
  details?: { nsr?: number; expectedHash?: string; actualHash?: string }[];
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ensureUuidLike(value: string, fieldName: string): void {
  const normalized = String(value ?? '').trim();
  if (!UUID_REGEX.test(normalized)) {
    throw new Error(`${fieldName} inválido: esperado UUID válido.`);
  }
}

/** Mensagem amigável para erros de RPC / RLS no registro de ponto. */
export function normalizePunchRegistrationError(err: unknown): Error {
  const e = err as { message?: string; code?: string; details?: string };
  const msg = String(e?.message ?? err ?? '');
  const code = e?.code;
  if (
    code === '42501' ||
    /row-level security|violates row-level security|RLS|permission denied for table/i.test(msg) ||
    /42501/.test(msg)
  ) {
    return new Error(
      'Não foi possível concluir o registro por permissão no servidor. Atualize a página, faça login novamente ou contate o suporte.',
    );
  }
  if (/Não autorizado a registrar ponto para outro usuário/i.test(msg)) {
    return new Error('Sessão inconsistente: faça logout e entre novamente.');
  }
  if (
    code === '42804' ||
    code === '22P02' ||
    /column "company_id" is of type uuid but expression is of type text/i.test(msg) ||
    /column "user_id" is of type uuid but expression is of type text/i.test(msg) ||
    /operator does not exist.*uuid/i.test(msg)
  ) {
    return new Error(
      'Erro de compatibilidade UUID no servidor. Aplique a migration 20260520360000_fix_rep_register_punch_uuid.sql e recarregue o schema da API no Supabase.',
    );
  }
  return err instanceof Error ? err : new Error(msg || 'Erro ao registrar ponto');
}

/**
 * Registra marcação de ponto conforme REP-P (NSR + hash + imutabilidade).
 * Usa RPC no Supabase para garantir sequência e hash no servidor.
 */
export async function registerPunch(params: RegisterPunchParams): Promise<RegisterPunchResult> {
  if (PlatformService.isLocalApiProvider()) {
    return enqueueAndMaybeSyncWebPunch(params as RegisterPunchSecureParams);
  }
  const {
    userId,
    companyId,
    type,
    method,
    timestamp,
    recordId,
    location,
    photoUrl,
    source = PUNCH_SOURCE_WEB,
  } = params;

  ensureUuidLike(userId, 'user_id');
  ensureUuidLike(companyId, 'company_id');

  const provider = getProvider();
  const data = await provider.registerPunch({
    user_id: userId,
    company_id: companyId,
    type,
    method,
    timestamp,
    record_id: recordId || null,
    location: location ? { lat: location.lat, lng: location.lng, accuracy: location.accuracy } : null,
    photo_url: photoUrl || null,
    source,
  });

  return {
    id: String((data as any)?.id ?? `local-${Date.now()}`),
    nsr: Number((data as any)?.nsr ?? 0),
    hash: String((data as any)?.hash ?? `hash-${Date.now()}`),
    previous_hash: String((data as any)?.previous_hash ?? '0'),
    timestamp: String((data as any)?.timestamp ?? new Date().toISOString()),
    receipt_id: String((data as any)?.receipt_id ?? (data as any)?.id ?? `receipt-${Date.now()}`),
  };
}

/** Drena fila web (ex.: botão ou ao fechar comprovante). */
function webPunchQueueAvailable(): boolean {
  return WEB_PUNCH_QUEUE && typeof indexedDB !== 'undefined';
}

export async function flushPendingWebPunches(): Promise<{ flushed: number; clientIds?: string[] }> {
  if (!webPunchQueueAvailable()) {
    return { flushed: 0, clientIds: [] };
  }
  const r = await flushWebPunchQueue({ force: true });
  return { flushed: r.flushed, clientIds: r.clientIds ?? [] };
}

export async function getPendingWebPunchCount(): Promise<number> {
  if (!webPunchQueueAvailable()) return 0;
  return countPendingWebPunches();
}

/**
 * Registro com fila offline (IndexedDB) + lote ≥10 — reduz egress no mobile/web.
 */
export async function registerPunchSecure(
  params: RegisterPunchSecureParams,
  evidence?: Omit<SavePunchEvidenceParams, 'timeRecordId'> | null,
): Promise<RegisterPunchResult & { pending?: boolean; clientId?: string }> {
  if (webPunchQueueAvailable()) {
    return enqueueAndMaybeSyncWebPunch(params, evidence ?? null);
  }
  const {
    userId,
    companyId,
    type,
    method,
    timestamp,
    recordId,
    location,
    photoUrl,
    source = PUNCH_SOURCE_WEB,
    latitude,
    longitude,
    accuracy,
    deviceId,
    deviceType,
    ipAddress,
    fraudScore,
    fraudFlags,
  } = params;

  ensureUuidLike(userId, 'user_id');
  ensureUuidLike(companyId, 'company_id');

  return registerPunch({
    userId,
    companyId,
    type,
    method,
    timestamp,
    recordId,
    location,
    photoUrl,
    source,
  });
}

/**
 * Gera dados do comprovante de registro de ponto (Portaria 671).
 * O comprovante já é salvo no RPC; esta função monta o objeto completo para PDF/JSON.
 */
export function buildPointReceiptData(
  record: {
    nsr: number;
    hash: string;
    type: string;
    timestamp: string;
    user_id: string;
    company_id: string;
  },
  company: { nome?: string; name?: string; cnpj?: string; endereco?: string; address?: string; cidade?: string } | null,
  employee: { nome?: string; name?: string; cpf?: string } | null
): PointReceiptData {
  const dt = record.timestamp ? new Date(record.timestamp) : new Date();
  const data = dt.toLocaleDateString('pt-BR');
  const hora = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  const nomeEmpresa = company?.nome || company?.name || '—';
  const cnpjEmpresa = company?.cnpj || '—';
  const localTrabalho =
    (typeof company?.endereco === 'object' && company?.endereco !== null)
      ? [company?.endereco].flat().join(', ')
      : (company?.address || company?.cidade || '—');

  const nomeTrabalhador = employee?.nome || (employee as any)?.name || '—';
  const cpfTrabalhador = employee?.cpf || '—';

  return {
    titulo: 'Comprovante de Registro de Ponto do Trabalhador',
    nsr: record.nsr,
    nomeEmpresa,
    cnpjEmpresa,
    localTrabalho,
    nomeTrabalhador,
    cpfTrabalhador,
    data,
    hora,
    hash: record.hash,
    tipoRegistro: record.type || '—',
  };
}

/**
 * Gera comprovante em JSON (para download ou armazenamento).
 */
export function generatePointReceiptJson(receiptData: PointReceiptData): string {
  return JSON.stringify(receiptData, null, 2);
}

/**
 * Valida integridade da cadeia de registros (NSR sequencial + hash).
 * Útil para auditoria e detecção de manipulação.
 */
export async function validateIntegrity(companyId: string): Promise<IntegrityResult> {
  if (!isSupabaseConfigured() || !db) {
    return { valid: false, errors: ['Sistema não configurado para REP-P.'] };
  }

  const errors: string[] = [];
  const details: IntegrityResult['details'] = [];

  const rows = (await db.select(
    'time_records',
    [{ column: 'company_id', operator: 'eq', value: companyId }],
    { column: 'nsr', ascending: true },
    50000
  )) as any[];

  if (!rows || rows.length === 0) {
    return { valid: true, errors: [] };
  }

  let previousHash = '0';
  let expectedNsr = 1;

  for (const row of rows) {
    if (row.nsr == null) {
      errors.push(`Registro id=${row.id} sem NSR.`);
      continue;
    }
    if (row.nsr !== expectedNsr) {
      errors.push(`NSR fora de sequência: esperado ${expectedNsr}, encontrado ${row.nsr} (id=${row.id}).`);
    }
    expectedNsr = row.nsr + 1;

    const payload = `${row.user_id}|${row.timestamp || row.created_at}|${row.nsr}|${previousHash}`;
    const expectedHash = await sha256Hex(payload);
    if (row.hash !== expectedHash) {
      errors.push(`Hash inválido no NSR ${row.nsr} (id=${row.id}).`);
      details.push({ nsr: row.nsr, expectedHash, actualHash: row.hash });
    }
    previousHash = row.hash;
  }

  return {
    valid: errors.length === 0,
    errors,
    details: details.length > 0 ? details : undefined,
  };
}

function sha256Hex(message: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    return crypto.subtle.digest('SHA-256', encoder.encode(message)).then((buf) =>
      Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    );
  }
  return Promise.resolve('');
}

/**
 * Formato AFD (Arquivo Fonte de Dados) - TXT para fiscalização.
 * Conteúdo: NSR, data, hora, CPF, tipo registro (ordenado por NSR).
 */
export function formatAfdLine(record: {
  nsr: number;
  timestamp?: string;
  created_at: string;
  user_id: string;
  type: string;
}, cpf: string): string {
  const ts = record.timestamp || record.created_at;
  const d = ts ? new Date(ts) : new Date();
  const data = d.toISOString().slice(0, 10).replace(/-/g, '');
  const hora = d.toTimeString().slice(0, 8).replace(/:/g, '');
  const cpfNorm = (cpf || '').replace(/\D/g, '').padStart(11, '0').slice(0, 11);
  const tipo = (record.type || 'E').slice(0, 1).toUpperCase();
  return `${String(record.nsr).padStart(9, '0')}\t${data}\t${hora}\t${cpfNorm}\t${tipo}`;
}

/**
 * Monta conteúdo AFD (TXT) para uma lista de registros com CPF por user_id.
 */
export function buildAfdContent(
  records: Array<{ nsr: number; timestamp?: string; created_at: string; user_id: string; type: string }>,
  cpfByUserId: Record<string, string>
): string {
  const sorted = [...records].filter((r) => r.nsr != null).sort((a, b) => (a.nsr ?? 0) - (b.nsr ?? 0));
  const header = 'NSR\tDATA\tHORA\tCPF\tTIPO';
  const lines = sorted.map((r) => formatAfdLine(r, cpfByUserId[r.user_id] || ''));
  return [header, ...lines].join('\r\n');
}

/**
 * Estrutura AEJ (Arquivo Eletrônico de Jornada): registros, horas trabalhadas, extras, faltas.
 */
export interface AejRecord {
  nsr: number;
  data: string;
  hora: string;
  cpf: string;
  tipo: string;
  user_id: string;
}

export interface AejSummary {
  totalHorasTrabalhadas: number;
  totalHorasExtras: number;
  totalFaltas: number;
  registros: AejRecord[];
}

export function buildAejContent(
  records: Array<{ nsr: number; timestamp?: string; created_at: string; user_id: string; type: string }>,
  cpfByUserId: Record<string, string>,
  summary: AejSummary
): string {
  const sorted = [...records].filter((r) => r.nsr != null).sort((a, b) => (a.nsr ?? 0) - (b.nsr ?? 0));
  const lines = sorted.map((r) => {
    const ts = r.timestamp || r.created_at;
    const d = ts ? new Date(ts) : new Date();
    const data = d.toISOString().slice(0, 10);
    const hora = d.toTimeString().slice(0, 8);
    const cpf = (cpfByUserId[r.user_id] || '').replace(/\D/g, '');
    return { nsr: r.nsr, data, hora, cpf, tipo: r.type, user_id: r.user_id };
  });
  const out = {
    versao: '1.0',
    geradoEm: new Date().toISOString(),
    resumo: summary,
    registros: lines,
  };
  return JSON.stringify(out, null, 2);
}
