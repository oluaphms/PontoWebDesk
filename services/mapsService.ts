import { getGeminiApiKey, getGeminiModelId, validateGeminiApiKey } from "./geminiEnv";

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Extrai código de status HTTP do erro */
function getErrorStatusCode(error: unknown): number | null {
  const t = errorText(error);
  const match = t.match(/\b(\d{3})\b/);
  return match ? parseInt(match[1], 10) : null;
}

export async function getGeoInsight(
  latitude: number,
  longitude: number,
): Promise<{ text: string; sources: unknown[] }> {
  try {
    return await getGeoInsightImpl(latitude, longitude);
  } catch (e) {
    if (import.meta.env?.DEV) {
      console.warn('[Gemini Maps] getGeoInsight isolado:', e);
    }
    return {
      text: 'Serviço de inteligência geográfica indisponível. Tente novamente mais tarde.',
      sources: [],
    };
  }
}

async function getGeoInsightImpl(
  latitude: number,
  longitude: number,
): Promise<{ text: string; sources: unknown[] }> {
  const apiKey = getGeminiApiKey();

  // Validação inicial da chave
  const validation = validateGeminiApiKey(apiKey);
  if (!validation.valid) {
    if (import.meta.env?.DEV) {
      console.warn('[Gemini Maps] Validação da chave falhou:', validation.error);
    }
    return {
      text: validation.error || 'Inteligência geográfica por IA não está disponível neste ambiente.',
      sources: [],
    };
  }

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: apiKey! });
  const model = getGeminiModelId();

  try {
    const response = await ai.models.generateContent({
      model,
      contents: `Analise as coordenadas (${latitude}, ${longitude}) e descreva o contexto urbano desta localização de trabalho. Identifique pontos de referência, facilidades de transporte e amenidades próximas. Forneça uma análise sobre a adequação do local para presença física de funcionários.`,
      config: {
        tools: [{ googleMaps: {} }],
        toolConfig: {
          retrievalConfig: {
            latLng: {
              latitude: latitude,
              longitude: longitude
            }
          }
        }
      },
    });

    const text = response.text || "Não foi possível gerar a análise no momento.";
    const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

    return { text, sources };
  } catch (error) {
    const errorMsg = errorText(error);
    const statusCode = getErrorStatusCode(error);

    // Log detalhado em desenvolvimento
    if (import.meta.env?.DEV) {
      console.warn(`[Gemini Maps] Erro (status: ${statusCode || 'unknown'}):`, errorMsg);
    }

    // Tratamento específico para erro 400
    if (statusCode === 400) {
      if (import.meta.env?.DEV) {
        console.warn(
          `[Gemini Maps] Erro 400: o modelo '${model}' pode não estar disponível. Defina VITE_GEMINI_MODEL (ex.: gemini-1.5-flash).`,
        );
      }
      return {
        text: "Serviço de inteligência geográfica temporariamente indisponível devido a atualização da API.",
        sources: []
      };
    }

    if (import.meta.env?.DEV) {
      console.warn('[Gemini Maps] Erro no Maps Grounding:', errorMsg);
    }
    return {
      text: "Erro ao conectar com o serviço de inteligência geográfica.",
      sources: []
    };
  }
}
