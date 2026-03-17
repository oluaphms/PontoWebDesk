/**
 * POST /api/rep/punch
 * Recebe marcação de ponto de relógio REP (ou sistema externo).
 * Payload: { pis?, matricula?, data_hora, nsr?, device_id?, company_id }
 * Autenticação: Bearer API_KEY ou header X-REP-API-Key
 */

import { createClient } from '@supabase/supabase-js';
import { ingestPunch } from '../../modules/rep-integration/repService';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-REP-API-Key',
};

interface RepPunchBody {
  pis?: string;
  cpf?: string;
  matricula?: string;
  data_hora: string;
  tipo_marcacao?: string;
  nsr?: number;
  device_id?: string;
  company_id: string;
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  }

  const apiKey = (process.env.API_KEY || process.env.REP_API_KEY || '').trim();
  const authHeader = request.headers.get('Authorization') || request.headers.get('X-REP-API-Key') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!apiKey || token !== apiKey) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').toString().trim().replace(/\/$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceKey) {
    return Response.json({ error: 'Supabase não configurado' }, { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  let body: RepPunchBody;
  try {
    const raw = await request.json();
    body = (raw && typeof raw === 'object' ? raw : {}) as RepPunchBody;
  } catch {
    return Response.json({ error: 'Body inválido' }, { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const { company_id, data_hora, device_id, nsr, pis, cpf, matricula, tipo_marcacao } = body;
  if (!company_id || !data_hora) {
    return Response.json(
      { error: 'company_id e data_hora são obrigatórios' },
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const ts = new Date(data_hora);
  if (Number.isNaN(ts.getTime())) {
    return Response.json({ error: 'data_hora inválido' }, { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const result = await ingestPunch(supabase, {
    company_id,
    rep_device_id: device_id || null,
    pis: pis ?? null,
    cpf: cpf ?? null,
    matricula: matricula ?? null,
    nome_funcionario: null,
    data_hora: ts.toISOString(),
    tipo_marcacao: tipo_marcacao || 'E',
    nsr: nsr ?? null,
    raw_data: { source: 'api' },
  });

  if (!result.success && result.error) {
    const status = result.error.includes('já importado') ? 200 : 400;
    return Response.json(
      { success: false, error: result.error, duplicate: result.error.includes('já importado') },
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return Response.json(
    {
      success: true,
      time_record_id: result.time_record_id,
      user_not_found: result.user_not_found,
    },
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
