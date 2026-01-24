
import { GoogleGenAI } from "@google/genai";

export const getGeoInsight = async (latitude: number, longitude: number) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
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
    console.error("Erro no Maps Grounding:", error);
    return { 
      text: "Erro ao conectar com o serviço de inteligência geográfica.", 
      sources: [] 
    };
  }
};
