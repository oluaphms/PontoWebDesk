# FASE 30 — Automação Comercial

## Objetivo

Automatizar a ativação comercial **após confirmação manual de pagamento** no Painel Master, sem integrar gateway financeiro.

## Fluxo

```
Cadastro do cliente
  → Plano escolhido
  → Pagamento confirmado manualmente pelo Master
  → Licença criada
  → Empresa criada
  → Administrador criado
  → Primeiro acesso enviado
  → Empresa liberada
  → Updater preparado
  → Sistema pronto para uso
```

A confirmação de pagamento permanece **manual**. Depois dela, o restante do pipeline (wizard de implantação) executa automaticamente.

## Escopo respeitado

- Sem gateway financeiro (Asaas/PagSeguro/Stripe HTTP).
- Sem alteração de REP, RH, Banco de Horas, Espelho, Realtime, Mobile ou auth operacional.
- Reutiliza `CommercialJourneyService.runWizardStep` (FASE 28).
- Timeline + log + notificações in-app Master.

## API

| Método | Rota | Função |
|--------|------|--------|
| GET | `/api/master/tenants/:id/automation` | Snapshot + timeline |
| POST | `/api/master/tenants/:id/automation/confirm-payment` | Confirma pagamento manual + pipeline |
| POST | `/api/master/tenants/:id/automation/retry` | Retoma após falha |
| GET | `/api/master/notifications` | Lista notificações |
| POST | `/api/master/notifications/read-all` | Marca lidas |
| POST | `/api/master/notifications/:id/read` | Marca uma |

Hooks em `mark_paid` (charges / invoices / payments / PIX): se houver `tenantId`, dispara `tryFromPaymentRef` (pagamento permanece pago mesmo se a automação falhar).

## Persistência

Estado em `master_commercial_onboardings.wizard_meta.automation` (timeline, status, paymentRef). `mergeWizardMetaRaw` evita apagar a automação ao atualizar outras metas do wizard.

## UI

- Detalhe da empresa: botão **Confirmar pagamento e ativar**, timeline e retomar.
- Topbar Master: sino de notificações.

## Verificação

| Check | Resultado |
|-------|-----------|
| Build frontend | OK |
| Lint | OK (0 errors; warnings pré-existentes) |
| Build backend | OK |
| Testes Master | **115/115** |

## Arquivos principais

- `backend/src/master/journey/CommercialAutomationService.ts`
- `backend/src/master/journey/masterNotifications.ts`
- `backend/src/master/journey/commercialAutomation.test.ts`
- `backend/src/master/api/controllers/commercialAutomation.controllers.ts`
- `backend/src/master/api/controllers/billingEngine.controllers.ts` (hook mark_paid)
- `backend/src/controllers/master/chargesController.ts` (hook mark_paid)
- `src/master/pages/MasterCompanyDetailPage.tsx`
- `src/master/components/MasterNotificationsBell.tsx`
- `src/master/api/companiesApi.ts`
