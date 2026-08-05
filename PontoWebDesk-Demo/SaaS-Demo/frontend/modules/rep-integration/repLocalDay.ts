/**
 * Alinha-se a `filterPunchesToLocalToday` em repSyncJob: dia civil local do relógio do processo
 * (calendário do computador no browser / servidor Node com TZ local).
 */
export function getLocalCalendarDayBoundsIso(): { startIso: string; endIso: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const start = new Date(y, m, d, 0, 0, 0, 0);
  const end = new Date(y, m, d, 23, 59, 59, 999);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** Dia civil local no formato YYYY-MM-DD (mesmo calendário de `getLocalCalendarDayBoundsIso`). */
export function getLocalCalendarYmd(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
