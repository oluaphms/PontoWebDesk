/** Compara ids de usuário (UUID) ignorando hífens e diferença de maiúsculas. */
export function sameUserId(a: string | undefined | null, b: string | undefined | null): boolean {
  const x = String(a ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '');
  const y = String(b ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '');
  return x.length > 0 && x === y;
}
