import { useEffect, useRef, useCallback } from 'react';

const DEFAULT_TIMEOUT_MINUTES = 60;
const CHECK_INTERVAL_MS = 60_000; // 1 minuto

/**
 * Hook que encerra a sessão (logout) após N minutos de inatividade.
 * Usa session_timeout_minutes das configurações globais.
 */
export function useSessionTimeout(
  timeoutMinutes: number | null | undefined,
  onTimeout: () => void,
  enabled: boolean
) {
  const timeoutMs = (timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES) * 60 * 1000;
  const lastActivityRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!enabled || timeoutMs <= 0) return;
    timerRef.current = setTimeout(() => {
      onTimeout();
    }, timeoutMs);
  }, [enabled, timeoutMs, onTimeout]);

  useEffect(() => {
    if (!enabled) return;

    const handleActivity = () => {
      lastActivityRef.current = Date.now();
      resetTimer();
    };

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, handleActivity));

    resetTimer();

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, handleActivity));
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, resetTimer]);

  return { resetTimer };
}
