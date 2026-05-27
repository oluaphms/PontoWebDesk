import type { AuthedRequest } from '../middlewares/authMiddleware.js';

export type AppRole = 'admin' | 'hr' | 'employee' | 'supervisor';

export function authUserId(auth: AuthedRequest['auth']): string {
  if (!auth) return '';
  return String(auth.sub || auth.userId || '').trim();
}

/** company_id exclusivamente do JWT — nunca query/body. */
export function requireCompanyId(req: AuthedRequest, res?: { status: (n: number) => { json: (b: unknown) => void } }): string | null {
  const companyId = String(req.auth?.companyId || '').trim();
  if (!companyId && res) {
    res.status(403).json({ ok: false, error: 'missing_tenant', message: 'Token sem empresa.' });
    return null;
  }
  return companyId || null;
}

export function normalizeRole(role: string | undefined): string {
  return String(role || 'employee').trim().toLowerCase();
}

export function isAdminOrHr(role: string | undefined): boolean {
  const r = normalizeRole(role);
  return r === 'admin' || r === 'hr';
}

export function isPrivilegedRole(role: string | undefined): boolean {
  return isAdminOrHr(role) || normalizeRole(role) === 'supervisor';
}

/** Rejeita company_id no query/body diferente do JWT (tentativa cross-tenant). */
export function rejectTenantOverride(req: AuthedRequest, res: { status: (n: number) => { json: (b: unknown) => void } }): boolean {
  const jwtCompany = String(req.auth?.companyId || '').trim();
  const fromQuery = String(req.query.companyId || req.query.company_id || '').trim();
  const body =
    req.body && typeof req.body === 'object'
      ? String((req.body as Record<string, unknown>).company_id || (req.body as Record<string, unknown>).companyId || '').trim()
      : '';
  const attempted = fromQuery || body;
  if (attempted && jwtCompany && attempted !== jwtCompany) {
    res.status(403).json({ ok: false, error: 'tenant_mismatch', message: 'company_id não permitido.' });
    return true;
  }
  return false;
}
