/**
 * Rede lenta / economia de dados — alinha polling, realtime e GEO com o orçamento de rede.
 */
export function isLowNetworkMode(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (navigator.saveData === true) return true;

  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
    mozConnection?: { saveData?: boolean; effectiveType?: string };
    webkitConnection?: { saveData?: boolean; effectiveType?: string };
  };
  const c = nav.connection || nav.mozConnection || nav.webkitConnection;
  if (c?.saveData === true) return true;

  const et = c?.effectiveType;
  if (et === 'slow-2g' || et === '2g' || et === '3g') return true;
  return false;
}

/** Android, WebView embutido, ou hardware fraco — bootstrap degradado (sem GEO agressivo, realtime tardio, etc.). */
export function isAndroidOrWebViewUa(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return true;
  if (/\bwv\b|WebView|(iPhone|iPod|iPad)(?!.*Safari\/)/i.test(ua)) return true;
  return false;
}

export function isRestrictedBootstrapMode(): boolean {
  if (isLowNetworkMode()) return true;
  if (isAndroidOrWebViewUa()) return true;
  const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
  if (typeof hc === 'number' && Number.isFinite(hc) && hc <= 4) return true;
  return false;
}
