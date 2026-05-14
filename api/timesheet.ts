import { createClient } from '@supabase/supabase-js';
import { buildTimesheetForPeriod } from '../src/engine/timeEngine';
import { messageFromUnknown } from '../src/utils/messageFromUnknown';
import { getSecureCorsHeaders, checkRateLimit, getClientIP, extractBearerToken, secureCompare } from './_shared/security.js';
import { resolveRequestUrl } from './_shared/getRequestBaseUrl.js';

const ALLOWED_METHODS = 'GET, OPTIONS';

export default async function handler(request: Request): Promise<Response> {
  const corsHeaders = getSecureCorsHeaders(request, {
    allowMethods: ALLOWED_METHODS,
    allowHeaders: 'Content-Type, Authorization',
  });

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  }

  // Rate limiting por IP
  const clientIP = getClientIP(request);
  const rateLimit = checkRateLimit(clientIP, 'api');
  if (!rateLimit.allowed) {
    return Response.json(
      { error: 'Rate limit exceeded. Try again later.', retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000) },
      { status: 429, headers: corsHeaders }
    );
  }

  const apiKey = (process.env.API_KEY || '').trim();
  if (!apiKey) {
    return Response.json({ error: 'API_KEY não configurada.' }, { status: 500, headers: corsHeaders });
  }

  const token = extractBearerToken(request);
  if (!token || !secureCompare(token, apiKey)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').toString().trim().replace(/\/$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceKey) {
    return Response.json({ error: 'Configuração Supabase ausente.' }, { status: 500, headers: corsHeaders });
  }

  const searchParams = resolveRequestUrl(request).searchParams;
  const userId = searchParams.get('userId');
  const month = searchParams.get('month'); // formato YYYY-MM
  const companyId = searchParams.get('companyId') || undefined;

  if (!userId || !month) {
    return Response.json({ error: 'userId e month (YYYY-MM) são obrigatórios.' }, { status: 400, headers: corsHeaders });
  }

  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const m = Number(monthStr);
  if (!year || !m || m < 1 || m > 12) {
    return Response.json({ error: 'Parâmetro month inválido. Use YYYY-MM.' }, { status: 400, headers: corsHeaders });
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

    return Response.json({ timesheet: result }, { status: 200, headers: corsHeaders });
  } catch (e: unknown) {
    return Response.json(
      { error: messageFromUnknown(e, 'Falha ao gerar espelho') },
      { status: 500, headers: corsHeaders },
    );
  }
}

