/**
 * Diagnóstico RPC `rep_ingest_punch` (payload de teste).
 * Expõe-se via `api/rep/[slug].ts` em `/api/rep/diagnostic-supabase` + rewrite `/api/test-supabase` (limite Hobby).
 */

import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig, getSupabaseUrlSource } from './getSupabaseConfig.js';
import { getSecureCorsHeaders, requireTrustedOrigin } from './security.js';
import { noCache } from './cache.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function handleRepTestSupabaseRpc(request: Request): Promise<Response> {
  const corsHeaders = getSecureCorsHeaders(request, {
    allowMethods: 'GET, POST, OPTIONS',
    allowHeaders: 'Content-Type, Authorization, X-REP-API-Key',
  });
  const jsonHeaders = { ...JSON_HEADERS, ...corsHeaders };
  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers: corsHeaders }));
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return noCache(Response.json({ error: 'Method not allowed' }, { status: 405, headers: jsonHeaders }));
  }
  if (request.method === 'POST') {
    const blockedOrigin = requireTrustedOrigin(request, corsHeaders);
    if (blockedOrigin) return blockedOrigin;
  }

  const apiKey = (process.env.API_KEY || process.env.REP_API_KEY || '').trim();
  const authHeader = request.headers.get('Authorization') || request.headers.get('X-REP-API-Key') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!apiKey || token !== apiKey) {
    return noCache(Response.json({ error: 'Unauthorized' }, { status: 401, headers: jsonHeaders }));
  }

  let supabaseUrl: string;
  let serviceKey: string;
  try {
    ({ url: supabaseUrl, serviceKey } = getSupabaseConfig());
  } catch (e) {
    if (e instanceof Error && e.message === 'SUPABASE_ENV_MISSING') {
      return noCache(
        Response.json(
          {
            error: 'ENV_MISSING',
            detail: {
              SUPABASE_SERVICE_ROLE_KEY: Boolean((process.env.SUPABASE_SERVICE_ROLE_KEY || '').toString().trim()),
              hasSupabaseUrl: Boolean((process.env.SUPABASE_URL || '').toString().trim()),
              hasURL_SUPABASE: Boolean((process.env.URL_SUPABASE || '').toString().trim()),
              hasViteSupabaseUrl: Boolean((process.env.VITE_SUPABASE_URL || '').toString().trim()),
            },
          },
          { status: 500, headers: jsonHeaders },
        ),
      );
    }
    throw e;
  }

  console.log('[REP DIAGNOSTIC SUPABASE ENV]', {
    using: getSupabaseUrlSource(),
    hasKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  });

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data, error } = await supabase.rpc('rep_ingest_punch', {
      p_company_id: 'test',
      p_data_hora: new Date().toISOString(),
      p_pis: null,
      p_nsr: null,
      p_tipo_marcacao: 'E',
      p_raw_data: {},
      p_only_staging: true,
    });
    return noCache(Response.json({ data, error }, { status: 200, headers: jsonHeaders }));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    return noCache(Response.json({ error: message, stack }, { status: 500, headers: jsonHeaders }));
  }
}
