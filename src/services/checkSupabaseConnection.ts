import { supabase, checkSupabaseConfigured, isSupabaseConfigured } from '../../services/supabaseClient';
import { canRetrySupabase, isDnsError, markSupabaseAsDown } from './supabaseCircuitBreaker';

export type SupabaseConnectionStatus =
  | 'ok'
  | 'dns'
  | 'network'
  | 'timeout'
  | 'offline'
  | 'not_configured'
  | 'egress_quota'
  | 'unknown'
  | 'circuit_breaker';

export type SupabaseConnectionCheckResult = {
  ok: boolean;
  status: SupabaseConnectionStatus;
  message: string;
};

let lastFailureLogKey = '';
let lastFailureLogAt = 0;

function shouldLogFailure(logKey: string): boolean {
  const now = Date.now();
  if (lastFailureLogKey === logKey && now - lastFailureLogAt < 30000) return false;
  lastFailureLogKey = logKey;
  lastFailureLogAt = now;
  return true;
}

function getErrorText(error: unknown): string {
  const e = error as any;
  return [e?.message, e?.details, e?.hint, e?.error?.message, e?.cause?.message]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase())
    .join(' | ');
}

function isEgressQuotaBlocked(error: unknown): boolean {
  const e = error as { code?: string; status?: number; message?: string };
  const code = String(e?.code ?? '').toLowerCase();
  const status = Number(e?.status ?? 0);
  const text = getErrorText(error);
  return (
    status === 402 ||
    code === '402' ||
    text.includes('exceed_egress_quota') ||
    text.includes('egress_quota') ||
    text.includes('payment required') ||
    text.includes('service for this project is restricted')
  );
}

function classifyFailure(error: unknown): SupabaseConnectionCheckResult {
  const text = getErrorText(error);
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;

  if (isEgressQuotaBlocked(error)) {
    return {
      ok: false,
      status: 'egress_quota',
      message:
        'Projeto Supabase bloqueado por cota de egress (402). Libere no painel Supabase ou contate suporte — o app não consegue autenticar nem gravar dados até resolver.',
    };
  }

  if (text.includes('timeout') || text.includes('tempo esgotado')) {
    return { ok: false, status: 'timeout', message: 'Tempo esgotado ao conectar com o servidor.' };
  }
  if (text.includes('err_name_not_resolved') || text.includes('name_not_resolved') || text.includes('dns')) {
    return { ok: false, status: 'dns', message: 'Falha de DNS ao acessar o Supabase.' };
  }
  if (!online) {
    return { ok: false, status: 'offline', message: 'Sem conexão com a internet no dispositivo.' };
  }
  if (text.includes('failed to fetch') || text.includes('networkerror') || text.includes('typeerror')) {
    return { ok: false, status: 'network', message: 'Falha de rede ao acessar o Supabase.' };
  }
  return { ok: false, status: 'unknown', message: 'Não foi possível conectar ao Supabase.' };
}

/**
 * Diagnóstico não bloqueante da conexão com o Supabase.
 * Nunca deve bloquear login nem inicialização do app.
 */
export async function checkSupabaseConnection(): Promise<SupabaseConnectionCheckResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, status: 'not_configured', message: 'Supabase não configurado.' };
  }
  if (!canRetrySupabase()) {
    return {
      ok: false,
      status: 'circuit_breaker',
      message: 'Supabase em cooldown após falhas recentes. Aguarde alguns segundos e tente novamente.',
    };
  }
  try {
    const { error } = await supabase.from('punches').select('id').limit(1);
    if (error) throw error;
    return { ok: true, status: 'ok', message: 'Conectado ao Supabase.' };
  } catch (error) {
    if (isDnsError(error)) markSupabaseAsDown();
    const result = classifyFailure(error);
    const key = `${result.status}:${result.message}`;
    if (shouldLogFailure(key)) {
      console.warn('[SUPABASE] modo degradado ativo:', result.message, { status: result.status });
    }
    return result;
  }
}
