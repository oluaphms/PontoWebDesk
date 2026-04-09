/**
 * GET /api/export/aej
 * Exporta AEJ (Arquivo Eletrônico de Jornada) em JSON — Portaria 671 (resumo informativo).
 * Header: Authorization: Bearer <Supabase JWT>
 * Query: company_id (opcional)
 *
 * Observação: totais de horas trabalhadas/extras/faltas não são calculados automaticamente aqui;
 * use os relatórios de jornada do sistema para conferência detalhada.
 */

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'GET') {
    return Response.json(
      { error: 'Method not allowed' },
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return Response.json(
      { error: 'Authorization Bearer obrigatório' },
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').toString().trim().replace(/\/$/, '');
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!anonKey || !supabaseUrl) {
    return Response.json(
      { error: 'Supabase não configurado' },
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sup = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: { user } } = await sup.auth.getUser(token);
    if (!user) {
      return Response.json(
        { error: 'Token inválido ou expirado' },
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const url = new URL(request.url);
    const companyIdParam = url.searchParams.get('company_id');

    let targetCompanyId = companyIdParam;
    if (!targetCompanyId) {
      const { data: profile } = await sup.from('users').select('company_id').eq('id', user.id).single();
      targetCompanyId = (profile as { company_id?: string } | null)?.company_id ?? null;
    }
    if (!targetCompanyId) {
      return Response.json(
        { error: 'Empresa não identificada' },
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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

    const body = {
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

    const json = JSON.stringify(body, null, 2);

    return new Response(json, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="AEJ_${targetCompanyId}_${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro ao gerar AEJ';
    return Response.json(
      { error: msg },
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}
