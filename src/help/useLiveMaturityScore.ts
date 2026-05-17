import { useCallback, useEffect, useState } from 'react';
import { LEGACY_MATURITY_UPDATED, PW_MATURITY_UPDATED } from './helpEvents';
import { getMaturityHistory } from './helpMaturityHistory';

export function useLiveMaturityScore(): number | null {
  const [score, setScore] = useState<number | null>(() => {
    const history = getMaturityHistory();
    return history.length > 0 ? history[history.length - 1].score : null;
  });

  const refresh = useCallback(() => {
    const history = getMaturityHistory();
    const last = history[history.length - 1];
    if (last) setScore(last.score);
  }, []);

  useEffect(() => {
    refresh();
    const onUpdate = () => refresh();
    window.addEventListener(PW_MATURITY_UPDATED, onUpdate);
    window.addEventListener(LEGACY_MATURITY_UPDATED, onUpdate);
    return () => {
      window.removeEventListener(PW_MATURITY_UPDATED, onUpdate);
      window.removeEventListener(LEGACY_MATURITY_UPDATED, onUpdate);
    };
  }, [refresh]);

  return score;
}
