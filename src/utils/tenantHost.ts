/**
 * Resolve slug de tenant a partir do subdomínio (ex.: acme.cronodigital.app → "acme").
 * Ignora www, app e localhost.
 */
export function getTenantSlugFromHostname(hostname: string | undefined | null): string | null {
  if (!hostname) return null;
  const h = hostname.split(':')[0].toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return null;
  const parts = h.split('.');
  if (parts.length < 2) return null;
  const sub = parts[0];
  if (!sub || sub === 'www' || sub === 'app') return null;
  return sub;
}
