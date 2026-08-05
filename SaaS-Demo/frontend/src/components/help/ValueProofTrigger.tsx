import React, { useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { useLiveMaturityScore } from '../../help/useLiveMaturityScore';
import { ValueProofModal } from './ValueProofModal';

export const ValueProofTrigger: React.FC = () => {
  const score = useLiveMaturityScore();
  const [open, setOpen] = useState(false);

  if (score === null) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-indigo-300 dark:border-indigo-700 text-sm font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
      >
        <TrendingUp size={16} />
        Ver evolução da empresa
      </button>
      <ValueProofModal open={open} onClose={() => setOpen(false)} currentScore={score} />
    </>
  );
};

export default ValueProofTrigger;
