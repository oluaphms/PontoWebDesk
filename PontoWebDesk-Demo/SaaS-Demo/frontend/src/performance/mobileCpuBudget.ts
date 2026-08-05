/**
 * Modo degradado em mobile: menos polling, init mais tardio, menos GEO em rede.
 */
export function isDegradedMobileRuntime(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const mobile = /Android|iPhone|iPad|iPod/i.test(ua);
  if (!mobile) return false;

  const cores =
    typeof navigator.hardwareConcurrency === 'number' && Number.isFinite(navigator.hardwareConcurrency)
      ? navigator.hardwareConcurrency
      : 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

  if (cores <= 4) return true;
  if (typeof mem === 'number' && Number.isFinite(mem) && mem <= 4) return true;
  return false;
}
