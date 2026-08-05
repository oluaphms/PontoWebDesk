/**
 * Integração opcional com Google Gemini (desativada neste produto por padrão).
 * Só `import.meta.env.VITE_GEMINI_API_KEY` (build Vite) é considerada — sem fallback para
 * `process.env.API_KEY` no cliente (evita vazar segredo de API serverless no bundle).
 *
 * Modelo: `VITE_GEMINI_MODEL`; padrão `gemini-1.5-flash`.
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
  return 'gemini-1.5-flash';
}

/**
 * Insights automáticos no dashboard (App.tsx): **desligado por padrão**.
 * Defina `VITE_ENABLE_AI_INSIGHTS=true` para habilitar uma única chamada quando houver registros.
 * IA no dashboard só roda se a chave existir em build (`VITE_GEMINI_API_KEY`).
 */
export function isAiDashboardInsightsAutoEnabled(): boolean {
  try {
    return String(import.meta.env?.VITE_ENABLE_AI_INSIGHTS || '').toLowerCase() === 'true';
  } catch {
    return false;
  }
}

/** Verifica se a chave parece ser um placeholder ou inválida */
function isPlaceholderKey(key: string): boolean {
  const k = key.toLowerCase().trim();
  const placeholderPatterns = [
    'placeholder',
    'your_key_here',
    'your_api_key',
    'yourkey',
    'example',
    'test',
    'demo',
    'fake',
    'invalid',
    'xxx',
    'yyy',
    'zzz',
    '123456',
    'changeme',
    'not_set',
    'undefined',
    'null',
    'none',
  ];

  // Verifica padrões de placeholder
  if (placeholderPatterns.some(p => k.includes(p))) return true;

  // Chaves Gemini devem começar com "AIza" e ter ~39 caracteres
  if (!k.startsWith('aiza') && key.length < 30) return true;

  return false;
}

/**
 * Verifica se a chave da API Gemini é válida.
 * Retorna um objeto com status e mensagem de erro se inválida.
 */
export function validateGeminiApiKey(key: string | undefined): {
  valid: boolean;
  error?: string;
} {
  if (!key) {
    return { valid: false, error: 'Integração com IA não está configurada neste sistema.' };
  }

  if (isPlaceholderKey(key)) {
    return {
      valid: false,
      error: 'Integração com IA não está configurada neste sistema.',
    };
  }

  // Verifica formato básico da chave Gemini (começa com AIza)
  if (!key.startsWith('AIza')) {
    return {
      valid: false,
      error: 'Integração com IA não está configurada neste sistema.',
    };
  }

  return { valid: true };
}

export function getGeminiApiKey(): string | undefined {
  try {
    const viteKey = import.meta.env?.VITE_GEMINI_API_KEY;
    if (viteKey && String(viteKey).trim()) return String(viteKey).trim();
  } catch {
    /* import.meta indisponível */
  }
  return undefined;
}
