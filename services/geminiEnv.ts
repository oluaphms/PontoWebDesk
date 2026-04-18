/**
 * Chave da API Gemini no cliente Vite: use VITE_GEMINI_API_KEY.
 * Em Node/scripts: GEMINI_API_KEY ou API_KEY.
 *
 * Modelo: use VITE_GEMINI_MODEL (ex.: gemini-2.0-flash-exp). O padrão é 'gemini-2.0-flash-exp',
 * que é compatível com a API Google AI Studio (v1beta). Nomes incorretos geram 400/404.
 * NOTA: A API v1beta requer nomes de modelo específicos. Evite usar 'models/' prefix no VITE_GEMINI_MODEL.
 */
export function getGeminiModelId(): string {
  try {
    const m = import.meta.env?.VITE_GEMINI_MODEL;
    if (m && String(m).trim()) return String(m).trim();
  } catch {
    /* import.meta indisponível */
  }
  if (typeof process !== 'undefined' && process.env) {
    const m = process.env.VITE_GEMINI_MODEL;
    if (m && String(m).trim()) return String(m).trim();
  }
  // Usando modelo com suffixo -exp que é mais compatível com a API v1beta
  return 'gemini-2.0-flash-exp';
}

export function getGeminiApiKey(): string | undefined {
  try {
    const viteKey = import.meta.env?.VITE_GEMINI_API_KEY;
    if (viteKey && String(viteKey).trim()) return String(viteKey).trim();
  } catch {
    /* import.meta indisponível */
  }
  if (typeof process !== 'undefined' && process.env) {
    const k =
      process.env.VITE_GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.API_KEY;
    if (k && String(k).trim()) return String(k).trim();
  }
  return undefined;
}
