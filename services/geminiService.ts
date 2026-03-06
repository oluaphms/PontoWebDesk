
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

const HR_SYSTEM_PROMPT = `Você é um assistente de IA do SmartPonto, focado em ajudar a equipe de RH.
Responda de forma clara e objetiva sobre: políticas de ponto, férias, ausências, escalas, banco de horas, 
ajustes de registro, dispositivos e locais de trabalho. Se não souber algo específico do sistema, sugira 
consultar o manual ou o administrador. Mantenha tom profissional e prestativo. Responda em português.`;

// Chat com IA para RH: envia mensagem e retorna resposta do modelo
export const sendHRChatMessage = async (userMessage: string, history: { role: 'user' | 'model'; text: string }[] = []): Promise<string> => {
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return "A API da IA não está configurada. Defina VITE_GEMINI_API_KEY no ambiente.";
  }

  const ai = new GoogleGenAI({ apiKey });

  const contents = [
    HR_SYSTEM_PROMPT,
    ...history.flatMap((m) => (m.role === 'user' ? `Usuário: ${m.text}` : `Assistente: ${m.text}`)),
    `Usuário: ${userMessage}`,
  ].join('\n\n');

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: contents,
    });

    const text = response.text?.trim();
    return text || "Não foi possível obter uma resposta. Tente novamente.";
  } catch (error) {
    console.error("Erro no chat com IA:", error);
    return "Ocorreu um erro ao processar sua mensagem. Verifique a conexão e a chave da API e tente novamente.";
  }
};
