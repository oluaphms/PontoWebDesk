/**
 * POST /api/rep/import-afd
 * Upload de arquivo AFD/TXT/CSV para importação de marcações REP.
 * Body: multipart/form-data com campo "file" e "company_id", opcional "rep_device_id"
 * Ou JSON com { company_id, content (base64 ou texto), filename }
 * Autenticação: Bearer JWT (Supabase) do usuário admin/hr
 */

import { createClient } from '@supabase/supabase-js';
import { parseAFD, parseTxtOrCsv } from '../../modules/rep-integration/repParser';
import { ingestAfdRecords } from '../../modules/rep-integration/repService';

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

  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return Response.json({ error: 'Authorization obrigatório' }, { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').toString().trim().replace(/\/$/, '');
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !anonKey) {
    return Response.json({ error: 'Supabase não configurado' }, { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data: { user } } = await sup.auth.getUser(token);
  if (!user) {
    return Response.json({ error: 'Token inválido ou expirado' }, { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const contentType = request.headers.get('Content-Type') || '';
  let companyId: string;
  let repDeviceId: string | null = null;
  let fileContent: string;

  if (contentType.includes('application/json')) {
    const body = await request.json() as { company_id: string; rep_device_id?: string; content?: string; filename?: string };
    companyId = body.company_id;
    repDeviceId = body.rep_device_id || null;
    if (!companyId) {
      return Response.json({ error: 'company_id obrigatório' }, { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (body.content) {
      try {
        fileContent = typeof body.content === 'string' && body.content.includes(',') && body.content.length > 100
          ? atob(body.content)
          : body.content;
      } catch {
        fileContent = body.content as string;
      }
    } else {
      return Response.json({ error: 'content obrigatório no body JSON' }, { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } else if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    companyId = (formData.get('company_id') as string) || '';
    repDeviceId = (formData.get('rep_device_id') as string) || null;
    const file = formData.get('file') as File | null;
    if (!companyId || !file) {
      return Response.json({ error: 'company_id e file obrigatórios' }, { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    fileContent = await file.text();
  } else {
    return Response.json({ error: 'Content-Type deve ser application/json ou multipart/form-data' }, { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const { data: profile } = await supabase.from('users').select('company_id, role').eq('id', user.id).single();
  const userCompanyId = (profile as { company_id?: string; role?: string } | null)?.company_id;
  const role = (profile as { role?: string } | null)?.role;
  if (role !== 'admin' && role !== 'hr') {
    return Response.json({ error: 'Sem permissão para importar AFD' }, { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  if (userCompanyId && companyId !== userCompanyId) {
    return Response.json({ error: 'company_id não autorizado' }, { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const isCsv = fileContent.includes(',') && fileContent.split('\n')[0].includes(',');
  const records = isCsv ? parseTxtOrCsv(fileContent, ',') : parseAFD(fileContent);
  if (records.length === 0) {
    return Response.json({ error: 'Nenhum registro válido encontrado no arquivo' }, { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const supabaseAdmin = serviceKey
    ? createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    : supabase;

  const result = await ingestAfdRecords(supabaseAdmin, companyId, repDeviceId, records);

  return Response.json(
    {
      success: true,
      total: records.length,
      imported: result.imported,
      duplicated: result.duplicated,
      user_not_found: result.userNotFound,
      errors: result.errors.slice(0, 10),
    },
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
