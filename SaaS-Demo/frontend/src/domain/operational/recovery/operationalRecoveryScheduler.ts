/** Agendamento não-bloqueante para tentativas de recovery (explícito; sem loop agressivo). */

export function scheduleOperationalRecoveryWindow(
  fn: () => void | Promise<void>,
  delayMs: number,
): ReturnType<typeof setTimeout> {
  const d = Math.max(5_000, Math.min(delayMs, 3600_000));
  return setTimeout(() => {
    void fn();
  }, d);
}
