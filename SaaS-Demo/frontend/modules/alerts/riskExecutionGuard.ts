/**
 * Evita rajadas concorrentes de recálculo de risco por empresa (server-side debounce leve).
 */
const inFlight = new Map<string, true>();

/** Executa no máximo uma avaliação de risco por `companyId` por janela (~2s após o fim da execução). */
export async function runRiskOnce(companyId: string, fn: () => Promise<void>): Promise<void> {
  const key = companyId.trim();
  if (!key) return;

  if (inFlight.has(key)) {
    return;
  }

  inFlight.set(key, true);

  try {
    await fn();
  } finally {
    globalThis.setTimeout(() => {
      inFlight.delete(key);
    }, 2000);
  }
}
