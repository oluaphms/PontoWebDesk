import { GoogleGenAI, Type } from "@google/genai";
import { DailySummary } from "../types";
import { getGeminiApiKey, getGeminiModelId } from "./geminiEnv";

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

/** 400: modelo indisponível, payload inválido ou recurso não habilitado para a chave. */
function isLikelyModelOrPayloadError(error: unknown): boolean {
  const t = errorText(error);
  return /\b400\b|INVALID_ARGUMENT|not found|is not (found|supported)|does not exist|FAILED_PRECONDITION/i.test(t);
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

// Analyze time tracking data to provide productivity and work-life balance insights
export const getWorkInsights = async (summaries: DailySummary[]) => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return {
      insight:
        "Defina VITE_GEMINI_API_KEY no ambiente de build para insights por IA, ou continue registrando o ponto normalmente.",
      score: 8,
    };
  }
  const ai = new GoogleGenAI({ apiKey });
  const model = getGeminiModelId();

  const prompt = `Analise os seguintes registros de ponto dos últimos dias e forneça um insight curto (máximo 3 frases) sobre produtividade, pontualidade e equilíbrio vida-trabalho para o funcionário. Retorne em formato JSON.
  Dados: ${JSON.stringify(summaries)}`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            insight: { type: Type.STRING },
            score: { type: Type.NUMBER, description: "Nota de 0 a 10 para o equilíbrio de horários" }
          },
          required: ["insight", "score"]
        }
      }
    });

    const jsonStr = response.text?.trim();
    if (!jsonStr) {
      throw new Error("Empty response text from Gemini API");
    }

    try {
      return JSON.parse(jsonStr);
    } catch {
      const fallback = parseInsightJsonFromText(jsonStr);
      if (fallback) return fallback;
      throw new Error("Invalid JSON in structured response");
    }
  } catch (firstError) {
    // Retry sem schema JSON (algumas contas/modelos retornam 400 com responseSchema).
    if (!isInvalidOrDeniedGeminiKey(firstError)) {
      try {
        const plainPrompt = `${prompt}\n\nResponda apenas um objeto JSON válido neste formato exato: {"insight":"...","score":8} com score entre 0 e 10. Sem markdown.`;
        const response = await ai.models.generateContent({
          model,
          contents: plainPrompt,
        });
        const jsonStr = response.text?.trim();
        if (jsonStr) {
          try {
            return JSON.parse(jsonStr);
          } catch {
            const fallback = parseInsightJsonFromText(jsonStr);
            if (fallback) return fallback;
          }
        }
      } catch {
        // segue para handler abaixo
      }
    }
    const error = firstError;
    if (isInvalidOrDeniedGeminiKey(error)) {
      if (import.meta.env?.DEV) {
        console.warn(
          "[Gemini] Chave inválida ou sem permissão para o modelo. Gere uma chave em https://aistudio.google.com/apikey e defina VITE_GEMINI_API_KEY."
        );
      }
      return {
        insight:
          "Insights por IA indisponíveis: a chave da API Gemini é inválida ou expirou. Configure uma chave válida em VITE_GEMINI_API_KEY (Google AI Studio) e reinicie o app.",
        score: 8,
      };
    }
    if (isLikelyModelOrPayloadError(error) && import.meta.env?.DEV && typeof console !== 'undefined') {
      console.warn(
        "[Gemini] Insights (400/modelo): verifique VITE_GEMINI_MODEL (ex.: gemini-2.0-flash ou gemini-2.5-flash) e a chave em Google AI Studio.",
        errorText(error)
      );
    } else if (import.meta.env?.DEV) {
      console.warn("[Gemini] Insights:", errorText(error));
    }
    return { insight: "Continue mantendo o registro regular do seu ponto para análises futuras.", score: 8 };
  }
};

const HR_SYSTEM_PROMPT = `Você é um assistente de IA do SmartPonto, focado em ajudar a equipe de RH.
Responda de forma clara e objetiva sobre: políticas de ponto, férias, ausências, escalas, banco de horas, 
ajustes de registro, dispositivos e locais de trabalho. Se não souber algo específico do sistema, sugira 
consultar o manual ou o administrador. Mantenha tom profissional e prestativo. Responda em português.`;

// Chat com IA para RH: envia mensagem e retorna resposta do modelo
export const sendHRChatMessage = async (userMessage: string, history: { role: 'user' | 'model'; text: string }[] = []): Promise<string> => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return "A API da IA não está configurada. Defina VITE_GEMINI_API_KEY no ambiente de build (Vercel) e faça um novo deploy.";
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = getGeminiModelId();

  const contents = [
    HR_SYSTEM_PROMPT,
    ...history.flatMap((m) => (m.role === 'user' ? `Usuário: ${m.text}` : `Assistente: ${m.text}`)),
    `Usuário: ${userMessage}`,
  ].join('\n\n');

  try {
    const response = await ai.models.generateContent({
      model,
      contents: contents,
    });

    const text = response.text?.trim();
    return text || "Não foi possível obter uma resposta. Tente novamente.";
  } catch (error) {
    if (isInvalidOrDeniedGeminiKey(error)) {
      if (import.meta.env?.DEV) {
        console.warn("[Gemini] Chat: chave inválida ou sem permissão. Verifique VITE_GEMINI_API_KEY.");
      }
      return "A chave da API Gemini é inválida ou expirou. Gere uma nova em Google AI Studio, defina VITE_GEMINI_API_KEY e reinicie o servidor.";
    }
    if (import.meta.env?.DEV) {
      console.warn("[Gemini] Chat:", errorText(error));
    }
    return "Ocorreu um erro ao processar sua mensagem. Verifique a conexão e a chave da API e tente novamente.";
  }
};
