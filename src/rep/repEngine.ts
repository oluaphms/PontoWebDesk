/**
 * REP-P Engine (Portaria 671/2021)
 * Registrador Eletrônico de Ponto via Programa.
 * Responsabilidades: registrar ponto com NSR, hash, comprovante, integridade, exportação AFD/AEJ.
 */

import { supabase, db, isSupabaseConfigured } from '../services/supabaseClient';
import { withTimeout } from '../utils/withTimeout';

export interface RegisterPunchParams {
  userId: string;
  companyId: string;
  type: string;
  method: string;
  recordId?: string;
  location?: { lat: number; lng: number; accuracy?: number };
  photoUrl?: string | null;
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

const RPC_NAME = 'rep_register_punch';
const MAX_NSR = 999999999;

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
  return err instanceof Error ? err : new Error(msg || 'Erro ao registrar ponto');
}

/**
 * Registra marcação de ponto conforme REP-P (NSR + hash + imutabilidade).
 * Usa RPC no Supabase para garantir sequência e hash no servidor.
 */
export async function registerPunch(params: RegisterPunchParams): Promise<RegisterPunchResult> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase não configurado. Não é possível registrar ponto REP-P.');
  }
  const {
    userId,
    companyId,
    type,
    method,
    recordId,
    location,
    photoUrl,
    source = 'web',
  } = params;

  const RPC_TIMEOUT_MS = 15000;
  const { data, error } = await withTimeout(
    supabase.rpc(RPC_NAME, {
      p_user_id: userId,
      p_company_id: companyId,
      p_type: type,
      p_method: method,
      p_record_id: recordId || null,
      p_location: location ? { lat: location.lat, lng: location.lng, accuracy: location.accuracy } : null,
      p_photo_url: photoUrl || null,
      p_source: source,
    }),
    RPC_TIMEOUT_MS,
    'registrar ponto (REP)',
  );

  if (error) throw normalizePunchRegistrationError(error);
  if (!data) throw new Error('Resposta vazia do registro de ponto REP-P.');

  return data as RegisterPunchResult;
}

const RPC_SECURE_NAME = 'rep_register_punch_secure';

/**
 * Registra marcação com dados antifraude (geolocalização, dispositivo, fraud_score).
 * Usa RPC rep_register_punch_secure quando disponível.
 */
export async function registerPunchSecure(params: RegisterPunchSecureParams): Promise<RegisterPunchResult> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase não configurado. Não é possível registrar ponto REP-P.');
  }
  const {
    userId,
    companyId,
    type,
    method,
    recordId,
    location,
    photoUrl,
    source = 'web',
    latitude,
    longitude,
    accuracy,
    deviceId,
    deviceType,
    ipAddress,
    fraudScore,
    fraudFlags,
  } = params;

  const RPC_TIMEOUT_MS = 15000;
  const { data, error } = await withTimeout(
    supabase.rpc(RPC_SECURE_NAME, {
      p_user_id: userId,
      p_company_id: companyId,
      p_type: type,
      p_method: method,
      p_record_id: recordId || null,
      p_location: location ? { lat: location.lat, lng: location.lng, accuracy: location.accuracy } : null,
      p_photo_url: photoUrl || null,
      p_source: source,
      p_latitude: latitude ?? null,
      p_longitude: longitude ?? null,
      p_accuracy: accuracy ?? null,
      p_device_id: deviceId ?? null,
      p_device_type: deviceType ?? null,
      p_ip_address: ipAddress ?? null,
      p_fraud_score: fraudScore ?? null,
      p_fraud_flags: fraudFlags && fraudFlags.length ? fraudFlags : null,
    }),
    RPC_TIMEOUT_MS,
    'registrar ponto (REP seguro)',
  );

  if (error) {
    if (error.code === '42883') {
      return registerPunch(params);
    }
    throw normalizePunchRegistrationError(error);
  }
  if (!data) throw new Error('Resposta vazia do registro de ponto REP-P.');

  return data as RegisterPunchResult;
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
  if (!isSupabaseConfigured || !db) {
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
