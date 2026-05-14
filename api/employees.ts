import { createClient } from '@supabase/supabase-js';
import { getSecureCorsHeaders, checkRateLimit, getClientIP, extractBearerToken, secureCompare } from './_shared/security.js';
import { resolveRequestUrl } from './_shared/getRequestBaseUrl.js';
import { getSupabaseConfig } from './_shared/getSupabaseConfig.js';

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

  let url: string;
  let serviceKey: string;
  try {
    ({ url, serviceKey } = getSupabaseConfig());
  } catch {
    return Response.json({ error: 'Configuração Supabase ausente.' }, { status: 500, headers: corsHeaders });
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const searchParams = resolveRequestUrl(request).searchParams;
  const companyId = searchParams.get('companyId')?.trim() || '';
  if (!companyId) {
    return Response.json(
      { error: 'companyId é obrigatório (isolamento por tenant).', code: 'COMPANY_ID_REQUIRED' },
      { status: 400, headers: corsHeaders }
    );
  }
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
  const offset = (page - 1) * limit;

  // Get total count for pagination metadata
  const countQuery = supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'employee')
    .eq('company_id', companyId);

  const { count, error: countError } = await countQuery;
  if (countError) {
    return Response.json({ error: countError.message }, { status: 500, headers: corsHeaders });
  }

  // Get paginated data
  const query = supabase
    .from('users')
    .select('id, nome, email, cpf, department_id, schedule_id, estrutura_id, status, company_id')
    .eq('role', 'employee')
    .eq('company_id', companyId)
    .order('nome', { ascending: true })
    .range(offset, offset + limit - 1);

  const { data, error } = await query;
  if (error) {
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }

  const totalPages = Math.ceil((count || 0) / limit);
  return Response.json(
    {
      employees: data ?? [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    },
    { status: 200, headers: corsHeaders }
  );
}

