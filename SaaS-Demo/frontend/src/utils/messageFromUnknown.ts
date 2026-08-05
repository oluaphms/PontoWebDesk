/**
 * Extrai mensagem legível de valores lançados em `catch` (`unknown`).
 */
export function messageFromUnknown(err: unknown, fallback = 'Erro.'): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return fallback;
}
