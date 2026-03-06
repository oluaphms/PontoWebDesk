/**
 * POST /api/accept-employee-invite
 * Body: { token: string, name: string, password: string }
 * Valida convite, cria usuário em auth.users, insere em users, marca convite como usado.
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
  const supabaseUrl = (typeof process.env.SUPABASE_URL === 'string' ? process.env.SUPABASE_URL : process.env.VITE_SUPABASE_URL as string || '').toString().trim().replace(/\/$/, '');

  if (!serviceKey || !supabaseUrl) {
    return Response.json(
      { error: 'Configuração indisponível.', code: 'CONFIG_MISSING' },
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  let body: { token?: string; name?: string; password?: string } = {};
  try {
    const raw = await request.json();
    body = (raw && typeof raw === 'object' ? raw : {}) as typeof body;
  } catch {
    return Response.json(
      { error: 'Body inválido', code: 'BAD_REQUEST' },
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const password = typeof body.password === 'string' ? body.password.trim() : '';

  if (!token) {
    return Response.json(
      { error: 'Token é obrigatório', code: 'BAD_REQUEST' },
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  if (!name || name.length < 2) {
    return Response.json(
      { error: 'Nome completo é obrigatório', code: 'BAD_REQUEST' },
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  if (!password || password.length < 6) {
    return Response.json(
      { error: 'Senha deve ter no mínimo 6 caracteres', code: 'BAD_REQUEST' },
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const adminSup = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: invite, error: inviteError } = await adminSup
      .from('employee_invites')
      .select('id, email, role, expires_at, used_at, company_id')
      .eq('token', token)
      .maybeSingle();

    if (inviteError || !invite) {
      return Response.json(
        { error: 'Link inválido ou expirado', code: 'INVALID_TOKEN' },
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (invite.used_at) {
      return Response.json(
        { error: 'Este convite já foi utilizado', code: 'ALREADY_USED' },
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const expiresAt = invite.expires_at ? new Date(invite.expires_at).getTime() : 0;
    if (Date.now() > expiresAt) {
      return Response.json(
        { error: 'Este link expirou', code: 'EXPIRED' },
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const email = String(invite.email).trim().toLowerCase();
    const role = invite.role || 'employee';
    const companyId = invite.company_id || '';

    let authUserId: string | null = null;
    const { data: authData, error: authError } = await (adminSup.auth as any).admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      const msg = String(authError.message || '').toLowerCase();
      if (msg.includes('already') || msg.includes('registered')) {
        const { data: list } = await (adminSup.auth as any).admin.listUsers({ perPage: 1000 });
        const existing = list?.users?.find((u: any) => String(u.email || '').toLowerCase() === email);
        if (existing?.id) {
          const { error: updateErr } = await (adminSup.auth as any).admin.updateUserById(existing.id, { password });
          if (updateErr) {
            return Response.json(
              { error: 'Este e-mail já possui cadastro. Use "Esqueci minha senha" na tela de login.', code: 'EMAIL_EXISTS' },
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          authUserId = existing.id;
        }
        if (!authUserId) {
          return Response.json(
            { error: 'Este e-mail já possui cadastro. Use "Esqueci minha senha" na tela de login.', code: 'EMAIL_EXISTS' },
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } else {
        return Response.json(
          { error: authError.message || 'Erro ao criar conta', code: 'AUTH_ERROR' },
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      authUserId = authData?.user?.id ?? authData?.id ?? null;
    }

    if (!authUserId) {
      return Response.json(
        { error: 'Erro ao criar usuário', code: 'AUTH_ERROR' },
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { error: userInsertError } = await adminSup.from('users').insert({
      id: authUserId,
      nome: name,
      email,
      cargo: 'Colaborador',
      role,
      company_id: companyId,
      department_id: '',
      avatar: null,
      preferences: { notifications: true, theme: 'light', allowManualPunch: true, language: 'pt-BR' },
      created_at: new Date().toISOString(),
    });

    if (userInsertError) {
      const code = String((userInsertError as any)?.code || '');
      const msg = String((userInsertError as any)?.message || '').toLowerCase();
      if (code === '23505' || msg.includes('duplicate') || msg.includes('unique')) {
        await adminSup
          .from('users')
          .update({
            nome: name,
            role,
            preferences: { notifications: true, theme: 'light', allowManualPunch: true, language: 'pt-BR' },
            updated_at: new Date().toISOString(),
          })
          .eq('id', authUserId);
      } else {
        return Response.json(
          { error: userInsertError.message || 'Erro ao criar perfil', code: 'DB_ERROR' },
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    await adminSup
      .from('employee_invites')
      .update({ used_at: new Date().toISOString() })
      .eq('id', invite.id);

    return Response.json(
      { success: true, message: 'Conta criada. Faça login com seu e-mail e senha.' },
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[accept-employee-invite]', msg);
    return Response.json(
      { error: msg || 'Erro interno', code: 'INTERNAL_ERROR' },
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}
