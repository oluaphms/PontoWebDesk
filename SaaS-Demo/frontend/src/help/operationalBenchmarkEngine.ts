export type BenchmarkComparison = 'acima da media' | 'na media' | 'abaixo da media';

export interface OperationalBenchmarkResult {
  percentile: number;
  comparison: BenchmarkComparison;
  message: string;
}

/**
 * Benchmark simulado a partir do score (sem backend).
 * Percentil derivado linearmente do score para efeito de comparação de mercado.
 */
export function computeOperationalBenchmark(score: number): OperationalBenchmarkResult {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const percentile = clamped;

  let comparison: BenchmarkComparison;
  let message: string;

  if (clamped > 75) {
    comparison = 'acima da media';
    message = `Você está melhor que ${percentile}% das empresas similares`;
  } else if (clamped >= 50) {
    comparison = 'na media';
    message = 'Seu RH está na média operacional do mercado';
  } else {
    comparison = 'abaixo da media';
    message = 'Seu RH está abaixo da média operacional';
  }

  return { percentile, comparison, message };
}

export function benchmarkComparisonLabel(comparison: BenchmarkComparison): string {
  const map: Record<BenchmarkComparison, string> = {
    'acima da media': 'Acima da média',
    'na media': 'Na média',
    'abaixo da media': 'Abaixo da média',
  };
  return map[comparison];
}
