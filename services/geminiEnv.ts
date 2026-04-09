/**
 * Chave da API Gemini no cliente Vite: use VITE_GEMINI_API_KEY.
 * Em Node/scripts: GEMINI_API_KEY ou API_KEY.
 *
 * Modelo: use VITE_GEMINI_MODEL (ex.: gemini-2.5-flash). O padrão é gemini-2.0-flash,
 * amplamente aceito na API Google AI Studio; nomes incorretos geram 400/404.
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
  return 'gemini-2.0-flash';
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
