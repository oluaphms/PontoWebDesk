/** Aceita ISO `YYYY-MM-DD` ou BR `DD/MM/AAAA` (e variantes sem zero à esquerda). */
export function parseFlexibleDate(input: string): string | null {
  const t = (input || '').trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}
