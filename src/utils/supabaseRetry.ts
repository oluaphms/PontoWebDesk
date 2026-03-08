/**
 * Executa uma função que retorna uma promise com retry automático.
 * Útil para chamadas Supabase em redes instáveis ou projeto free tier pausado.
 */

export async function supabaseRetry<T>(
  fn: () => Promise<T>,
  retries: number = 3,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;

    console.warn('[SmartPonto] Supabase retry...', retries, error);

    await new Promise((r) => setTimeout(r, 2000));

    return supabaseRetry(fn, retries - 1);
  }
}
