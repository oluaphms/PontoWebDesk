import React, { useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { computeOperationalBenchmark, benchmarkComparisonLabel } from '../../help/operationalBenchmarkEngine';
import { getImpactPhrase } from '../../help/helpImpactPhrases';
import { useLiveMaturityScore } from '../../help/useLiveMaturityScore';
import { ValueProofModal } from './ValueProofModal';

interface MaturityBenchmarkBlockProps {
  showProofButton?: boolean;
}

export const MaturityBenchmarkBlock: React.FC<MaturityBenchmarkBlockProps> = ({
  showProofButton = true,
}) => {
  const score = useLiveMaturityScore();
  const [proofOpen, setProofOpen] = useState(false);

  const benchmark = useMemo(() => (score !== null ? computeOperationalBenchmark(score) : null), [score]);
  const impact = useMemo(() => (score !== null ? getImpactPhrase(score) : null), [score]);

  if (score === null) return null;

  return (
    <>
      <section className="rounded-2xl border border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/50 dark:bg-indigo-950/20 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <TrendingUp className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
            <div>
              {benchmark && (
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{benchmark.message}</p>
              )}
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {benchmark && benchmarkComparisonLabel(benchmark.comparison)} · percentil {benchmark.percentile}
              </p>
              {impact && <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300 mt-2">{impact}</p>}
            </div>
          </div>
          {showProofButton && (
            <button
              type="button"
              onClick={() => setProofOpen(true)}
              className="shrink-0 px-3 py-2 rounded-xl text-sm font-semibold border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40"
            >
              Ver evolução da empresa
            </button>
          )}
        </div>
      </section>
      <ValueProofModal open={proofOpen} onClose={() => setProofOpen(false)} currentScore={score} />
    </>
  );
};

export default MaturityBenchmarkBlock;
