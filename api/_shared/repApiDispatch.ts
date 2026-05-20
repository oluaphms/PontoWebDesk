/**
 * Despacho único para /api/rep/* (plano Hobby Vercel — uma Serverless Function).
 */

import { noCache } from './cache.js';

function extractRepSlug(request: Request): string {
  const u = new URL(request.url);
  const raw = u.pathname.replace(/\/+$/, '') || '';
  const m = raw.match(/^\/api\/rep(?:\/(.*))?$/);
  if (!m) return '';
  const tail = (m[1] ?? '').trim();
  return tail ? decodeURIComponent(tail) : '';
}

/** Devolve resposta ou null se o caminho não for /api/rep. */
export async function dispatchRepRequest(request: Request): Promise<Response | null> {
  const u = new URL(request.url);
  const raw = u.pathname.replace(/\/+$/, '') || '';
  if (!/^\/api\/rep(?:\/|$)/.test(raw)) return null;

  const slug = extractRepSlug(request);

  if (!slug) {
    return noCache(
      Response.json(
        { error: 'Rota REP inválida. Use /api/rep/punch, /api/rep/heartbeat, /api/rep/devices/{id}/sync-status, etc.' },
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  }

  if (slug === 'heartbeat') {
    const { handleRepHeartbeat } = await import('./repHeartbeatHttp.js');
    return handleRepHeartbeat(request);
  }
  if (slug === 'collect') {
    const { handleRepCollect } = await import('./repCollectHttp.js');
    return handleRepCollect(request);
  }
  if (slug === 'punch' || (slug === 'punches' && request.method === 'POST')) {
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
  if (slug.startsWith('devices/')) {
    try {
      const { handleDeviceSyncRoute } = await import('./deviceSyncHttp.js');
      return handleDeviceSyncRoute(request, slug);
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
  if (slug === 'commands') {
    try {
      const { handleRepCommands } = await import('./repDeviceCommandsHttp.js');
      return handleRepCommands(request);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return noCache(
        Response.json(
          { error: 'REP_COMMANDS_MODULE_LOAD_FAILED', detail },
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
  }
  if (slug === 'command-result') {
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

  const { handleRepSlug } = await import('../../modules/rep-integration/repApiRoutes.js');
  return handleRepSlug(request, slug);
}
