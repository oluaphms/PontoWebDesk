/**
 * Helpers de apresentação — sem API, sem service, sem fetch.
 * Equivalentes comportamentais a formatCompanyDate / formatPlanPrice.
 */

export function formatDisplayDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(t));
}

export function formatMoneyBrl(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format((cents || 0) / 100);
}
