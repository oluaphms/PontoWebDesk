/**
 * Router interno REP — única entrada via api/rep/[[...slug]].ts (Vercel Hobby).
 * Resolve rotas aninhadas pelo pathname completo (ex.: devices/{id}/sync-status).
 */

import { noCache } from './cache.js';
import { logRepApi } from './repApiResilience.js';

export type RepRouteContext = {
  request: Request;
  pathname: string;
  /** Tudo após /api/rep/ (ex.: "devices/uuid/sync-status") */
  slug: string;
  segments: string[];
};

export function buildRepRouteContext(request: Request): RepRouteContext {
  const u = new URL(request.url);
  const pathname = u.pathname.replace(/\/+$/, '') || '';
  const m = pathname.match(/^\/api\/rep(?:\/(.*))?$/i);
  const slug = (m?.[1] ?? '').trim();
  const segments = slug
    ? slug.split('/').filter(Boolean).map((s) => {
        try {
          return decodeURIComponent(s);
        } catch {
          return s;
        }
      })
    : [];
  return { request, pathname, slug, segments };
}

/** Log de diagnóstico (produção: visível nos logs Vercel). */
export function logRepRoute(ctx: RepRouteContext, extra?: Record<string, unknown>): void {
  logRepApi('info', ctx.pathname || '/api/rep', {
    op: 'route',
    method: ctx.request.method,
    slug: ctx.slug || '(root)',
    segments: ctx.segments,
    ...extra,
  });
}

function notFound(message: string): Response {
  return noCache(
    Response.json(
      { error: message, route: 'rep' },
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    ),
  );
}

/**
 * Despacha /api/rep/* — retorna Response ou null se não for rota REP.
 */
export async function routeRepRequest(request: Request): Promise<Response | null> {
  const ctx = buildRepRouteContext(request);
  if (!/^\/api\/rep(?:\/|$)/i.test(ctx.pathname)) return null;

  logRepRoute(ctx);

  if (!ctx.slug) {
    return notFound(
      'Rota REP inválida. Use /api/rep/punch, /api/rep/heartbeat, /api/rep/sync-status?device_id=, /api/rep/devices/{id}/sync-status, etc.',
    );
  }

  const [s0, s1, s2] = ctx.segments;

  // --- devices/{id}/sync-status (rota aninhada → handler leve) ---
  if (s0 === 'devices' && s2 === 'sync-status' && s1) {
    const { handleSyncStatus } = await import('./repSyncStatusLite.js');
    return handleSyncStatus(request, s1);
  }

  // --- devices/{id}/… (pending-users, ack-sync, heartbeat, force-sync) ---
  if (s0 === 'devices' && s1 && s2) {
    try {
      const { handleDeviceSyncRoute } = await import('./deviceSyncHttp.js');
      return handleDeviceSyncRoute(
        request,
        `devices/${encodeURIComponent(s1)}/${s2}`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logRepApi('error', ctx.pathname, { op: 'device_sync', message: detail });
      return noCache(
        Response.json(
          { error: 'REP_DEVICE_SYNC_MODULE_LOAD_FAILED', detail },
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
  }

  if (ctx.slug === 'heartbeat') {
    const { handleRepHeartbeat } = await import('./repHeartbeatHttp.js');
    return handleRepHeartbeat(request);
  }

  if (ctx.slug === 'collect') {
    const { handleRepCollect } = await import('./repCollectHttp.js');
    return handleRepCollect(request);
  }

  if (ctx.slug === 'punch' || (ctx.slug === 'punches' && request.method === 'POST')) {
    try {
      const { handleRepPunchRpcLite } = await import('./repPunchRpcLite.js');
      return handleRepPunchRpcLite(request);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return noCache(
        Response.json(
          { error: 'REP_PUNCH_MODULE_LOAD_FAILED', detail },
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
  }

  if (ctx.slug === 'commands') {
    try {
      const { handleRepCommands } = await import('./repDeviceCommandsHttp.js');
      return handleRepCommands(request);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const { emptyCommandsResponse } = await import('./repApiResilience.js');
      const { getSecureCorsHeaders } = await import('./security.js');
      const hdr = getSecureCorsHeaders(request, {
        allowMethods: 'GET, POST, OPTIONS',
        allowHeaders: 'Content-Type, Authorization',
      });
      if (request.method === 'GET') {
        return emptyCommandsResponse(hdr, detail);
      }
      return noCache(
        Response.json(
          { error: 'REP_COMMANDS_MODULE_LOAD_FAILED', detail },
          { status: 500, headers: { ...hdr, 'Content-Type': 'application/json' } },
        ),
      );
    }
  }

  if (ctx.slug === 'command-result') {
    try {
      const { handleRepCommandResult } = await import('./repDeviceCommandsHttp.js');
      return handleRepCommandResult(request);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return noCache(
        Response.json(
          { error: 'REP_COMMAND_RESULT_MODULE_LOAD_FAILED', detail },
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
  }

  /** Rotas planas com ?device_id= (compat Hobby / agentes antigos) */
  const flatDeviceActions = new Set(['sync-status', 'ack-sync', 'pending-users', 'force-sync']);
  if (flatDeviceActions.has(ctx.slug)) {
    const url = new URL(request.url);
    const deviceId = url.searchParams.get('device_id')?.trim() ?? '';
    if (!deviceId) {
      return noCache(
        Response.json(
          { error: 'device_id é obrigatório (query ?device_id=)' },
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }

    if (ctx.slug === 'sync-status' && request.method === 'GET') {
      const { handleSyncStatus } = await import('./repSyncStatusLite.js');
      return handleSyncStatus(request, deviceId);
    }

    try {
      const { handleDeviceSyncRoute } = await import('./deviceSyncHttp.js');
      return handleDeviceSyncRoute(
        request,
        `devices/${encodeURIComponent(deviceId)}/${ctx.slug}`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return noCache(
        Response.json(
          { error: 'REP_DEVICE_SYNC_MODULE_LOAD_FAILED', detail },
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
  }

  if (ctx.slug.startsWith('devices/')) {
    try {
      const { handleDeviceSyncRoute } = await import('./deviceSyncHttp.js');
      return handleDeviceSyncRoute(request, ctx.slug);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return noCache(
        Response.json(
          { error: 'REP_DEVICE_SYNC_MODULE_LOAD_FAILED', detail },
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
  }

  const { handleRepSlug } = await import('../../modules/rep-integration/repApiRoutes.js');
  return handleRepSlug(request, ctx.slug);
}
