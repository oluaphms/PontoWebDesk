# Fase 6.5 — relatório de validação

## Entrega

- Outbox persistente `master_subscription_notifications` com dedupe por
  `(finance_entry_id, kind, channel)`.
- Avisos automáticos alinhados ao financeiro da Fase 6.4 (`due_at` / `block_at`):
  - **7 dias antes** → `DUE_IN_7` — “Seu plano vencerá em 7 dias.”
  - **3 dias antes** → `DUE_IN_3` — “Segundo aviso.”
  - **No vencimento** → `DUE_TODAY` — “Pagamento pendente.”
  - **Após bloqueio automático** → `BLOCKED` — “Empresa bloqueada. Clique aqui para regularizar.”
  - **Pagamento confirmado** → `PAID_RELEASED` — “Pagamento recebido. Sua empresa foi liberada automaticamente”
- Canais: inbox do Painel Master (`MasterNotifications`) + admin da empresa
  (`master_tenants.admin_email`) + inbox SaaS (`public.notifications`, mesmo destino
  do `NotificationService` do frontend).
- Sem SMTP dedicado no control plane: entrega externa ao admin via log do processo ou
  `MASTER_NOTIFICATION_WEBHOOK_URL`.
- Ao registrar pagamento, se o bloqueio for `subscription_overdue:*`, chama
  `MasterTenantsService.applyAction('unblock')` (caminho oficial da Fase 6.2) e
  reativa assinatura `SUSPENDED`. Bloqueio administrativo **não** é desfeito.
- O ciclo de automação financeira agora processa avisos + inadimplência
  (`processSubscriptionFinanceCycle`).
- Nenhuma alteração em `AuthSessionProvider`, JWT operacional, roles de empresa
  ou gates de bloqueio da Fase 6.2.

## Auditoria

- `SUBSCRIPTION_NOTIFICATION_SENT`
- `SUBSCRIPTION_NOTIFICATION_FAILED`
- `SUBSCRIPTION_AUTO_RELEASED`
- `SUBSCRIPTION_PAYMENT_NOTIFIED`
- (mantidos) `SUBSCRIPTION_AUTO_BLOCKED`, `SUBSCRIPTION_PAYMENT_RECORDED`, `SUBSCRIPTION_OVERDUE_SCAN`

## Segurança

- Mutações financeiras continuam exigindo Master humano.
- Liberação automática só para motivo `subscription_overdue:*`.
- Admin/RH/gestor da empresa não alteram assinatura nem notificações.

## Migration

- `backend/db/migrations/033_master_subscription_notifications.sql`
- `supabase/migrations/20260721210000_master_subscription_notifications.sql`

SHA-256 dos arquivos espelho:
`41826BEBB0E77C2D504D75AF71E4D9761970EEAF84D326C6AEE5AEEECDD049CE`.

## Automação

- Ativa apenas com `MASTER_PERSISTENCE=postgres`.
- Intervalo padrão: cinco minutos.
- Configuração:
  - `MASTER_FINANCE_AUTOMATION_ENABLED`
  - `MASTER_FINANCE_AUTOMATION_INTERVAL_MS`
  - `MASTER_NOTIFICATION_WEBHOOK_URL` (opcional)
- Endpoint manual: `POST /api/master/subscription-finance/process-overdue`
  (agora roda avisos + bloqueios).

## Validação executada

- `backend: npx tsc -p tsconfig.json --noEmit`: aprovado.
- `backend: npm test`: 67 arquivos e 277 testes aprovados.
- `npm run validate:migrations`: aprovado.
- Aplicação da migration 033: depende de PostgreSQL real (`DATABASE_URL` local
  permanece placeholder nesta máquina).
