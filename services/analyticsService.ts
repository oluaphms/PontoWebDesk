/**
 * Analytics avançado: métricas comparativas e previsões
 */

import { TimeRecord, CompanyKPIs } from '../types';
import { PontoService } from './pontoService';

export interface ComparativeMetrics {
  current: CompanyKPIs;
  previous: CompanyKPIs;
  change: {
    punctuality: number; // %
    absenteeism: number; // %
    overtimeHours: number;
    averageDelay: number; // minutos
  };
}

export interface Prediction {
  metric: string;
  value: number;
  trend: 'up' | 'down' | 'stable';
  confidence: number; // 0-100
  message: string;
}

export const AnalyticsService = {
  async getComparativeMetrics(
    companyId: string,
    currentPeriod: { start: Date; end: Date },
    previousPeriod: { start: Date; end: Date }
  ): Promise<ComparativeMetrics> {
    const current = await PontoService.getCompanyKPIs(companyId);
    const previous = await PontoService.getCompanyKPIs(companyId); // TODO: calcular para período anterior

    return {
      current,
      previous,
      change: {
        punctuality: current.punctuality - previous.punctuality,
        absenteeism: current.absenteeism - previous.absenteeism,
        overtimeHours: current.overtimeHours - previous.overtimeHours,
        averageDelay: current.averageDelay - previous.averageDelay,
      },
    };
  },

  async getPredictions(companyId: string, records: TimeRecord[]): Promise<Prediction[]> {
    const predictions: Prediction[] = [];

    // Análise de tendência de pontualidade
    const recentRecords = records.slice(0, 30);
    const lateCount = recentRecords.filter((r) => {
      // Simplificado: considerar atraso se entrada após 9h
      const hour = new Date(r.createdAt).getHours();
      return r.type === 'entrada' && hour >= 9;
    }).length;

    const punctualityTrend = lateCount > recentRecords.length * 0.2 ? 'down' : 'up';
    predictions.push({
      metric: 'Punctuality',
      value: 85,
      trend: punctualityTrend,
      confidence: 75,
      message:
        punctualityTrend === 'down'
          ? 'Tendência de aumento de atrasos detectada'
          : 'Pontualidade mantendo-se estável',
    });

    // Previsão de horas extras
    const totalHours = recentRecords.reduce((acc, r) => {
      // Simplificado
      return acc + 8;
    }, 0);
    const avgHours = totalHours / (recentRecords.length || 1);

    predictions.push({
      metric: 'Overtime',
      value: avgHours > 8 ? avgHours - 8 : 0,
      trend: avgHours > 8 ? 'up' : 'stable',
      confidence: 60,
      message: avgHours > 8 ? 'Horas extras acima da média esperada' : 'Jornada dentro do esperado',
    });

    return predictions;
  },

  getDepartmentComparison(companyId: string, departments: string[]): Promise<Record<string, CompanyKPIs>> {
    // TODO: Implementar comparação entre departamentos
    return Promise.resolve({});
  },
};
