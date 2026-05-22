export function isSupabaseBlocked(error: unknown): boolean {
  const e = error as { status?: number; message?: string };
  const message = String(e?.message || '').toLowerCase();
  return e?.status === 402 || message.includes('exceed_egress_quota');
}
