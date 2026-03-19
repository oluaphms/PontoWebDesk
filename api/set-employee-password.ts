/**
 * POST /api/set-employee-password
 * Body: { email: string, newPassword: string }
 * Header: Authorization: Bearer <jwt do admin>
 *
 * Define ou altera a senha de um funcionário no Supabase Auth (por e-mail).
 * Permite ao admin ativar acesso de importados (senha provisória 123456) ou redefinir senha.
 *
 * Variáveis de ambiente (Vercel): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e
 * SUPABASE_ANON_KEY (ou VITE_SUPABASE_ANON_KEY) para validar o JWT do admin.
 */

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
    return Response.json(
      { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' },
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const serviceKey = (typeof process.env.SUPABASE_SERVICE_ROLE_KEY === 'string' ? process.env.SUPABASE_SERVICE_ROLE_KEY : '').trim();
  const supabaseUrl = (typeof process.env.SUPABASE_URL === 'string' ? process.env.SUPABASE_URL : (process.env.VITE_SUPABASE_URL as string) || '').toString().trim().replace(/\/$/, '');
  const anonKey = (typeof process.env.SUPABASE_ANON_KEY === 'string' ? process.env.SUPABASE_ANON_KEY : (process.env.VITE_SUPABASE_ANON_KEY as string) || '').trim();

  if (!serviceKey || !supabaseUrl) {
    return Response.json(
      { error: 'Configuração indisponível.', code: 'CONFIG_MISSING' },
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return Response.json(
      { error: 'Token de autenticação obrigatório.', code: 'UNAUTHORIZED' },
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  let body: { email?: string; newPassword?: string } = {};
  try {
    const raw = await request.json();
    body = (raw && typeof raw === 'object' ? raw : {}) as typeof body;
  } catch {
    return Response.json(
      { error: 'Body inválido.', code: 'BAD_REQUEST' },
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (!email || !email.includes('@')) {
    return Response.json(
      { error: 'E-mail é obrigatório.', code: 'BAD_REQUEST' },
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  if (!newPassword || newPassword.length < 6) {
    return Response.json(
      { error: 'Senha deve ter no mínimo 6 caracteres.', code: 'BAD_REQUEST' },
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const adminSup = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let callerRole: string | null = null;
    if (anonKey) {
      const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${jwt}`, apikey: anonKey },
      });
      if (authRes.ok) {
        const authUser = await authRes.json();
        const callerId = authUser?.id;
        if (callerId) {
          const { data: row } = await adminSup.from('users').select('role').eq('id', callerId).maybeSingle();
          if (row?.role) {
            callerRole = String(row.role).toLowerCase();
          } else {
            const { data: byAuthRow } = await adminSup.from('users').select('role').eq('auth_user_id', callerId).maybeSingle();
            if (byAuthRow?.role) callerRole = String(byAuthRow.role).toLowerCase();
          }
        }
      }
    }
    if (callerRole !== 'admin' && callerRole !== 'hr') {
      return Response.json(
        { error: 'Apenas administrador ou RH pode alterar senha de funcionário.', code: 'FORBIDDEN' },
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const adminAuth = (adminSup.auth as any).admin;
    const { data: list } = await adminAuth.listUsers({ perPage: 1000 });
    const target = list?.users?.find((u: any) => String(u.email || '').toLowerCase() === email);
    if (!target?.id) {
      return Response.json(
        { error: 'Usuário não encontrado no Auth com este e-mail. Crie o acesso em Cadastrar Funcionário ou use a importação.', code: 'USER_NOT_FOUND' },
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { error: updateErr } = await adminAuth.updateUserById(target.id, { password: newPassword });
    if (updateErr) {
      return Response.json(
        { error: updateErr.message || 'Falha ao alterar senha.', code: 'UPDATE_FAILED' },
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return Response.json(
      { success: true, message: 'Senha alterada. O funcionário pode fazer login com o e-mail e a nova senha.' },
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e: any) {
    return Response.json(
      { error: e?.message || 'Erro interno.', code: 'INTERNAL_ERROR' },
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}
