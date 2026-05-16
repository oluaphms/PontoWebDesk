import { createClient } from '@supabase/supabase-js';
import { buildTimesheetForPeriod } from '../src/engine/timeEngine';
import { messageFromUnknown } from '../src/utils/messageFromUnknown';
import { getSecureCorsHeaders, checkRateLimit, getClientIP, extractBearerToken, secureCompare } from './_shared/security.js';
import { resolveRequestUrl } from './_shared/getRequestBaseUrl.js';
import { getSupabaseConfig } from './_shared/getSupabaseConfig.js';
import { noCache } from './_shared/cache.js';

const ALLOWED_METHODS = 'GET, OPTIONS';

async function handler(request: Request): Promise<Response> {
  const corsHeaders = getSecureCorsHeaders(request, {
    allowMethods: ALLOWED_METHODS,
    allowHeaders: 'Content-Type, Authorization',
  });

  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers: corsHeaders }));
  }
  if (request.method !== 'GET') {
    return noCache(Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders }));
  }

  // Rate limiting por IP
  const clientIP = getClientIP(request);
  const rateLimit = checkRateLimit(clientIP, 'api');
  if (!rateLimit.allowed) {
    return noCache(Response.json(
      { error: 'Rate limit exceeded. Try again later.', retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000) },
      { status: 429, headers: corsHeaders }
    ));
  }

  const apiKey = (process.env.API_KEY || '').trim();
  if (!apiKey) {
    return noCache(Response.json({ error: 'API_KEY não configurada.' }, { status: 500, headers: corsHeaders }));
  }

  const token = extractBearerToken(request);
  if (!token || !secureCompare(token, apiKey)) {
    return noCache(Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders }));
  }

  let url: string;
  let serviceKey: string;
  try {
    ({ url, serviceKey } = getSupabaseConfig());
  } catch {
    return noCache(Response.json({ error: 'Configuração Supabase ausente.' }, { status: 500, headers: corsHeaders }));
  }

  const searchParams = resolveRequestUrl(request).searchParams;
  const userId = searchParams.get('userId');
  const month = searchParams.get('month'); // formato YYYY-MM
  const companyId = searchParams.get('companyId') || undefined;

  if (!userId || !month) {
    return noCache(Response.json({ error: 'userId e month (YYYY-MM) são obrigatórios.' }, { status: 400, headers: corsHeaders }));
  }

  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const m = Number(monthStr);
  if (!year || !m || m < 1 || m > 12) {
    return noCache(Response.json({ error: 'Parâmetro month inválido. Use YYYY-MM.' }, { status: 400, headers: corsHeaders }));
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const result = await buildTimesheetForPeriod({
      supabase,
      employeeId: userId,
      companyId,
      year,
      month: m,
    });

    return noCache(Response.json({ timesheet: result }, { status: 200, headers: corsHeaders }));
  } catch (e: unknown) {
    return noCache(Response.json(
      { error: messageFromUnknown(e, 'Falha ao gerar espelho') },
      { status: 500, headers: corsHeaders },
    ));
  }
}

export default { fetch: handler };
