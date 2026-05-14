/**
 * Diagnóstico RPC `rep_ingest_punch` (payload de teste).
 * Expõe-se via `rep-bridge` slug `diagnostic-supabase` + rewrite `/api/test-supabase` — não é função própria (limite Hobby).
 */

import { createClient } from '@supabase/supabase-js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function handleRepTestSupabaseRpc(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-REP-API-Key',
      },
    });
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: JSON_HEADERS });
  }

  const apiKey = (process.env.API_KEY || process.env.REP_API_KEY || '').trim();
  const authHeader = request.headers.get('Authorization') || request.headers.get('X-REP-API-Key') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!apiKey || token !== apiKey) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: JSON_HEADERS });
  }

  const supabaseUrlRaw = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').toString().trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').toString().trim();
  const supabaseUrl = supabaseUrlRaw.replace(/\/$/, '');

  if (!supabaseUrl || !serviceKey) {
    return Response.json(
      {
        error: 'ENV_MISSING',
        detail: {
          SUPABASE_SERVICE_ROLE_KEY: Boolean(serviceKey),
          hasSupabaseUrl: Boolean((process.env.SUPABASE_URL || '').toString().trim()),
          hasViteSupabaseUrl: Boolean((process.env.VITE_SUPABASE_URL || '').toString().trim()),
        },
      },
      { status: 500, headers: JSON_HEADERS },
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const testPayload = {
    p_company_id: '00000000-0000-0000-0000-000000000001',
    p_rep_device_id: null,
    p_pis: null,
    p_cpf: null,
    p_matricula: null,
    p_nome_funcionario: null,
    p_data_hora: new Date().toISOString(),
    p_tipo_marcacao: 'E',
    p_nsr: null,
    p_raw_data: { source: 'api', ingest: 'test-supabase' },
    p_only_staging: true,
    p_apply_schedule: false,
    p_force_user_id: null,
    p_trust_client_identity: false,
  };

  try {
    const { data, error } = await supabase.rpc('rep_ingest_punch', testPayload);
    return Response.json(
      { data, error },
      {
        status: 200,
        headers: {
          ...JSON_HEADERS,
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    return Response.json(
      { error: message, stack },
      {
        status: 500,
        headers: {
          ...JSON_HEADERS,
          'Cache-Control': 'no-store',
        },
      },
    );
  }
}
