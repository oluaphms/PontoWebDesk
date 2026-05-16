/**
 * Despacho único para rotas /api/operational/* (plano Hobby Vercel: menos Serverless Functions).
 * Replica URLs legadas /api/operational-foo antes de delegar aos handlers.
 */

function withPathname(request: Request, pathname: string): Request {
  const u = new URL(request.url);
  u.pathname = pathname;
  return new Request(u.toString(), request);
}

async function forward(
  modulePath: string,
  request: Request,
  legacyPath: string,
  route: string,
): Promise<Response> {
  try {
    const loaded = (await import(modulePath)) as { default?: { fetch?: (r: Request) => Promise<Response> } };
    const mod = loaded?.default;
    if (!mod?.fetch) throw new Error(`INVALID_HANDLER_MODULE:${modulePath}`);
    return mod.fetch(withPathname(request, legacyPath));
  } catch (error) {
    console.error('[OPERATIONAL DISPATCH ERROR]', {
      route,
      requestUrl: request.url,
      modulePath,
      message: (error as { message?: string } | null)?.message,
      stack: (error as { stack?: string } | null)?.stack,
    });

    return noCacheJson(200, {
      success: true,
      data: [],
      degraded: true,
      error: 'INTERNAL_ERROR',
      detail: (error as { message?: string } | null)?.message,
    });
  }
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
    return forward('./route-handlers/operationalStatus.js', request, `/api/operational-status${u.search}`, 'status');
  }
  if (segs.length === 1 && segs[0] === 'risk') {
    return forward('./route-handlers/operationalRisk.js', request, `/api/operational-risk${u.search}`, 'risk');
  }
  if (segs.length === 1 && segs[0] === 'audit') {
    return forward('./route-handlers/operationalAudit.js', request, `/api/operational-audit${u.search}`, 'audit');
  }
  if (segs.length === 1 && segs[0] === 'legal-audit') {
    return forward('./route-handlers/operationalLegalAudit.js', request, `/api/operational-legal-audit${u.search}`, 'legal-audit');
  }
  if (segs.length === 2 && segs[0] === 'legal' && segs[1] === 'audit') {
    return forward('./route-handlers/operationalLegalAudit.js', request, `/api/operational-legal-audit${u.search}`, 'legal-audit');
  }
  if (segs.length === 1 && segs[0] === 'timeline') {
    return forward('./route-handlers/operationalTimeline.js', request, `/api/operational-timeline${u.search}`, 'timeline');
  }

  if (segs.length === 1 && segs[0] === 'alerts') {
    return forward('./route-handlers/operationalAlerts.js', request, `/api/operational-alerts${u.search}`, 'alerts');
  }
  if (segs.length === 3 && segs[0] === 'alerts' && segs[2] === 'resolve') {
    const id = encodeURIComponent(segs[1]);
    return forward('./route-handlers/operationalAlerts.js', request, `/api/operational-alerts/${id}/resolve${u.search}`, 'alerts-resolve');
  }

  if (segs.length === 1 && segs[0] === 'tasks') {
    return forward('./route-handlers/operationalTasks.js', request, `/api/operational-tasks${u.search}`, 'tasks');
  }
  if (segs.length === 3 && segs[0] === 'tasks' && segs[2] === 'complete') {
    const id = encodeURIComponent(segs[1]);
    return forward('./route-handlers/operationalTasks.js', request, `/api/operational-tasks/${id}/complete${u.search}`, 'tasks-complete');
  }

  return noCacheJson(404, { success: false, error: 'NOT_FOUND' });
}

function noCacheJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
