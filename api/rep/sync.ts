/**
 * POST /api/rep/sync
 * Dispara sincronização de todos os relógios REP ativos (ou da company_id informada).
 * Uso: cron a cada 5 minutos. Autenticação: Bearer API_KEY ou CRON_SECRET
 */

import { createClient } from '@supabase/supabase-js';
import { syncRepDevices } from '../../modules/rep-integration/repSyncJob';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  }

  const apiKey = (process.env.API_KEY || process.env.CRON_SECRET || '').trim();
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!apiKey || token !== apiKey) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').toString().trim().replace(/\/$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceKey) {
    return Response.json({ error: 'Supabase não configurado' }, { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const urlObj = new URL(request.url);
  const companyId = urlObj.searchParams.get('company_id') || undefined;

  const result = await syncRepDevices(supabase, companyId);

  return Response.json(
    {
      success: result.errors.length === 0,
      total_devices: result.total,
      imported: result.imported,
      errors: result.errors,
    },
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
