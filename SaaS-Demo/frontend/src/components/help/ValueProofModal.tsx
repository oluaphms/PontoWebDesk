import React, { useEffect, useMemo } from 'react';
import { X, Share2 } from 'lucide-react';
import { getAchievementsWithStatus } from '../../help/helpAchievements';
import { getImpactPhrase, getValueProofHeadline } from '../../help/helpImpactPhrases';
import { getInitialMaturityScore, getMaturityEvolutionSummary } from '../../help/helpMaturityHistory';
import { computeOperationalBenchmark } from '../../help/operationalBenchmarkEngine';

interface ValueProofModalProps {
  open: boolean;
  onClose: () => void;
  currentScore: number;
}

export const ValueProofModal: React.FC<ValueProofModalProps> = ({ open, onClose, currentScore }) => {
  const initial = useMemo(() => getInitialMaturityScore(), [open]);
  const evolution = useMemo(() => getMaturityEvolutionSummary(30), [open]);
  const benchmark = useMemo(() => computeOperationalBenchmark(currentScore), [currentScore]);
  const achievements = useMemo(() => getAchievementsWithStatus().filter((a) => a.unlocked), [open]);
  const impact = useMemo(() => getImpactPhrase(currentScore), [currentScore]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        id="value-proof-screenshot"
      >
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-start gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              Prova de valor
            </p>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mt-1">Evolução da empresa</h2>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">{getValueProofHeadline(currentScore, initial)}</p>
          <p className="text-sm text-indigo-700 dark:text-indigo-300 font-medium">{impact}</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">{benchmark.message}</p>
          {evolution && <p className="text-sm text-emerald-700 dark:text-emerald-400">{evolution.message}</p>}

          {achievements.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase mb-2">Principais conquistas</p>
              <ul className="flex flex-wrap gap-2">
                {achievements.map((a) => (
                  <li
                    key={a.id}
                    className="text-xs px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-100"
                  >
                    {a.emoji} {a.title}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[10px] text-slate-400 text-center pt-2">PontoWebDesk — Maturidade operacional</p>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
          >
            <Share2 size={16} />
            Imprimir / screenshot
          </button>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium bg-indigo-600 text-white">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};

export default ValueProofModal;
