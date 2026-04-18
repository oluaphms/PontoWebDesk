import { GoogleGenAI } from "@google/genai";
import { getGeminiApiKey, getGeminiModelId } from "./geminiEnv";

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

export const getGeoInsight = async (latitude: number, longitude: number) => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return {
      text: "Inteligência geográfica indisponível: configure VITE_GEMINI_API_KEY no projeto.",
      sources: [],
    };
  }
  const ai = new GoogleGenAI({ apiKey });
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
          `[Gemini Maps] Erro 400: O modelo '${model}' pode não estar disponível. ` +
          `Tente definir VITE_GEMINI_MODEL=gemini-2.0-flash-exp ou gemini-1.5-flash`
        );
      }
      return {
        text: "Serviço de inteligência geográfica temporariamente indisponível devido a atualização da API.",
        sources: []
      };
    }

    console.error("[Gemini Maps] Erro no Maps Grounding:", error);
    return {
      text: "Erro ao conectar com o serviço de inteligência geográfica.",
      sources: []
    };
  }
};
