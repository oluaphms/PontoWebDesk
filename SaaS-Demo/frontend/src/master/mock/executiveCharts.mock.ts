/**
 * Dados mock exclusivos dos gráficos do Dashboard Executivo.
 * Não vêm da API Master / banco.
 */

export type MockRevenuePoint = {
  month: string;
  receita: number;
  assinaturas: number;
};

export type MockModePoint = {
  name: string;
  value: number;
  fill: string;
};

export type MockUsagePoint = {
  day: string;
  ativo: number;
  punches: number;
};

/** Receita / assinaturas — últimos 6 meses (mock). */
export const MOCK_REVENUE_SERIES: readonly MockRevenuePoint[] = [
  { month: 'Fev', receita: 18200, assinaturas: 12 },
  { month: 'Mar', receita: 21450, assinaturas: 15 },
  { month: 'Abr', receita: 19800, assinaturas: 14 },
  { month: 'Mai', receita: 24600, assinaturas: 18 },
  { month: 'Jun', receita: 27100, assinaturas: 21 },
  { month: 'Jul', receita: 30500, assinaturas: 24 },
] as const;

/** Mix de modos de implantação (mock). */
export const MOCK_MODE_MIX: readonly MockModePoint[] = [
  { name: 'SaaS', value: 48, fill: '#6366f1' },
  { name: 'Local', value: 27, fill: '#94a3b8' },
  { name: 'Híbrido', value: 25, fill: '#8b5cf6' },
] as const;

/** Uso operacional da semana (mock). */
export const MOCK_USAGE_SERIES: readonly MockUsagePoint[] = [
  { day: 'Seg', ativo: 420, punches: 1180 },
  { day: 'Ter', ativo: 455, punches: 1260 },
  { day: 'Qua', ativo: 438, punches: 1215 },
  { day: 'Qui', ativo: 490, punches: 1340 },
  { day: 'Sex', ativo: 510, punches: 1410 },
  { day: 'Sáb', ativo: 180, punches: 320 },
  { day: 'Dom', ativo: 95, punches: 140 },
] as const;
