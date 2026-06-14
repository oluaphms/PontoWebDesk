import { observabilityConsole } from '../../../src/shared/logger/observabilityConsole.js';
﻿/**
 * POST /api/auth-admin
 * Body: { action: 'confirm-email' | 'set-password' | 'create-user', email: string, ... }
 * Header: Authorization: Bearer <jwt do admin> (obrigatório para todas as ações)
 *
 * Uma única Serverless Function que unifica:
 * - confirm-email: { action: 'confirm-email', email } → marca email_confirm=true
 * - set-password:  { action: 'set-password', email, newPassword } → altera senha no Auth
 * - create-user:   { action: 'create-user', email, password, metadata? } → cria usuário no Auth
 *
 * Reduz o número de funções no plano Hobby da Vercel (máx. 12).
 */

import { getSupabaseUrlForServer } from '../getSupabaseConfig.js';
import { z } from 'zod';
import { noCache } from '../cache.js';
import { checkRateLimitDistributed, getClientIP, getSecureCorsHeaders, requireTrustedOrigin } from '../security.js';

observabilityConsole.log('[AUTH ADMIN LOADED]');

const FALLBACK_EMAIL_DOMAIN = 'pontowebdesk.local';
const AUTH_ADMIN_MIN_PASSWORD_LENGTH = 12;

/** Local — evita import de `src/` no bootstrap da função serverless. */
function messageFromUnknown(err: unknown, fallback = 'Erro.'): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return fallback;
}

function mapAuthErrorToFriendly(rawMessage: string, rawCode: string, status: number): { message: string; code: string } {
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
    return { message: `Senha inválida (mínimo ${AUTH_ADMIN_MIN_PASSWORD_LENGTH} caracteres, com letras, número e caractere especial).`, code: 'INVALID_PASSWORD' };
  }
  if (/invalid email|email.*invalid|malformed/i.test(lower) || /invalid_email/i.test(codeLower)) {
    return { message: 'E-mail inválido.', code: 'INVALID_EMAIL' };
  }
  if (rawMessage && rawMessage.trim()) {
    return { message: rawMessage.trim(), code: rawCode && rawCode.trim() ? rawCode : 'CREATE_FAILED' };
  }
  return { message: 'Falha ao criar usuário no Auth.', code: 'CREATE_FAILED' };
}

function normalizeEmail(email: string | undefined): string {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function generateSafeFallbackEmailBase(cpf: string, pis: string): string {
  const id = cpf || pis;
  const ts = Math.floor(Date.now() / 1000);
  return `${id}-${ts}`;
}

function generateFallbackPassword(): string {
  return `Pwd${Date.now().toString(36)}!${Math.random().toString(36).slice(2, 8)}`;
}

async function emailExistsInUsers(adminSup: any, email: string): Promise<boolean> {
  const { data, error } = await adminSup.from('users').select('id').eq('email', email).limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

function isValidDocument11Digits(doc: string): boolean {
  return /^\d{11}$/.test(doc);
}

type CallerAdminContext = {
  userId: string;
  role: string | null;
  companyId: string | null;
};

async function getCallerAdminContext(adminSup: any, callerId: string): Promise<CallerAdminContext> {
  const byId = await adminSup.from('users').select('role, company_id').eq('id', callerId).maybeSingle();
  const data = byId?.data ?? byId;
  if (data?.role) {
    return {
      userId: callerId,
      role: String(data.role).toLowerCase(),
      companyId: data.company_id ? String(data.company_id) : null,
    };
  }
  const byAuth = await adminSup.from('users').select('role, company_id').eq('auth_user_id', callerId).maybeSingle();
  const d = byAuth?.data ?? byAuth;
  return {
    userId: callerId,
    role: d?.role ? String(d.role).toLowerCase() : null,
    companyId: d?.company_id ? String(d.company_id) : null,
  };
}

async function assertTargetUserInCallerTenant(
  adminSup: any,
  targetUserId: string,
  callerCompanyId: string | null,
): Promise<{ ok: true } | { ok: false; response: Response; corsHeaders: Record<string, string> }> {
  if (!callerCompanyId || !targetUserId) {
    return {
      ok: false,
      response: Response.json(
        { error: 'Empresa do solicitante não identificada.', code: 'FORBIDDEN' },
        { status: 403 },
      ),
      corsHeaders: {},
    };
  }
  const { data: row, error } = await adminSup
    .from('users')
    .select('company_id')
    .eq('id', targetUserId)
    .maybeSingle();
  if (error || !row?.company_id) {
    return {
      ok: false,
      response: Response.json(
        { error: 'Usuário alvo não encontrado no tenant.', code: 'USER_NOT_FOUND' },
        { status: 404 },
      ),
      corsHeaders: {},
    };
  }
  if (String(row.company_id) !== String(callerCompanyId)) {
    return {
      ok: false,
      response: Response.json(
        { error: 'Operação não permitida para usuário de outra empresa.', code: 'CROSS_TENANT_FORBIDDEN' },
        { status: 403 },
      ),
      corsHeaders: {},
    };
  }
  return { ok: true };
}

const ConfirmEmailBodySchema = z.object({
  action: z.literal('confirm-email'),
  email: z.string().email(),
});

const SetPasswordBodySchema = z.object({
  action: z.literal('set-password'),
  email: z.string().email(),
  newPassword: z.string().min(AUTH_ADMIN_MIN_PASSWORD_LENGTH),
});

const CreateUserBodySchema = z.object({
  action: z.literal('create-user'),
  email: z.string().optional(),
  password: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const DeleteUserBodySchema = z.object({
  action: z.literal('delete-user'),
  userId: z.string().uuid().optional(),
  email: z.string().email().optional(),
});

const AuthAdminBodySchema = z.discriminatedUnion('action', [
  ConfirmEmailBodySchema,
  SetPasswordBodySchema,
  CreateUserBodySchema,
  DeleteUserBodySchema,
]);

function isDebugRequest(request: Request): boolean {
  const v = request.headers.get('x-debug') ?? request.headers.get('X-Debug');
  return String(v || '').toLowerCase() === 'true';
}

/** Resposta padrão: { success, error, detail? } + debug opcional. */
function authAdminResponse(
  status: number,
  corsHeaders: Record<string, string>,
  request: Request,
  payload: {
    success: boolean;
    error: string | null;
    detail?: string;
    [key: string]: unknown;
  },
  rawBodyForDebug?: Record<string, unknown>,
): Response {
  const out: Record<string, unknown> = {
    success: payload.success,
    error: payload.error,
  };
  if (payload.detail != null && String(payload.detail).trim()) {
    out.detail = payload.detail;
  }
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'success' || key === 'error' || key === 'detail') continue;
    out[key] = value;
  }
  if (isDebugRequest(request) && rawBodyForDebug) {
    out.debug = { receivedKeys: Object.keys(rawBodyForDebug) };
  }
  return noCache(
    Response.json(out, {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }),
  );
}

/** Formato B simplificado → create-user (Formato A). */
function normalizeIncomingPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = { ...raw };
  const name = body.name ?? body.nome;
  const cpf = body.cpf;
  const companyId = body.company_id;
  const hasSimplified = name != null || cpf != null || companyId != null;

  if (!body.action && hasSimplified) {
    body.action = 'create-user';
    const existingMeta =
      body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? { ...(body.metadata as Record<string, unknown>) }
        : {};
    body.metadata = {
      ...existingMeta,
      ...(name != null ? { nome: String(name).trim() } : {}),
      ...(cpf != null ? { cpf } : {}),
      ...(companyId != null ? { company_id: companyId } : {}),
    };
  }

  if (!body.action) {
    body.action = 'create-user';
  }

  return body;
}

async function handleRequest(request: Request): Promise<Response> {
  const corsHeaders = getSecureCorsHeaders(request, {
    allowMethods: 'POST, OPTIONS',
    allowHeaders: 'Content-Type, Authorization, x-debug',
  });
  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers: corsHeaders }));
  }
  if (request.method !== 'POST') {
    return authAdminResponse(405, corsHeaders, request, {
      success: false,
      error: 'METHOD_NOT_ALLOWED',
      detail: 'Method not allowed',
    });
  }
  const blockedOrigin = requireTrustedOrigin(request, corsHeaders);
  if (blockedOrigin) return blockedOrigin;

  const serviceKey = (typeof process.env.SUPABASE_SERVICE_ROLE_KEY === 'string' ? process.env.SUPABASE_SERVICE_ROLE_KEY : '').trim();
  const supabaseUrl = getSupabaseUrlForServer();
  const anonKey = (typeof process.env.SUPABASE_ANON_KEY === 'string' ? process.env.SUPABASE_ANON_KEY : (process.env.VITE_SUPABASE_ANON_KEY as string) || '').trim();

  if (!serviceKey) {
    observabilityConsole.error('SERVICE_ROLE_KEY_MISSING');
    return authAdminResponse(500, corsHeaders, request, {
      success: false,
      error: 'CONFIG_ERROR',
      detail: 'SUPABASE_SERVICE_ROLE_KEY não configurada',
    });
  }

  if (!supabaseUrl) {
    return authAdminResponse(500, corsHeaders, request, {
      success: false,
      error: 'CONFIG_MISSING',
      detail: 'Configuração indisponível.',
    });
  }

  let rawBody: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      rawBody = parsed as Record<string, unknown>;
    } else {
      return authAdminResponse(
        400,
        corsHeaders,
        request,
        {
          success: false,
          error: 'INVALID_JSON',
          detail: 'Body inválido ou malformado',
        },
        rawBody,
      );
    }
  } catch {
    return authAdminResponse(400, corsHeaders, request, {
      success: false,
      error: 'INVALID_JSON',
      detail: 'Body inválido ou malformado',
    });
  }

  if (Object.keys(rawBody).length === 0) {
    return authAdminResponse(400, corsHeaders, request, {
      success: false,
      error: 'MISSING_ACTION',
      detail: 'Informe action ou payload de create-user (name, cpf, company_id).',
    }, rawBody);
  }

  const normalizedRaw = normalizeIncomingPayload(rawBody);

  observabilityConsole.log('[AUTH ADMIN PAYLOAD]', {
    action: normalizedRaw.action,
    hasEmail: !!normalizedRaw.email,
    hasMetadata: !!normalizedRaw.metadata,
  });

  let body: z.infer<typeof AuthAdminBodySchema>;
  const parsed = AuthAdminBodySchema.safeParse(normalizedRaw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return authAdminResponse(
      400,
      corsHeaders,
      request,
      {
        success: false,
        error: 'VALIDATION_ERROR',
        detail: issues || 'Body inválido.',
      },
      rawBody,
    );
  }
  body = parsed.data;

  const action = body.action;
  const email = 'email' in body ? normalizeEmail(body.email) : '';
  const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();

  observabilityConsole.log('[AUTH ADMIN CONTEXT]', {
    hasAuthHeader: !!authHeader,
    hasCookie: !!request.headers.get('cookie'),
    action,
  });

  const rateKey = `${getClientIP(request)}:${action}:${email || 'no-email'}`;
  let rate;
  try {
    rate = await checkRateLimitDistributed(rateKey, 'authAdmin');
  } catch (error) {
    if (error instanceof Error && error.message === 'RATE_LIMIT_REDIS_REQUIRED') {
      return authAdminResponse(503, corsHeaders, request, {
        success: false,
        error: 'RATE_LIMIT_UNAVAILABLE',
        detail: 'Rate limiting distribuído obrigatório não configurado.',
      });
    }
    throw error;
  }
  if (!rate.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
    return noCache(Response.json(
      {
        success: false,
        error: 'Limite de requisições atingido. Aguarde alguns minutos e tente novamente.',
        code: 'RATE_LIMIT',
        retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfterSeconds),
        },
      },
    ));
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const adminSup = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (!jwt) {
      return Response.json(
        { error: 'Token de autenticação obrigatório.', code: 'UNAUTHORIZED' },
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let callerContext: CallerAdminContext | null = null;
    if (anonKey) {
      const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${jwt}`, apikey: anonKey },
      });
      if (authRes.ok) {
        const authUser = await authRes.json();
        const callerId = authUser?.id;
        if (callerId) callerContext = await getCallerAdminContext(adminSup, callerId);
      }
    }
    if (!callerContext || (callerContext.role !== 'admin' && callerContext.role !== 'hr')) {
      return Response.json(
        { error: 'Apenas administrador ou RH pode executar esta ação.', code: 'FORBIDDEN' },
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const callerCompanyId = callerContext.companyId;

    const adminAuth = (adminSup.auth as any).admin;
    const { data: listData } = await adminAuth.listUsers({ perPage: 1000 });
    const users = listData?.users ?? [];
    const target = users.find((u: any) => String(u.email || '').toLowerCase() === email);

    if (action === 'confirm-email') {
      if (!target?.id) {
        return Response.json(
          { error: 'Usuário não encontrado no Auth com este e-mail.', code: 'USER_NOT_FOUND' },
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const tenantCheck = await assertTargetUserInCallerTenant(adminSup, String(target.id), callerCompanyId);
      if (!tenantCheck.ok) {
        return new Response(tenantCheck.response.body, {
          status: tenantCheck.response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { error: updateErr } = await adminAuth.updateUserById(target.id, { email_confirm: true });
      if (updateErr) {
        return Response.json(
          { error: updateErr.message || 'Falha ao confirmar e-mail.', code: 'UPDATE_FAILED' },
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return Response.json(
        { success: true, message: 'E-mail confirmado. O funcionário já pode fazer login.' },
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'set-password') {
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
      if (!newPassword || newPassword.length < AUTH_ADMIN_MIN_PASSWORD_LENGTH) {
        return Response.json(
          { error: `Senha deve ter no mínimo ${AUTH_ADMIN_MIN_PASSWORD_LENGTH} caracteres.`, code: 'BAD_REQUEST' },
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (!target?.id) {
        return Response.json(
          { error: 'Usuário não encontrado no Auth com este e-mail. Crie o acesso em Cadastrar Funcionário ou use a importação.', code: 'USER_NOT_FOUND' },
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const tenantCheckPwd = await assertTargetUserInCallerTenant(adminSup, String(target.id), callerCompanyId);
      if (!tenantCheckPwd.ok) {
        return new Response(tenantCheckPwd.response.body, {
          status: tenantCheckPwd.response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
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
    }

    if (action === 'delete-user') {
      const userIdRaw = 'userId' in body ? String(body.userId || '').trim() : '';
      const emailRaw = 'email' in body ? normalizeEmail(body.email) : '';
      let userIdToDelete = userIdRaw;
      if (!userIdToDelete && emailRaw) {
        const byEmail = users.find((u: any) => normalizeEmail(String(u.email || '')) === emailRaw);
        userIdToDelete = String(byEmail?.id || '').trim();
      }
      if (!userIdToDelete) {
        return Response.json(
          { success: false, error: 'Usuário não encontrado para rollback.', code: 'AUTH_ERROR' },
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const tenantCheckDel = await assertTargetUserInCallerTenant(adminSup, userIdToDelete, callerCompanyId);
      if (!tenantCheckDel.ok) {
        return new Response(tenantCheckDel.response.body, {
          status: tenantCheckDel.response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { error: deleteErr } = await adminAuth.deleteUser(userIdToDelete);
      if (deleteErr) {
        observabilityConsole.error({ step: 'rollback_auth', success: false, user_id: userIdToDelete, error: deleteErr.message });
        return Response.json(
          { success: false, error: 'Falha ao remover usuário no Auth.', code: 'AUTH_ERROR' },
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      observabilityConsole.info({ step: 'rollback_auth', success: true, user_id: userIdToDelete });
      return Response.json(
        { success: true, userId: userIdToDelete },
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'create-user') {
      const metadata = body.metadata && typeof body.metadata === 'object' ? { ...body.metadata } : {};
      const nome = String((metadata as Record<string, unknown>).nome ?? (metadata as Record<string, unknown>).name ?? '').trim();
      const cpf = normalizeDigits((metadata as Record<string, unknown>).cpf);
      const pis = normalizeDigits((metadata as Record<string, unknown>).pis ?? (metadata as Record<string, unknown>).pis_pasep);
      const providedCompanyId = String((metadata as Record<string, unknown>).company_id ?? '').trim();
      if (callerCompanyId && providedCompanyId && providedCompanyId !== callerCompanyId) {
        return Response.json(
          { success: false, user_id: null, error: 'Empresa do cadastro não corresponde à sessão do administrador.', code: 'FORBIDDEN' },
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const companyId = providedCompanyId || callerCompanyId;
      if (companyId) metadata.company_id = companyId;

      const payloadLog = {
        action,
        emailProvided: !!email,
        nome,
        cpf: cpf ? `${cpf.slice(0, 3)}***` : '',
        pis: pis ? `${pis.slice(0, 3)}***` : '',
        companyId,
      };
      observabilityConsole.info('[auth-admin:create-user] payload recebido', payloadLog);

      if (!nome) {
        return Response.json(
          { success: false, user_id: null, error: 'Nome é obrigatório.', code: 'BAD_REQUEST' },
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!cpf && !pis) {
        return Response.json(
          { success: false, user_id: null, error: 'Informe CPF ou PIS/PASEP.', code: 'INVALID_DOCUMENT' },
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (cpf && !isValidDocument11Digits(cpf)) {
        return Response.json(
          { success: false, user_id: null, error: 'CPF deve conter 11 dígitos.', code: 'INVALID_DOCUMENT' },
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (pis && !isValidDocument11Digits(pis)) {
        return Response.json(
          { success: false, user_id: null, error: 'PIS/PASEP deve conter 11 dígitos.', code: 'INVALID_DOCUMENT' },
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (email && !isValidEmail(email)) {
        return Response.json(
          { success: false, user_id: null, error: 'E-mail inválido.', code: 'INVALID_EMAIL' },
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let emailToUse = email;
      if (!emailToUse) {
        const baseLocal = generateSafeFallbackEmailBase(cpf, pis);
        let candidate = `${baseLocal}@${FALLBACK_EMAIL_DOMAIN}`;
        let seq = 0;
        while (true) {
          const inAuth = users.some((u: any) => normalizeEmail(String(u.email || '')) === candidate);
          const inDb = await emailExistsInUsers(adminSup, candidate);
          if (!inAuth && !inDb) break;
          seq += 1;
          candidate = `${baseLocal}-${seq}@${FALLBACK_EMAIL_DOMAIN}`;
          if (seq > 20) {
            return Response.json(
              { success: false, user_id: null, error: 'Falha ao gerar e-mail único para cadastro.', code: 'AUTH_ERROR' },
              { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }
        emailToUse = candidate;
      }
      const passwordRaw = typeof body.password === 'string' ? body.password.trim() : '';
      const generatedPassword = !passwordRaw;
      const passwordToUse = passwordRaw || generateFallbackPassword();
      if (passwordToUse.length < AUTH_ADMIN_MIN_PASSWORD_LENGTH) {
        return Response.json(
          { success: false, user_id: null, error: `Senha deve ter pelo menos ${AUTH_ADMIN_MIN_PASSWORD_LENGTH} caracteres.`, code: 'INVALID_PASSWORD' },
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const duplicateChecks = [
        emailToUse ? `email.eq.${emailToUse}` : '',
        cpf ? `cpf.eq.${cpf}` : '',
        pis ? `pis_pasep.eq.${pis}` : '',
      ].filter(Boolean);

      if (duplicateChecks.length > 0) {
        const { data: existingUsers, error: duplicateError } = await adminSup
          .from('users')
          .select('id,email,cpf,pis_pasep')
          .or(duplicateChecks.join(','))
          .limit(5);
        if (duplicateError) {
          observabilityConsole.error('[auth-admin:create-user] erro ao validar duplicidade', duplicateError);
          return Response.json(
            { success: false, user_id: null, error: 'Falha ao validar duplicidade de usuário.', code: 'DB_ERROR' },
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const found = existingUsers ?? [];
        if (found.some((u: { email?: string | null }) => normalizeEmail(u.email ?? '') === emailToUse)) {
          return Response.json(
            { success: false, user_id: null, error: 'E-mail já cadastrado.', code: 'USER_ALREADY_EXISTS' },
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        if (cpf && found.some((u: { cpf?: string | null }) => normalizeDigits(u.cpf) === cpf)) {
          return Response.json(
            { success: false, user_id: null, error: 'CPF já cadastrado.', code: 'CPF_ALREADY_EXISTS' },
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        if (pis && found.some((u: { pis_pasep?: string | null }) => normalizeDigits(u.pis_pasep) === pis)) {
          return Response.json(
            { success: false, user_id: null, error: 'PIS/PASEP já cadastrado.', code: 'PIS_ALREADY_EXISTS' },
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      try {
        observabilityConsole.info({ step: 'create_auth_user', email: emailToUse, company_id: companyId });
        const { data: created, error: createError } = await adminAuth.createUser({
          email: emailToUse,
          password: passwordToUse,
          email_confirm: true,
          user_metadata: {
            ...metadata,
            name: nome,
            nome,
            cpf: cpf || null,
            pis: pis || null,
            pis_pasep: pis || null,
            company_id: companyId,
          },
        });
        if (createError) {
          const { message: friendlyMessage } = mapAuthErrorToFriendly(createError.message || '', (createError as any).code || '', 400);
          observabilityConsole.error({ step: 'create_auth_user', success: false, error: createError.message });
          return Response.json(
            { success: false, user_id: null, error: friendlyMessage, code: 'AUTH_ERROR' },
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const userId = created?.user?.id ?? created?.id;
        if (!userId) {
          observabilityConsole.error({ step: 'create_auth_user', success: false, error: 'Sem user_id na resposta do Auth' });
          return Response.json(
            { success: false, user_id: null, error: 'Conta criada mas ID não retornado.', code: 'AUTH_ERROR' },
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        observabilityConsole.info({ step: 'create_auth_user', success: true, user_id: userId, used_fallback_email: !email });
        return Response.json(
          { success: true, user_id: userId, error: null },
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (err: unknown) {
        observabilityConsole.error('[auth-admin:create-user] excecao', err);
        const errStr = messageFromUnknown(err, 'Falha ao criar usuário no Auth.');
        const mapped = mapAuthErrorToFriendly(errStr, '', 400);
        return Response.json(
          { success: false, user_id: null, error: mapped.message, code: 'AUTH_ERROR' },
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    return Response.json(
      { error: 'action inválido.', code: 'BAD_REQUEST' },
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e: unknown) {
    const error = e instanceof Error ? e : new Error(messageFromUnknown(e, 'Erro interno.'));
    observabilityConsole.error('[AUTH ADMIN FATAL]', {
      message: error.message,
      stack: error.stack,
    });
    return authAdminResponse(500, corsHeaders, request, {
      success: false,
      error: 'INTERNAL_ERROR',
      detail: error.message,
    });
  }
}

async function handler(request: Request): Promise<Response> {
  observabilityConsole.log('[AUTH ADMIN START]', { method: request.method, url: request.url });
  try {
    return await handleRequest(request);
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(messageFromUnknown(error, 'Erro interno.'));
    observabilityConsole.error('[AUTH ADMIN FATAL]', {
      message: err.message,
      stack: err.stack,
      raw: error,
    });
    const corsHeaders = getSecureCorsHeaders(request, {
      allowMethods: 'POST, OPTIONS',
      allowHeaders: 'Content-Type, Authorization, x-debug',
    });
    return noCache(
      Response.json(
        {
          success: false,
          error: 'RUNTIME_ERROR',
          detail: err.message,
        },
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      ),
    );
  }
}

export default { fetch: handler };
