export function isSupabaseBlocked(error: unknown): boolean {
  const e = error as { status?: number; code?: string; message?: string };
  const status = Number(e?.status ?? 0);
  const code = String(e?.code ?? '').toLowerCase();
  const text = [
    e?.message,
    (e as { details?: string })?.details,
    (e as { hint?: string })?.hint,
    (e as { error?: { message?: string } })?.error?.message,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return (
    status === 402 ||
    code === '402' ||
    text.includes('exceed_egress_quota') ||
    text.includes('egress') ||
    text.includes('egress_quota') ||
    text.includes('payment required') ||
    text.includes('quota') ||
    text.includes('service for this project is restricted')
  );
}
