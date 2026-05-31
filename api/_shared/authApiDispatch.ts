/**
 * Despacho único para /api/auth/* — menos funções no plano Hobby da Vercel.
 */

import authAdmin from './route-handlers/authAdmin.js';
import employeeInvite from './route-handlers/employeeInvite.js';
import passwordReset from './route-handlers/passwordReset.js';

function withPathname(request: Request, pathname: string): Request {
  const u = new URL(request.url);
  u.pathname = pathname;
  return new Request(u.toString(), request);
}

function forward(mod: { fetch: (r: Request) => Promise<Response> }, request: Request, legacyPath: string): Promise<Response> {
  return mod.fetch(withPathname(request, legacyPath));
}

export async function dispatchAuthRequest(request: Request): Promise<Response | null> {
  const u = new URL(request.url);
  const raw = u.pathname.replace(/\/+$/, '') || '';
  const m = raw.match(/^\/api\/auth(?:\/(.*))?$/);
  if (!m) return null;

  const rest = (m[1] ?? '').trim();
  const segs = rest.split('/').filter(Boolean);

  if (segs.length === 1 && segs[0] === 'admin') {
    return forward(authAdmin, request, `/api/auth-admin${u.search}`);
  }

  if (segs.length === 1 && segs[0] === 'employee-invite') {
    return forward(employeeInvite, request, `/api/employee-invite${u.search}`);
  }
  if (segs.length === 2 && segs[0] === 'employee-invite' && segs[1] === 'accept') {
    return forward(employeeInvite, request, `/api/employee-invite/accept${u.search}`);
  }
  if (segs.length === 1 && segs[0] === 'reset-password') {
    return forward(passwordReset, request, `/api/auth/reset-password${u.search}`);
  }

  return new Response(JSON.stringify({ success: false, error: 'NOT_FOUND' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
