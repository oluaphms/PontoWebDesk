/**
 * Evita promises pendentes indefinidamente (loading infinito).
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operação'): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Tempo esgotado (${ms / 1000}s) em ${label}. Verifique a rede ou tente novamente.`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}
