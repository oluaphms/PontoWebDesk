
import { GoogleGenAI, Type } from "@google/genai";
import { DailySummary } from "../types";

// Analyze time tracking data to provide productivity and work-life balance insights
export const getWorkInsights = async (summaries: DailySummary[]) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `Analise os seguintes registros de ponto dos últimos dias e forneça um insight curto (máximo 3 frases) sobre produtividade, pontualidade e equilíbrio vida-trabalho para o funcionário. Retorne em formato JSON.
  Dados: ${JSON.stringify(summaries)}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
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

    // Access the text property directly (not a method) as per SDK guidelines
    const jsonStr = response.text?.trim();
    if (!jsonStr) {
      throw new Error("Empty response text from Gemini API");
    }
    
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Erro ao obter insights da IA:", error);
    return { insight: "Continue mantendo o registro regular do seu ponto para análises futuras.", score: 8 };
  }
};
