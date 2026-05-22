/**
 * Projeto Supabase restrito por exceed_egress_quota (HTTP 402).
 * Evita health checks e settings em loop enquanto a cota não for liberada.
 */

const SESSION_KEY = 'pontoweb:supabase_egress_blocked';

export const SUPABASE_EGRESS_QUOTA_MESSAGE =
  'Projeto Supabase bloqueado por cota de egress (402). Acesse o painel Supabase → Billing ou abra um ticket em supabase.help. Login e batidas ficam indisponíveis até liberar a cota.';

let blockedInMemory = false;
const listeners = new Set<() => void>();

function readSessionFlag(): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  return sessionStorage.getItem(SESSION_KEY) === '1';
}

function emit() {
  for (const fn of listeners) fn();
}

export function isSupabaseEgressBlocked(): boolean {
  return blockedInMemory || readSessionFlag();
}

export function markSupabaseEgressBlocked(): void {
  if (blockedInMemory && readSessionFlag()) return;
  blockedInMemory = true;
  try {
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    /* quota / modo privado */
  }
  emit();
}

/** Após liberar cota no Supabase (teste manual com REST 200). */
export function clearSupabaseEgressBlocked(): void {
  blockedInMemory = false;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  emit();
}

export function subscribeSupabaseEgressBlocked(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isEgressQuotaHttpStatus(status: number): boolean {
  return status === 402;
}

export function isEgressQuotaErrorPayload(error: unknown): boolean {
  const e = error as { code?: string; status?: number; message?: string };
  const code = String(e?.code ?? '').toLowerCase();
  const status = Number(e?.status ?? 0);
  const text = [e?.message, (e as { details?: string })?.details, (e as { hint?: string })?.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return (
    status === 402 ||
    code === '402' ||
    text.includes('exceed_egress_quota') ||
    text.includes('egress_quota') ||
    text.includes('payment required') ||
    text.includes('service for this project is restricted')
  );
}
