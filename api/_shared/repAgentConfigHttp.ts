/**
 * GET /api/rep/agent-config — recomendações de escopo para o agente local (go-live safe).
 */

import { getSecureCorsHeaders } from './security.js';
import { noCache } from './cache.js';

function corsHeaders(request: Request): Record<string, string> {
  return getSecureCorsHeaders(request, {
    allowMethods: 'GET, OPTIONS',
    allowHeaders: 'Content-Type, Authorization, X-REP-API-Key',
  });
}

function jsonResponse(headers: Record<string, string>, status: number, body: unknown): Response {
  return noCache(
    new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, 'Content-Type': 'application/json' },
    })
  );
}

function localTodayYmd(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function handleRepAgentConfig(request: Request): Promise<Response> {
  const cors = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers: cors }));
  }

  if (request.method !== 'GET') {
    return jsonResponse(cors, 405, { error: 'Method not allowed' });
  }

  const apiKey = (process.env.API_KEY || process.env.REP_API_KEY || '').trim();
  const authHeader = request.headers.get('Authorization') || request.headers.get('X-REP-API-Key') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!apiKey || token !== apiKey) {
    return jsonResponse(cors, 401, { error: 'Unauthorized' });
  }

  const url = new URL(request.url, 'https://local.invalid');
  const companyId = (url.searchParams.get('company_id') || '').trim();
  if (!companyId) {
    return jsonResponse(cors, 400, { error: 'company_id é obrigatório' });
  }

  const today = localTodayYmd();

  return jsonResponse(cors, 200, {
    recommendedScope: 'today_only',
    goLiveDate: today,
    firstRunPolicy: 'safe',
    company_id: companyId,
  });
}
