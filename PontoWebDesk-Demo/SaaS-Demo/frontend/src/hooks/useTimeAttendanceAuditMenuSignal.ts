import { useEffect, useMemo, useState } from 'react';
import {
  getTimeAttendanceAuditSummary,
  menuAuditSignalFromSummary,
  type TimeAttendanceAuditSummary,
} from '../services/timeAttendanceData';

export type AuditMenuSignal = 'critical' | 'warning' | null;

const POLL_MS = 120_000; // 2 min — cache de summary é 5 min; evita pressão no path getTimeAttendanceData

/**
 * Contadores leves para badge no menu (sidebar/dock/header). O cache de 30s fica em getTimeAttendanceAuditSummary.
 */
export function useTimeAttendanceAuditMenuSignal(
  companyId: string | null,
  enabled: boolean,
): { signal: AuditMenuSignal; summary: TimeAttendanceAuditSummary | null } {
  const [summary, setSummary] = useState<TimeAttendanceAuditSummary | null>(null);

  useEffect(() => {
    if (!enabled || !companyId) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    let inFlight = false;
    const run = async () => {
      if (inFlight) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const s = await getTimeAttendanceAuditSummary(companyId);
        if (!cancelled) setSummary(s);
      } finally {
        inFlight = false;
      }
    };
    void run();
    const id = window.setInterval(() => void run(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(id);
    };
  }, [companyId, enabled]);

  const signal = useMemo(() => menuAuditSignalFromSummary(summary), [summary]);
  return { signal, summary };
}
