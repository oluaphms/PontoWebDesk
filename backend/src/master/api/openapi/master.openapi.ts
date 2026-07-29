/**
 * OpenAPI 3 — somente rotas /api/master/*
 * Sem documentação do sistema operacional.
 */
export const MASTER_OPENAPI_SPEC = {
  openapi: '3.0.3',
  info: {
    title: 'PontoWebDesk Master API',
    version: '1.0.0',
    description:
      'API isolada do Painel Master. JWT próprio (MASTER_JWT_SECRET). Não autentica empresas / REP / ponto.',
  },
  servers: [{ url: '/api/master', description: 'Master API base' }],
  tags: [
    { name: 'Auth' },
    { name: 'Dashboard' },
    { name: 'Summary' },
    { name: 'Tenants' },
    { name: 'Licenses' },
    { name: 'Subscriptions' },
    { name: 'Billing' },
    { name: 'Payments' },
    { name: 'Invoices' },
    { name: 'PIX' },
    { name: 'Charges' },
    { name: 'Finance' },
    { name: 'Plans' },
    { name: 'Admin' },
    { name: 'Deployments' },
    { name: 'Hybrid' },
    { name: 'System' },
    { name: 'Health' },
    { name: 'Logs' },
    { name: 'Audit' },
    { name: 'Users' },
    { name: 'Docs' },
  ],
  components: {
    securitySchemes: {
      MasterBearer: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token Master (MASTER_JWT_SECRET). Não é o JWT das empresas.',
      },
      MasterApiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Master-Key',
        description: 'Bootstrap key (MASTER_API_KEY)',
      },
    },
    schemas: {
      MasterError: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: false },
          error: { type: 'string' },
          code: { type: 'string' },
          message: { type: 'string' },
        },
      },
      MasterLoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', format: 'password' },
        },
      },
      MasterLoginResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          session: { type: 'object' },
          tokenType: { type: 'string', example: 'master' },
        },
      },
    },
  },
  paths: {
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login Master (JWT separado)',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/MasterLoginRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Sessão Master',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/MasterLoginResponse' } },
            },
          },
          '401': { description: 'Credenciais inválidas' },
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary:
          'Logout Master — revoga sessão server-side, invalida JWT/refresh e limpa pwd_master_session + pwd_master_refresh (não toca pwd_session)',
        security: [],
        responses: { '200': { description: 'Sessão Master encerrada e revogada' } },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Refresh Master com rotação de refresh token',
        security: [],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  token: { type: 'string', description: 'Access JWT Master (compat)' },
                  refreshToken: { type: 'string', description: 'Refresh token opaco' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Nova MasterSession (access + refresh rotacionados)' },
          '401': { description: 'Token Master inválido ou revogado' },
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Sessão Master atual + permissions',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '200': { description: 'Contexto Master' }, '401': { description: 'Não autenticado' } },
      },
    },
    '/dashboard': {
      get: {
        tags: ['Dashboard'],
        summary: 'Dashboard executivo Master',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '200': { description: 'Summary + executive' } },
      },
    },
    '/summary': {
      get: {
        tags: ['Summary'],
        summary: 'Resumo comercial/executivo Master',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '200': { description: 'Summary + executive (sem módulos detalhados)' } },
      },
    },
    '/logs': {
      get: {
        tags: ['Logs'],
        summary: 'Logs do dashboard + auditoria HTTP Master',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 100, maximum: 500 },
          },
        ],
        responses: { '200': { description: 'logs + audit (InMemory)' } },
      },
    },
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health exclusivo do Painel Master (não é /api/health operacional)',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '200': { description: 'Health + monitoring Master' } },
      },
    },
    '/tenants': {
      get: {
        tags: ['Tenants'],
        summary: 'Listar empresas / tenants',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '200': { description: 'Lista de tenants' } },
      },
      post: {
        tags: ['Tenants'],
        summary: 'Criar empresa / tenant',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '201': { description: 'Created' }, '400': { description: 'Validation' } },
      },
    },
    '/tenants/{id}': {
      get: {
        tags: ['Tenants'],
        summary: 'Obter tenant',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Tenant' }, '404': { description: 'Not found' } },
      },
      patch: {
        tags: ['Tenants'],
        summary: 'Atualizar tenant',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated' } },
      },
    },
    '/tenants/{id}/actions/{action}': {
      post: {
        tags: ['Tenants'],
        summary: 'Ação no tenant (block/unblock/suspend/cancel/activate/start_trial)',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'action', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Action applied' } },
      },
    },
    '/licenses': {
      get: {
        tags: ['Licenses'],
        summary: 'Listar licenças (License Manager + locais)',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '200': { description: 'Licenças' } },
      },
      post: {
        tags: ['Licenses'],
        summary: 'Criar licença comercial',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '201': { description: 'Created' } },
      },
    },
    '/licenses/{id}': {
      patch: {
        tags: ['Licenses'],
        summary: 'Atualizar licença',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated' } },
      },
    },
    '/licenses/{id}/rules': {
      post: {
        tags: ['Licenses'],
        summary: 'Atualizar regras da licença',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Rules updated' } },
      },
    },
    '/licenses/{id}/actions/{action}': {
      post: {
        tags: ['Licenses'],
        summary: 'Ação na licença (activate/block/renew/…)',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'action', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Action applied' } },
      },
    },
    '/licenses/local/{machineId}/actions/{action}': {
      post: {
        tags: ['Licenses'],
        summary: 'Ação em licença local (renew/revoke)',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        parameters: [
          { name: 'machineId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'action', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Local license action' } },
      },
    },
    '/subscriptions': {
      get: {
        tags: ['Subscriptions'],
        summary: 'Listar assinaturas',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '200': { description: 'Assinaturas' } },
      },
      post: {
        tags: ['Subscriptions'],
        summary: 'Criar assinatura (sem pagamento)',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '201': { description: 'Created' } },
      },
    },
    '/subscriptions/{id}/actions/{action}': {
      post: {
        tags: ['Subscriptions'],
        summary: 'Ação (renew/suspend/cancel/reactivate/block/…)',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'action', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Action applied' } },
      },
    },
    '/billing': {
      get: {
        tags: ['Billing'],
        summary: 'Snapshot do Billing Engine oficial (DecoupledBillingEngine)',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '200': { description: 'Billing snapshot' } },
      },
    },
    '/billing/provider': {
      post: {
        tags: ['Billing'],
        summary: 'Definir provider ativo (asaas|pagseguro|stripe)',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '200': { description: 'Provider set' } },
      },
    },
    '/billing/webhooks': {
      get: {
        tags: ['Billing'],
        summary: 'Webhooks InMemory do Billing Engine',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '200': { description: 'Webhooks' } },
      },
    },
    '/invoices': {
      get: {
        tags: ['Invoices', 'Billing'],
        summary: 'Listar faturas',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '200': { description: 'Invoices' } },
      },
      post: {
        tags: ['Invoices', 'Billing'],
        summary: 'Criar fatura',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '201': { description: 'Created' } },
      },
    },
    '/invoices/{id}/actions/{action}': {
      post: {
        tags: ['Invoices', 'Billing'],
        summary: 'Ação na fatura (mark_paid|void)',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'action', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Action applied' } },
      },
    },
    '/payments': {
      get: {
        tags: ['Payments', 'Billing'],
        summary: 'Listar pagamentos (Billing Engine oficial)',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '200': { description: 'Payments' } },
      },
      post: {
        tags: ['Payments', 'Billing'],
        summary: 'Criar pagamento',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '201': { description: 'Created' } },
      },
    },
    '/payments/{id}/actions/{action}': {
      post: {
        tags: ['Payments', 'Billing'],
        summary: 'Ação no pagamento (mark_paid|cancel|refund)',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'action', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Action applied' } },
      },
    },
    '/pix': {
      get: {
        tags: ['PIX', 'Billing'],
        summary: 'Listar cobranças PIX',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '200': { description: 'PIX charges' } },
      },
      post: {
        tags: ['PIX', 'Billing'],
        summary: 'Criar cobrança PIX',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '201': { description: 'Created' } },
      },
    },
    '/pix/{id}/actions/{action}': {
      post: {
        tags: ['PIX', 'Billing'],
        summary: 'Ação PIX (mark_paid|cancel)',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'action', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Action applied' } },
      },
    },
    '/charges': {
      get: {
        tags: ['Charges', 'Billing'],
        summary: 'Cobranças (compat — BillingService + BillingEngine legado)',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '200': { description: 'Charges' } },
      },
    },
    '/charges/{id}/actions/{action}': {
      post: {
        tags: ['Charges', 'Billing'],
        summary: 'Ação em cobrança (mark_paid)',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'action', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Action applied' } },
      },
    },
    '/finance': {
      get: {
        tags: ['Finance'],
        summary: 'Painel financeiro Master',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '200': { description: 'Finance snapshot' } },
      },
    },
    '/plans': {
      get: {
        tags: ['Plans'],
        summary: 'Listar catálogo de planos SaaS mensais/anuais',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '200': { description: 'Plans' } },
      },
      post: {
        tags: ['Plans'],
        summary: 'Criar plano SaaS',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '201': { description: 'Plan created' } },
      },
    },
    '/plans/{id}': {
      patch: {
        tags: ['Plans'],
        summary: 'Editar plano SaaS',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Plan updated' } },
      },
    },
    '/plans/{id}/actions/{action}': {
      post: {
        tags: ['Plans'],
        summary: 'Ativar ou desativar plano',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'action', in: 'path', required: true, schema: { type: 'string', enum: ['activate', 'deactivate'] } },
        ],
        responses: { '200': { description: 'Plan status updated' } },
      },
    },
    '/tenants/{companyId}/subscription': {
      get: {
        tags: ['Subscriptions'],
        summary: 'Visualizar assinatura vigente da empresa',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        parameters: [{ name: 'companyId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Company subscription' } },
      },
    },
    '/tenants/{companyId}/subscription/{action}': {
      post: {
        tags: ['Subscriptions'],
        summary: 'Atribuir, alterar ou cancelar plano da empresa',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        parameters: [
          { name: 'companyId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'action', in: 'path', required: true, schema: { type: 'string', enum: ['assign', 'change', 'cancel'] } },
        ],
        responses: { '200': { description: 'Company subscription updated' } },
      },
    },
    '/tenants/{companyId}/subscription/finance': {
      get: {
        tags: ['Subscriptions', 'Finance'],
        summary: 'Histórico financeiro da assinatura da empresa',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        parameters: [{ name: 'companyId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Subscription financial timeline' } },
      },
      post: {
        tags: ['Subscriptions', 'Finance'],
        summary: 'Criar lançamento financeiro editável',
        security: [{ MasterBearer: [] }],
        parameters: [{ name: 'companyId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '201': { description: 'Financial entry created' } },
      },
    },
    '/subscription-finance/{id}': {
      patch: {
        tags: ['Subscriptions', 'Finance'],
        summary: 'Editar valor, datas e status do lançamento',
        security: [{ MasterBearer: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Financial entry updated' } },
      },
    },
    '/subscription-finance/process-overdue': {
      post: {
        tags: ['Subscriptions', 'Finance'],
        summary: 'Processar inadimplência e bloqueios automáticos',
        security: [{ MasterBearer: [] }],
        responses: { '200': { description: 'Overdue scan result' } },
      },
    },
    '/admin': {
      get: {
        tags: ['Admin'],
        summary: 'Administração global Master',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '200': { description: 'Admin snapshot' } },
      },
    },
    '/deployments': {
      get: {
        tags: ['Deployments'],
        summary: 'Deployments por tenant (TenantDeploymentManager)',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '200': { description: 'Deployments' } },
      },
      post: {
        tags: ['Deployments'],
        summary: 'Criar deployment de tenant',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '201': { description: 'Created' } },
      },
    },
    '/deployments/{id}': {
      patch: {
        tags: ['Deployments'],
        summary: 'Atualizar deployment',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated' } },
      },
    },
    '/deployments/{id}/actions/{action}': {
      post: {
        tags: ['Deployments'],
        summary: 'Ação de deployment (set_mode_*/sync/…)',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'action', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Action applied' } },
      },
    },
    '/hybrid': {
      get: {
        tags: ['Hybrid'],
        summary: 'Estado Hybrid Sync (InMemory)',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '200': { description: 'Filas e conflitos' } },
      },
    },
    '/system': {
      get: {
        tags: ['System'],
        summary: 'Snapshot do sistema Master',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        responses: { '200': { description: 'System snapshot' } },
      },
    },
    '/audit': {
      get: {
        tags: ['Audit'],
        summary: 'Trilha de auditoria Master (filtros server-side + paginação)',
        security: [{ MasterBearer: [] }, { MasterApiKey: [] }],
        parameters: [
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'companyId', in: 'query', schema: { type: 'string' } },
          { name: 'actor', in: 'query', schema: { type: 'string' } },
          { name: 'ip', in: 'query', schema: { type: 'string' } },
          { name: 'action', in: 'query', schema: { type: 'string' } },
          { name: 'resource', in: 'query', schema: { type: 'string' } },
          {
            name: 'result',
            in: 'query',
            schema: { type: 'string', enum: ['success', 'failure', 'all'] },
          },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100, maximum: 500 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          {
            name: 'order',
            in: 'query',
            schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
          },
        ],
        responses: { '200': { description: 'Audit log paginado' } },
      },
    },
    '/users': {
      get: {
        tags: ['Users'],
        summary: 'Listar usuários Master',
        security: [{ MasterBearer: [] }],
        responses: { '200': { description: 'Users' } },
      },
      post: {
        tags: ['Users'],
        summary: 'Criar usuário Master',
        security: [{ MasterBearer: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'name', 'password', 'role'],
                properties: {
                  email: { type: 'string' },
                  name: { type: 'string' },
                  password: { type: 'string' },
                  role: {
                    type: 'string',
                    enum: [
                      'MASTER_OWNER',
                      'MASTER_ADMIN',
                      'MASTER_SUPPORT',
                      'MASTER_FINANCE',
                      'MASTER_AUDITOR',
                    ],
                  },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Created' }, '400': { description: 'Validation' } },
      },
    },
    '/users/{id}': {
      patch: {
        tags: ['Users'],
        summary: 'Alterar perfil, nome ou status do usuário Master',
        security: [{ MasterBearer: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  active: { type: 'boolean' },
                  role: {
                    type: 'string',
                    enum: [
                      'MASTER_OWNER',
                      'MASTER_ADMIN',
                      'MASTER_SUPPORT',
                      'MASTER_FINANCE',
                      'MASTER_AUDITOR',
                    ],
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Updated' },
          '403': { description: 'Forbidden by role hierarchy' },
          '409': { description: 'Last active Owner protection' },
        },
      },
    },
    '/users/{id}/reset-password': {
      post: {
        tags: ['Users'],
        summary: 'Redefinir senha e revogar sessões do usuário Master',
        security: [{ MasterBearer: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['newPassword'],
                properties: {
                  newPassword: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Password reset; sessions revoked' },
          '403': { description: 'Forbidden by role hierarchy' },
        },
      },
    },
    '/openapi.json': {
      get: {
        tags: ['Docs'],
        summary: 'OpenAPI JSON do Master',
        security: [],
        responses: { '200': { description: 'OpenAPI 3 spec' } },
      },
    },
    '/docs': {
      get: {
        tags: ['Docs'],
        summary: 'Swagger UI do Master',
        security: [],
        responses: { '200': { description: 'HTML' } },
      },
    },
  },
} as const;

export function getMasterOpenApiJson(): unknown {
  return MASTER_OPENAPI_SPEC;
}

export function getMasterSwaggerHtml(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <title>PontoWebDesk Master API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
  <style>body{margin:0;background:#0f172a} .topbar{display:none}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/api/master/openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis],
      layout: 'BaseLayout'
    });
  </script>
</body>
</html>`;
}
