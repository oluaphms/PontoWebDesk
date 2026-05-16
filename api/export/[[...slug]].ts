/**
 * GET /api/export / /api/export/afd / /api/export/aej
 * Exportação AFD (TXT) ou AEJ (JSON) — Portaria 671. Uma única função serverless (limite Hobby Vercel).
 * Query: company_id (opcional), type=afd|aej se usar só /api/export
 */

import { resolveRequestUrl } from '../_shared/getRequestBaseUrl.js';
import { getSupabaseUrlForServer } from '../_shared/getSupabaseConfig.js';
import { getSecureCorsHeaders } from '../_shared/security.js';
import { noCache } from '../_shared/cache.js';

function formatAfdLine(
  record: { nsr: number; timestamp?: string; created_at: string; user_id: string; type: string },
  cpf: string
): string {
  const ts = record.timestamp || record.created_at;
  const d = ts ? new Date(ts) : new Date();
  const data = d.toISOString().slice(0, 10).replace(/-/g, '');
  const hora = d.toTimeString().slice(0, 8).replace(/:/g, '');
  const cpfNorm = (cpf || '').replace(/\D/g, '').padStart(11, '0').slice(0, 11);
  const tipo = (record.type || 'E').slice(0, 1).toUpperCase();
  return `${String(record.nsr).padStart(9, '0')}\t${data}\t${hora}\t${cpfNorm}\t${tipo}`;
}

function resolveExportKind(request: Request): 'afd' | 'aej' | null {
  const url = resolveRequestUrl(request);
  const pathname = url.pathname.replace(/\/+$/, '');
  const parts = pathname.split('/').filter(Boolean);
  const exportIdx = parts.indexOf('export');
  const afterExport = exportIdx >= 0 ? parts.slice(exportIdx + 1) : [];
  const slug = afterExport[afterExport.length - 1];
  if (slug === 'afd' || slug === 'aej') return slug;
  const q = url.searchParams.get('type')?.toLowerCase();
  if (q === 'afd' || q === 'aej') return q;
  if (!slug || afterExport.length === 0) return 'afd';
  return null;
}

async function handleExport(request: Request, kind: 'afd' | 'aej'): Promise<Response> {
  const corsHeaders = getSecureCorsHeaders(request, {
    allowMethods: 'GET, OPTIONS',
    allowHeaders: 'Content-Type, Authorization',
  });
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return noCache(Response.json(
      { error: 'Authorization Bearer obrigatório' },
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    ));
  }

  const supabaseUrl = getSupabaseUrlForServer();
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!anonKey || !supabaseUrl) {
    return noCache(Response.json(
      { error: 'Supabase não configurado' },
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    ));
  }

  const { createClient } = await import('@supabase/supabase-js');
  const sup = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data: { user } } = await sup.auth.getUser(token);
  if (!user) {
    return noCache(Response.json(
      { error: 'Token inválido ou expirado' },
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    ));
  }

  const url = resolveRequestUrl(request);
  const companyIdParam = url.searchParams.get('company_id');

  let targetCompanyId = companyIdParam;
  if (!targetCompanyId) {
    const { data: profile } = await sup.from('users').select('company_id').eq('id', user.id).single();
    targetCompanyId = (profile as { company_id?: string } | null)?.company_id ?? null;
  }
  if (!targetCompanyId) {
    return noCache(Response.json(
      { error: 'Empresa não identificada' },
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    ));
  }

  const { data: records } = await sup
    .from('time_records')
    .select('id, nsr, timestamp, created_at, user_id, type')
    .eq('company_id', targetCompanyId)
    .not('nsr', 'is', null)
    .order('nsr', { ascending: true });

  const { data: users } = await sup
    .from('users')
    .select('id, cpf')
    .eq('company_id', targetCompanyId);

  const cpfByUserId: Record<string, string> = {};
  (users || []).forEach((u: { id: string; cpf?: string | null }) => {
    cpfByUserId[u.id] = u.cpf || '';
  });

  const list = (records || []) as Array<{
    nsr: number;
    timestamp?: string;
    created_at: string;
    user_id: string;
    type: string;
  }>;

  if (kind === 'afd') {
    const header = 'NSR\tDATA\tHORA\tCPF\tTIPO';
    const lines = list.map((r) => formatAfdLine(r, cpfByUserId[r.user_id] || ''));
    const body = [header, ...lines].join('\r\n');
    return noCache(new Response(body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="AFD_${targetCompanyId}_${new Date().toISOString().slice(0, 10)}.txt"`,
      },
    }));
  }

  const sorted = [...list].filter((r) => r.nsr != null).sort((a, b) => (a.nsr ?? 0) - (b.nsr ?? 0));
  const registros = sorted.map((r) => {
    const ts = r.timestamp || r.created_at;
    const d = ts ? new Date(ts) : new Date();
    const data = d.toISOString().slice(0, 10);
    const hora = d.toTimeString().slice(0, 8);
    const cpf = (cpfByUserId[r.user_id] || '').replace(/\D/g, '');
    return {
      nsr: r.nsr,
      data,
      hora,
      cpf,
      tipo: r.type || 'E',
      user_id: r.user_id,
    };
  });

  const jsonBody = {
    versao: '1.0',
    geradoEm: new Date().toISOString(),
    empresa_id: targetCompanyId,
    resumo: {
      totalHorasTrabalhadas: 0,
      totalHorasExtras: 0,
      totalFaltas: 0,
      observacao:
        'Totais de horas trabalhadas, extras e faltas não são calculados automaticamente neste export. Use relatórios de jornada e espelho de ponto no sistema para conferência.',
    },
    registros,
  };

  return noCache(new Response(JSON.stringify(jsonBody, null, 2), {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="AEJ_${targetCompanyId}_${new Date().toISOString().slice(0, 10)}.json"`,
    },
  }));
}

async function handler(request: Request): Promise<Response> {
  const corsHeaders = getSecureCorsHeaders(request, {
    allowMethods: 'GET, OPTIONS',
    allowHeaders: 'Content-Type, Authorization',
  });
  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers: corsHeaders }));
  }
  if (request.method !== 'GET') {
    return noCache(Response.json(
      { error: 'Method not allowed' },
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    ));
  }

  const kind = resolveExportKind(request);
  if (!kind) {
    return noCache(Response.json(
      { error: 'Use /api/export/afd, /api/export/aej ou ?type=afd|aej' },
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    ));
  }

  try {
    return await handleExport(request, kind);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro ao exportar';
    return noCache(Response.json(
      { error: msg },
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    ));
  }
}

export default { fetch: handler };
