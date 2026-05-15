import { DailySummary } from "../types";
import { getGeminiApiKey, getGeminiModelId, validateGeminiApiKey } from "./geminiEnv";

const FALLBACK_INSIGHT = {
  insight: 'Insights por IA não estão disponíveis neste ambiente. Continue registrando seu ponto normalmente.',
  score: 8,
} as const;

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isInvalidOrDeniedGeminiKey(error: unknown): boolean {
  const t = errorText(error);
  return /API_KEY_INVALID|API key not valid|invalid api key|PERMISSION_DENIED|403/i.test(t);
}

/** 400/404: modelo indisponível, descontinuado ou payload inválido. */
function isLikelyModelOrPayloadError(error: unknown): boolean {
  const t = errorText(error);
  return /\b400\b|\b404\b|INVALID_ARGUMENT|not found|is not (found|supported)|does not exist|FAILED_PRECONDITION|Bad Request/i.test(t);
}

const GEMINI_MODEL_FALLBACK = 'gemini-1.5-flash';

/** Extrai código de status HTTP do erro */
function getErrorStatusCode(error: unknown): number | null {
  const t = errorText(error);
  const match = t.match(/\b(\d{3})\b/);
  return match ? parseInt(match[1], 10) : null;
}

function parseInsightJsonFromText(text: string): { insight: string; score: number } | null {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const o = JSON.parse(jsonMatch[0]) as { insight?: unknown; score?: unknown };
    if (typeof o.insight === 'string' && typeof o.score === 'number') {
      return { insight: o.insight, score: o.score };
    }
  } catch {
    // ignora
  }
  return null;
}

async function getWorkInsightsImpl(summaries: DailySummary[]): Promise<{ insight: string; score: number }> {
  const apiKey = getGeminiApiKey();

  // Validação inicial da chave
  const validation = validateGeminiApiKey(apiKey);
  if (!validation.valid) {
    if (import.meta.env?.DEV) {
      console.warn('[Gemini] Validação da chave falhou:', validation.error);
    }
    return {
      insight: validation.error || FALLBACK_INSIGHT.insight,
      score: 8,
    };
  }

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: apiKey! });
  const model = getGeminiModelId();

  const plainPrompt = `Analise os seguintes registros de ponto dos últimos dias e forneça um insight curto (máximo 3 frases) sobre produtividade, pontualidade e equilíbrio vida-trabalho para o funcionário. Retorne APENAS um objeto JSON válido neste formato exato: {"insight":"...","score":8} com score entre 0 e 10. Sem markdown, sem explicações adicionais.
  Dados: ${JSON.stringify(summaries)}`;

  try {
    const runGenerate = (m: string) =>
      ai.models.generateContent({
        model: m,
        contents: plainPrompt,
      });

    let response;
    try {
      response = await runGenerate(model);
    } catch (firstErr) {
      const code = getErrorStatusCode(firstErr);
      if (
        (code === 404 || code === 400) &&
        model !== GEMINI_MODEL_FALLBACK &&
        isLikelyModelOrPayloadError(firstErr)
      ) {
        if (import.meta.env?.DEV) {
          console.warn(
            `[Gemini] Modelo '${model}' indisponível (${code}); tentando '${GEMINI_MODEL_FALLBACK}'.`,
          );
        }
        response = await runGenerate(GEMINI_MODEL_FALLBACK);
      } else {
        throw firstErr;
      }
    }

    const jsonStr = response.text?.trim();
    if (!jsonStr) {
      throw new Error("Empty response text from Gemini API");
    }

    try {
      return JSON.parse(jsonStr);
    } catch {
      const fallback = parseInsightJsonFromText(jsonStr);
      if (fallback) return fallback;
      throw new Error("Invalid JSON in response");
    }
  } catch (error) {
    const errorMsg = errorText(error);
    const statusCode = getErrorStatusCode(error);

    // Log detalhado em desenvolvimento
    if (import.meta.env?.DEV) {
      console.warn(`[Gemini] Erro na API (status: ${statusCode || 'unknown'}):`, errorMsg);
    }

    if (isInvalidOrDeniedGeminiKey(error)) {
      if (import.meta.env?.DEV) {
        console.warn('[Gemini] Chave inválida ou sem permissão para o modelo.');
      }
      return {
        insight: FALLBACK_INSIGHT.insight,
        score: 8,
      };
    }

    // Tratamento específico para erro 400 (Bad Request)
    if (statusCode === 400 || statusCode === 404 || isLikelyModelOrPayloadError(error)) {
      if (import.meta.env?.DEV) {
        console.warn(
          `[Gemini] Erro de modelo (400/404) — Possíveis causas:\n` +
          `  1. Modelo '${model}' não disponível para a chave. Defina VITE_GEMINI_MODEL (ex.: gemini-1.5-flash ou gemini-2.0-flash)\n` +
          `  2. Chave de API inválida ou sem acesso ao modelo\n` +
          `  3. Formato da requisição incompatível com a versão da biblioteca\n` +
          `Erro original:`, errorMsg
        );
      }
      return {
        insight: "Insights por IA temporariamente indisponíveis. O modelo de IA está sendo atualizado. Continue registrando seu ponto normalmente.",
        score: 8,
      };
    }

    if (import.meta.env?.DEV) {
      console.warn("[Gemini] Insights - Erro genérico:", errorMsg);
    }

    return { insight: "Continue mantendo o registro regular do seu ponto para análises futuras.", score: 8 };
  }
}

/**
 * Insights de produtividade — **nunca lança**: falhas da API ficam isoladas do restante do app.
 */
export async function getWorkInsights(summaries: DailySummary[]): Promise<{ insight: string; score: number }> {
  try {
    return await getWorkInsightsImpl(summaries);
  } catch (error) {
    if (import.meta.env?.DEV) {
      console.warn('[Gemini] getWorkInsights falhou (isolado, sem impacto no app):', error);
    }
    return { ...FALLBACK_INSIGHT };
  }
}

const HR_SYSTEM_PROMPT = `Você é um assistente de IA do SmartPonto, focado em ajudar a equipe de RH.
Responda de forma clara e objetiva sobre: políticas de ponto, férias, ausências, escalas, banco de horas, 
ajustes de registro, dispositivos e locais de trabalho. Se não souber algo específico do sistema, sugira 
consultar o manual ou o administrador. Mantenha tom profissional e prestativo. Responda em português.`;

// Chat com IA para RH: envia mensagem e retorna resposta do modelo
async function sendHRChatMessageImpl(
  userMessage: string,
  history: { role: 'user' | 'model'; text: string }[] = [],
): Promise<string> {
  const apiKey = getGeminiApiKey();

  // Validação inicial da chave
  const validation = validateGeminiApiKey(apiKey);
  if (!validation.valid) {
    if (import.meta.env?.DEV) {
      console.warn('[Gemini Chat] Validação da chave falhou:', validation.error);
    }
    return validation.error || 'O assistente de IA não está disponível neste ambiente.';
  }

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: apiKey! });
  const model = getGeminiModelId();

  const contents = [
    HR_SYSTEM_PROMPT,
    ...history.flatMap((m) => (m.role === 'user' ? `Usuário: ${m.text}` : `Assistente: ${m.text}`)),
    `Usuário: ${userMessage}`,
  ].join('\n\n');

  try {
    const runChat = (m: string) =>
      ai.models.generateContent({
        model: m,
        contents,
      });

    let response;
    try {
      response = await runChat(model);
    } catch (firstErr) {
      const code = getErrorStatusCode(firstErr);
      if (
        (code === 404 || code === 400) &&
        model !== GEMINI_MODEL_FALLBACK &&
        isLikelyModelOrPayloadError(firstErr)
      ) {
        if (import.meta.env?.DEV) {
          console.warn(`[Gemini Chat] Modelo '${model}' falhou (${code}); tentando '${GEMINI_MODEL_FALLBACK}'.`);
        }
        response = await runChat(GEMINI_MODEL_FALLBACK);
      } else {
        throw firstErr;
      }
    }

    const text = response.text?.trim();
    return text || "Não foi possível obter uma resposta. Tente novamente.";
  } catch (error) {
    const errorMsg = errorText(error);
    const statusCode = getErrorStatusCode(error);

    if (import.meta.env?.DEV) {
      console.warn(`[Gemini] Chat - Erro (status: ${statusCode || 'unknown'}):`, errorMsg);
    }

    if (isInvalidOrDeniedGeminiKey(error)) {
      if (import.meta.env?.DEV) {
        console.warn('[Gemini] Chat: chave inválida ou sem permissão.');
      }
      return 'O assistente de IA não está disponível neste ambiente.';
    }

    // Tratamento específico para erro 400
    if (statusCode === 400 || statusCode === 404 || isLikelyModelOrPayloadError(error)) {
      if (import.meta.env?.DEV) {
        console.warn(
          `[Gemini] Chat: modelo '${model}' ou payload — tente VITE_GEMINI_MODEL=gemini-1.5-flash ou gemini-2.0-flash`,
        );
      }
      return "O serviço de chat com IA está temporariamente indisponível devido a uma atualização. Tente novamente mais tarde.";
    }

    return "Ocorreu um erro ao processar sua mensagem. Verifique a conexão e a chave da API e tente novamente.";
  }
}

export async function sendHRChatMessage(
  userMessage: string,
  history: { role: 'user' | 'model'; text: string }[] = [],
): Promise<string> {
  try {
    return await sendHRChatMessageImpl(userMessage, history);
  } catch (error) {
    if (import.meta.env?.DEV) {
      console.warn('[Gemini] Chat isolado (falha não propaga):', error);
    }
    return 'O assistente de IA está temporariamente indisponível. Tente novamente em instantes.';
  }
}
