/**
 * Despacho único para rotas /api/operational/* (plano Hobby Vercel: menos Serverless Functions).
 * Replica URLs legadas /api/operational-foo antes de delegar aos handlers.
 */

import operationalStatus from './route-handlers/operationalStatus.js';
import operationalRisk from './route-handlers/operationalRisk.js';
import operationalAlerts from './route-handlers/operationalAlerts.js';
import operationalTasks from './route-handlers/operationalTasks.js';
import operationalAudit from './route-handlers/operationalAudit.js';
import operationalTimeline from './route-handlers/operationalTimeline.js';

function withPathname(request: Request, pathname: string): Request {
  const u = new URL(request.url);
  u.pathname = pathname;
  return new Request(u.toString(), request);
}

function forward(mod: { fetch: (r: Request) => Promise<Response> }, request: Request, legacyPath: string): Promise<Response> {
  return mod.fetch(withPathname(request, legacyPath));
}

/** Devolve resposta ou null se o caminho não for operacional. */
export async function dispatchOperationalRequest(request: Request): Promise<Response | null> {
  const u = new URL(request.url);
  const raw = u.pathname.replace(/\/+$/, '') || '';
  const m = raw.match(/^\/api\/operational(?:\/(.*))?$/);
  if (!m) return null;

  const rest = (m[1] ?? '').trim();
  const segs = rest.split('/').filter(Boolean);

  if (segs.length === 1 && segs[0] === 'status') {
    return forward(operationalStatus, request, `/api/operational-status${u.search}`);
  }
  if (segs.length === 1 && segs[0] === 'risk') {
    return forward(operationalRisk, request, `/api/operational-risk${u.search}`);
  }
  if (segs.length === 1 && segs[0] === 'audit') {
    return forward(operationalAudit, request, `/api/operational-audit${u.search}`);
  }
  if (segs.length === 1 && segs[0] === 'timeline') {
    return forward(operationalTimeline, request, `/api/operational-timeline${u.search}`);
  }

  if (segs.length === 1 && segs[0] === 'alerts') {
    return forward(operationalAlerts, request, `/api/operational-alerts${u.search}`);
  }
  if (segs.length === 3 && segs[0] === 'alerts' && segs[2] === 'resolve') {
    const id = encodeURIComponent(segs[1]);
    return forward(operationalAlerts, request, `/api/operational-alerts/${id}/resolve${u.search}`);
  }

  if (segs.length === 1 && segs[0] === 'tasks') {
    return forward(operationalTasks, request, `/api/operational-tasks${u.search}`);
  }
  if (segs.length === 3 && segs[0] === 'tasks' && segs[2] === 'complete') {
    const id = encodeURIComponent(segs[1]);
    return forward(operationalTasks, request, `/api/operational-tasks/${id}/complete${u.search}`);
  }

  return noCacheJson(404, { success: false, error: 'NOT_FOUND' });
}

function noCacheJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
