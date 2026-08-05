# Fase 6.3 — relatório de validação

## Entrega

- Catálogo persistente `public.master_plans` para planos `MONTHLY` e `ANNUAL`.
- Extensão compatível de `public.master_subscriptions` com `plan_id`, `company_id` e `cycle`.
- Status públicos: `TRIAL`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELLED` e `EXPIRED`.
- Regra mensal por mês-calendário e anual por 12 meses, incluindo ajuste para o último dia do mês.
- Uma assinatura comercial vigente por tenant.
- Cadastro, edição, ativação e desativação de planos no Master.
- Consulta, atribuição, alteração e cancelamento da assinatura na empresa.
- Auditoria: `PLAN_CREATED`, `PLAN_UPDATED`, `PLAN_ASSIGNED`, `PLAN_CHANGED` e `PLAN_CANCELLED`.
- Escritas restritas a usuário humano Master com `subscriptions:write`; `MASTER_API_KEY` não pode alterar planos.
- Nenhuma rota operacional de Admin da empresa foi criada.
- O bloqueio administrativo da Fase 6.2 não foi alterado.

## Migrations

- `backend/db/migrations/031_master_saas_plans.sql`
- `supabase/migrations/20260721190000_master_saas_plans.sql`

Os arquivos espelho possuem o mesmo SHA-256:
`5E1C4EDB3C0031F9522A73BCD0BB24FF33C00946CB8CA91227DC5A036D9DE6ED`.

## Rotas

- `GET /api/master/plans`
- `POST /api/master/plans`
- `PATCH /api/master/plans/:id`
- `POST /api/master/plans/:id/actions/:action`
- `GET /api/master/tenants/:companyId/subscription`
- `POST /api/master/tenants/:companyId/subscription/assign`
- `POST /api/master/tenants/:companyId/subscription/change`
- `POST /api/master/tenants/:companyId/subscription/cancel`

## Validação executada

- `npm run validate:migrations`: aprovado.
- `backend: npx tsc -p tsconfig.json --noEmit`: aprovado.
- `backend: npm test`: 64 arquivos e 268 testes aprovados.
- `frontend: npm run build`: aprovado.
- TypeScript dos arquivos frontend alterados: sem erros.
- Typecheck global frontend: permanece com 386 linhas de erros preexistentes fora da Fase 6.3
  (principalmente mocks de autenticação/Firebase e serviços legados).
- Aplicação da migration 031: tentada, mas não executada porque o `DATABASE_URL`
  disponível no ambiente local é placeholder. A migration foi validada estaticamente e
  precisa ser aplicada em um ambiente com conexão PostgreSQL real.

