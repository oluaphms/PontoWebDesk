# Fase 6.4 — relatório de validação

## Entrega

- Razão financeiro persistente vinculado à assinatura, tenant e empresa.
- Timeline com pagamentos, pendências, vencimentos e bloqueios automáticos.
- Valores, vencimento, data de pagamento e data de bloqueio editáveis.
- Ao registrar um pagamento, a próxima cobrança mensal/anual é criada de forma idempotente.
- Pendências passam para `OVERDUE` após o vencimento.
- Ao atingir `block_at`, o processador chama o mesmo `MasterTenantsService.applyAction('block')`
  usado pelo bloqueio administrativo oficial.
- O bloqueio continua projetando `commercial_blocked` e incrementando
  `company_session_version`; login, APIs e sessões seguem o comportamento fail-closed da Fase 6.2.
- Bloqueios administrativos existentes não são sobrescritos pela automação financeira.
- Nenhuma alteração foi feita no `AuthSessionProvider`, JWT operacional, roles de empresa ou
  rotas de Admin da empresa.
- Cancelamento de assinatura (Fase 6.3) agora projeta o estado comercial no SaaS; se a
  projeção falhar, a assinatura é restaurada para evitar Master cancelado com SaaS aberto.

## Auditoria

Eventos implementados:

- `SUBSCRIPTION_CHARGE_CREATED`
- `SUBSCRIPTION_CHARGE_UPDATED`
- `SUBSCRIPTION_PAYMENT_RECORDED`
- `SUBSCRIPTION_AUTO_BLOCKED`
- `SUBSCRIPTION_AUTO_BLOCK_FAILED`
- `SUBSCRIPTION_OVERDUE_SCAN`

As mutações manuais registram usuário Master, empresa, `before` e `after`.
Os bloqueios automáticos usam o ator de sistema `master-finance-automation`.

## Segurança

- Leitura: `payments:read`.
- Escrita/edição/processamento manual: `payments:write`.
- Mutações exigem usuário humano Master; `MASTER_API_KEY` não pode alterar o financeiro.
- Admin, RH, gestor e demais roles de empresa não possuem rotas para alterar assinaturas.

## Migration

- `backend/db/migrations/032_master_subscription_finance.sql`
- `supabase/migrations/20260721200000_master_subscription_finance.sql`

SHA-256 dos arquivos espelho:
`4BB1D9BE3ADD1B0099522BA4416567358DDBA5ADC33DBEAA49EC72709A1A2F26`.

## Rotas

- `GET /api/master/tenants/:companyId/subscription/finance`
- `POST /api/master/tenants/:companyId/subscription/finance`
- `PATCH /api/master/subscription-finance/:id`
- `POST /api/master/subscription-finance/process-overdue`

## Automação

- Ativa apenas com `MASTER_PERSISTENCE=postgres`.
- Intervalo padrão: cinco minutos.
- Configuração:
  - `MASTER_FINANCE_AUTOMATION_ENABLED`
  - `MASTER_FINANCE_AUTOMATION_INTERVAL_MS`
- O processamento é idempotente por cobrança através do índice único de `source_entry_id`.

## Validação executada

- `backend: npx tsc -p tsconfig.json --noEmit`: aprovado.
- `backend: npm test`: 66 arquivos e 273 testes aprovados.
- `frontend: npm run build`: aprovado.
- `npm run validate:migrations`: aprovado.
- Arquivos frontend alterados: sem erros TypeScript específicos.
- Typecheck global frontend mantém erros legados fora da Fase 6.4.
- Aplicação da migration 032: tentada, mas não executada porque o `DATABASE_URL`
  local é placeholder. A migration precisa ser aplicada em um ambiente PostgreSQL real.

