/**
 * POST /api/create-employee-auth
 * Body: { email: string, password: string, metadata?: object }
 * Header: Authorization: Bearer <jwt do admin>
 *
 * Cria um usuário no Supabase Auth via service_role sem trocar a sessão do admin no client.
 * Também marca email_confirm=true para permitir login imediato.
 *
 * Variáveis de ambiente (Vercel): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e
 * SUPABASE_ANON_KEY (ou VITE_SUPABASE_ANON_KEY) para validar o JWT do admin.
 */

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/** Mapeia erros do GoTrue/Supabase Auth para mensagem e código amigáveis (nunca silencioso). */
function mapAuthErrorToFriendly(
  rawMessage: string,
  rawCode: string,
  status: number
): { message: string; code: string } {
  const lower = (rawMessage || '').toLowerCase();
  const codeLower = (rawCode || '').toLowerCase();

  if (status === 422 || /already registered|already exists|user already|duplicate|email.*taken|already_registered|user_already_exists/i.test(lower) || /already_registered|user_already_exists|duplicate/i.test(codeLower)) {
    return { message: 'E-mail já cadastrado.', code: 'USER_ALREADY_EXISTS' };
  }
  if (status === 403 || /forbidden|permission|access denied/i.test(lower) || /forbidden|access_denied/i.test(codeLower)) {
    return { message: 'Erro de permissão. Verifique se a chave de serviço tem permissão para criar usuários.', code: 'FORBIDDEN' };
  }
  if (status === 429 || /rate limit|too many requests|429/i.test(lower)) {
    return { message: 'Limite de requisições atingido. Aguarde alguns minutos e tente novamente.', code: 'RATE_LIMIT' };
  }
  if (/password|senha|invalid password|weak password|min.*character/i.test(lower) || /invalid_password|weak_password/i.test(codeLower)) {
    return { message: 'Senha inválida (mínimo 6 caracteres, conforme política do projeto).', code: 'INVALID_PASSWORD' };
  }
  if (/invalid email|email.*invalid|malformed/i.test(lower) || /invalid_email/i.test(codeLower)) {
    return { message: 'E-mail inválido.', code: 'INVALID_EMAIL' };
  }
  if (rawMessage && rawMessage.trim()) {
    return { message: rawMessage.trim(), code: rawCode && rawCode.trim() ? rawCode : 'CREATE_FAILED' };
  }
  return { message: 'Falha ao criar usuário no Auth.', code: 'CREATE_FAILED' };
}

/**
 * Implementação principal em cima do objeto Web `Request`.
 * Em Vercel (Node) usamos um adaptador abaixo para converter (req, res) → Request → Response.
 */
async function handleRequest(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return Response.json(
      { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' },
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const serviceKey =
    (typeof process.env.SUPABASE_SERVICE_ROLE_KEY === 'string' ? process.env.SUPABASE_SERVICE_ROLE_KEY : '').trim();
  const supabaseUrl = (typeof process.env.SUPABASE_URL === 'string'
    ? process.env.SUPABASE_URL
    : (process.env.VITE_SUPABASE_URL as string) || ''
  )
    .toString()
    .trim()
    .replace(/\/$/, '');
  const anonKey =
    (typeof process.env.SUPABASE_ANON_KEY === 'string'
      ? process.env.SUPABASE_ANON_KEY
      : (process.env.VITE_SUPABASE_ANON_KEY as string) || ''
    ).trim();

  if (!serviceKey || !supabaseUrl) {
    return Response.json(
      { error: 'Configuração indisponível.', code: 'CONFIG_MISSING' },
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const authHeader =
    // Web Fetch API
    (request.headers as any).get?.('authorization') ||
    (request.headers as any).get?.('Authorization') ||
    // Node/Vercel (IncomingHttpHeaders)
    (request.headers as any)['authorization'] ||
    (request.headers as any)['Authorization'] ||
    '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return Response.json(
      { error: 'Token de autenticação obrigatório.', code: 'UNAUTHORIZED' },
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  let body: { email?: string; password?: string; metadata?: any } = {};
  try {
    const raw = await request.json();
    body = (raw && typeof raw === 'object' ? raw : {}) as typeof body;
  } catch {
    return Response.json(
      { error: 'Body inválido.', code: 'BAD_REQUEST' },
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined;

  if (!email || !email.includes('@')) {
    return Response.json(
      { error: 'E-mail é obrigatório.', code: 'BAD_REQUEST' },
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
  if (!password || password.trim().length < 6) {
    return Response.json(
      { error: 'Senha inválida (mínimo 6 caracteres).', code: 'BAD_REQUEST' },
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const adminSup = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verificar se o caller é admin ou hr (validar JWT via Auth REST e depois role em public.users)
    let callerRole: string | null = null;
    if (anonKey) {
      const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${jwt}`, apikey: anonKey },
      });
      if (authRes.ok) {
        const authUser = await authRes.json();
        const callerId = authUser?.id;
        if (callerId) {
          try {
            const byId = await adminSup.from('users').select('role').eq('id', callerId).maybeSingle();
            if (byId?.data?.role) {
              callerRole = String(byId.data.role).toLowerCase();
            } else {
              const byAuthId = await adminSup.from('users').select('role').eq('auth_user_id', callerId).maybeSingle();
              if (byAuthId?.data?.role) callerRole = String(byAuthId.data.role).toLowerCase();
            }
          } catch {
            // ignora falha na coluna auth_user_id ou RLS
          }
        }
      }
    }
    if (callerRole !== 'admin' && callerRole !== 'hr') {
      return Response.json(
        { error: 'Apenas administrador ou RH pode cadastrar funcionário.', code: 'FORBIDDEN' },
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Criar usuário no Auth via API REST do GoTrue (evita problemas com auth.admin no serverless)
    const authApiUrl = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/users`;
    const createRes = await fetch(authApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        ...(metadata && Object.keys(metadata).length > 0 ? { user_metadata: metadata } : {}),
      }),
    });

    const createBody = await createRes.json().catch(() => ({}));
    if (!createRes.ok) {
      const rawMsg =
        createBody?.msg ?? createBody?.error_description ?? createBody?.message ?? createBody?.error;
      const errStr = typeof rawMsg === 'string' ? rawMsg : '';
      const code = createBody?.code ?? createBody?.error_code ?? '';
      const { message: friendlyMessage, code: friendlyCode } = mapAuthErrorToFriendly(errStr, code, createRes.status);

      // Se usuário já existe: tentar obter ID existente e retornar sucesso para não travar importação
      const isAlreadyRegistered =
        createRes.status === 422 ||
        /already registered|already exists|user already|duplicate|email.*taken/i.test(errStr) ||
        /already_registered|user_already_exists|duplicate/i.test(String(code));
      if (isAlreadyRegistered) {
        try {
          const listUrl = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/users?per_page=1000`;
          const listRes = await fetch(listUrl, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              apikey: serviceKey,
            },
          });
          const listBody = await listRes.json().catch(() => ({}));
          const users = listBody?.users ?? [];
          const existing = Array.isArray(users)
            ? users.find((u: any) => (String(u?.email ?? '').toLowerCase() === email))
            : null;
          if (existing?.id) {
            return Response.json(
              { success: true, userId: existing.id, existing: true },
              { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
          }
        } catch {
          // mantém resposta de erro abaixo
        }
      }

      return Response.json(
        { error: friendlyMessage, code: friendlyCode },
        { status: createRes.status >= 500 ? 500 : 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const userId = createBody?.id ?? createBody?.user?.id;
    if (!userId) {
      return Response.json(
        { error: 'Conta criada mas ID não retornado.', code: 'NO_ID' },
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return Response.json(
      { success: true, userId },
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e: any) {
    const errMsg = e?.message || String(e) || 'Erro interno.';
    return Response.json(
      { error: errMsg, code: 'INTERNAL_ERROR' },
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Adaptador para Vercel / Next.js (req, res).
 * Converte o `req` Node em um `Request` Web, chama `handleRequest` e traduz o `Response` de volta.
 */
export default async function handler(req: any, res: any) {
  try {
    const url = req.url?.startsWith('http')
      ? req.url
      : `https://${req.headers.host || 'localhost'}${req.url || ''}`;

    const init: RequestInit = {
      method: req.method,
      headers: req.headers as any,
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (typeof req.body === 'string' || req.body instanceof Uint8Array) {
        (init as any).body = req.body;
      } else if (req.body) {
        (init as any).body = JSON.stringify(req.body);
      }
    }

    const request = new Request(url, init);
    const response = await handleRequest(request);

    // Copiar status e headers
    res.status(response.status);
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    const text = await response.text();
    res.send(text);
  } catch (e: any) {
    console.error('create-employee-auth handler error', e);
    res
      .status(500)
      .setHeader('Content-Type', 'application/json')
      .send(JSON.stringify({ error: e?.message || 'Erro interno.', code: 'INTERNAL_ERROR' }));
  }
}
