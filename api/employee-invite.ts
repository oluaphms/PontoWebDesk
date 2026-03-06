/**
 * GET /api/employee-invite?token=xxx
 * Retorna email, role, expiresAt se o token for válido e não expirado/não usado.
 * Usar com Vercel Edge ou adaptar para seu runtime (Node/serverless).
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
      { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' },
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const serviceKey = (typeof process.env.SUPABASE_SERVICE_ROLE_KEY === 'string' ? process.env.SUPABASE_SERVICE_ROLE_KEY : '').trim();
  const supabaseUrl = (typeof process.env.SUPABASE_URL === 'string' ? process.env.SUPABASE_URL : process.env.VITE_SUPABASE_URL as string || '').toString().trim().replace(/\/$/, '');

  if (!serviceKey || !supabaseUrl) {
    return Response.json(
      { error: 'Configuração indisponível.', code: 'CONFIG_MISSING' },
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token')?.trim();
  if (!token) {
    return Response.json(
      { error: 'Token obrigatório', code: 'BAD_REQUEST' },
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const adminSup = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await adminSup
      .from('employee_invites')
      .select('email, role, expires_at, used_at')
      .eq('token', token)
      .maybeSingle();

    if (error) {
      console.error('[employee-invite]', error);
      return Response.json(
        { error: 'Erro ao consultar convite', code: 'DB_ERROR' },
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!data) {
      return Response.json(
        { error: 'Link inválido ou expirado', code: 'INVALID_TOKEN' },
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (data.used_at) {
      return Response.json(
        { error: 'Este convite já foi utilizado', code: 'ALREADY_USED' },
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
    if (Date.now() > expiresAt) {
      return Response.json(
        { error: 'Este link expirou', code: 'EXPIRED' },
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return Response.json(
      { email: data.email, role: data.role, expiresAt: data.expires_at },
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[employee-invite]', msg);
    return Response.json(
      { error: 'Erro interno', code: 'INTERNAL_ERROR' },
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}
