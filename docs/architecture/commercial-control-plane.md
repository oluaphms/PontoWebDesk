# Control plane comercial — única fonte de verdade

O **Painel Master** é a única fonte de verdade para dados comerciais da plataforma.
O SaaS operacional (empresa do cliente) **somente lê** a projeção desses dados.

## Escopo comercial (Master-only)

| Conceito | Onde vive (fonte) | Projeção no SaaS |
|----------|-------------------|------------------|
| Plano | `master_tenants.plan` / License Manager | `companies.plan`, `companies.commercial_plan` |
| Licença | `master_licenses` | `companies.license_status`, `license_expires_at` |
| Status da assinatura | `master_subscriptions` | `companies.subscription_status` |
| Modo (SAAS / LOCAL / HYBRID) | `master_tenants.mode` | `companies.commercial_mode` |
| Limites contratados | storage/limites Master | `companies.contracted_limits` |
| Situação de pagamento | billing Master | `companies.payment_status` |
| Bloqueio / desbloqueio | tenant + licença Master | `companies.commercial_blocked` |
| Histórico financeiro | `master_subscription_finance_entries` | Não projetado; permanece no Master |

## Fluxo unidirecional

```
Painel Master (write)
  → master_tenants / master_licenses / master_subscriptions / master_subscription_finance_entries
  → CommercialProjectionService
  → public.companies (snapshot somente leitura)
  → SaaS UI / login lê a projeção
```

O SaaS **nunca** envia alterações comerciais para o Master.

## Proteções

1. **API operacional** (`PATCH /api/data/companies/:id`):
   - qualquer campo comercial no body → `403` com código `COMMERCIAL_FIELDS_MASTER_ONLY`.
2. **Trigger PostgreSQL** (`prevent_saas_commercial_company_writes`):
   - impede `UPDATE` de colunas comerciais por sessão autenticada do tenant;
   - permite escrita apenas com GUC `app.master_control_plane=true` (control plane Master).
3. **UI Empresa** (`/admin/company`):
   - seção “Contrato e licença” somente leitura;
   - payload de save não inclui campos comerciais.
4. **Login operacional**:
   - se `companies.commercial_blocked = true` (projetado pelo Master), login retorna `403` / `COMMERCIAL_BLOCKED_BY_MASTER`;
   - a decisão de bloqueio **não** é inventada no SaaS — usa só o estado projetado.

## Precedência do bloqueio automático

Derivada em `deriveCommercialProjection`:

1. Tenant Master `blocked` / `suspended` / `cancelled`
2. Licença Master `Bloqueada` / `Expirada` / `blockLogin`
3. Assinatura Master `SUSPENDED` / `CANCELLED` / `EXPIRED`

## O que NÃO muda

- Autenticação da empresa (JWT, cookies, AuthSessionProvider) permanece a mesma, com o gate adicional de leitura da projeção.
- Espelho, Banco de Horas, RH, Mobile, Realtime e Portaria 671 não inventam regra comercial própria — só leem a projeção via login/API autenticada.
- Páginas e APIs comerciais do Master continuam sendo o único escritor.

## Bloqueio e canais operacionais (Fase 6.2)

Além do JWT/login, o bloqueio administrativo Master (`commercial_blocked = true`) também:

1. Impede autenticação REP (device key / API key / bridge) em `repAgentAuthService`.
2. Impede rotas REP admin (`resolveRepAdminCaller`).
3. Impede ingestão serverless `api/punch.ts` autenticada por `API_KEY`.
4. Falha fechado se o gate comercial estiver indisponível (`503 COMMERCIAL_GATE_UNAVAILABLE`).

## Inadimplência e bloqueio automático (Fase 6.4)

Cada cobrança da assinatura possui valor, vencimento e `block_at` editáveis. O processador
financeiro marca cobranças vencidas como `OVERDUE` e, ao atingir `block_at`, chama o caminho
oficial `MasterTenantsService.applyAction('block')`. Assim, ele reutiliza a projeção comercial,
o incremento de `company_session_version` e todos os gates da Fase 6.2.

Bloqueios administrativos existentes nunca são sobrescritos pela automação. O histórico
financeiro é mutável pelo Master, mas toda criação/alteração e todo bloqueio automático são
registrados na auditoria append-only.

## Notificações automáticas (Fase 6.5)

O mesmo ciclo de automação financeira envia avisos idempotentes (outbox
`master_subscription_notifications`):

| Momento | Tipo | Mensagem |
|---------|------|----------|
| 7 dias antes | `DUE_IN_7` | Seu plano vencerá em 7 dias. |
| 3 dias antes | `DUE_IN_3` | Segundo aviso. |
| No vencimento | `DUE_TODAY` | Pagamento pendente. |
| Após bloqueio automático | `BLOCKED` | Empresa bloqueada. Clique aqui para regularizar. |
| Pagamento confirmado | `PAID_RELEASED` | Pagamento recebido. Sua empresa foi liberada automaticamente |

Canais: inbox do Painel Master + admin da empresa (`master_tenants.admin_email`) +
inbox SaaS (`public.notifications` / NotificationService).
Sem SMTP dedicado, a entrega externa ao admin vai para log (ou `MASTER_NOTIFICATION_WEBHOOK_URL`).
Ao confirmar pagamento, se o bloqueio for `subscription_overdue:*`, o sistema chama
`applyAction('unblock')` e reativa a assinatura `SUSPENDED` — nunca desfaz bloqueio administrativo.

As preferências por empresa ficam em
`master_subscription_notification_preferences`. O Master pode habilitar ou desabilitar:

- entrega externa por e-mail/webhook;
- aviso de 7 dias;
- aviso de 3 dias;
- aviso no vencimento;
- aviso após bloqueio.

Na ausência de configuração, todos os avisos permanecem habilitados. Desabilitar e-mail não
remove o aviso in-app SaaS; desabilitar um tipo de aviso impede sua entrega à empresa, mantendo
o espelho operacional no inbox Master.

## Sessões e bloqueio imediato

Quando `commercial_blocked` passa de `false` → `true`:

1. `company_session_version` é incrementada (migration `020`).
2. JWTs emitidos antes do bump ficam inválidos (`companySessionVersion` no claim).
3. Cookies `pwd_session` / `pwd_csrf` são limpos na próxima requisição autenticada.
4. A API responde `401 COMMERCIAL_BLOCKED_BY_MASTER`.
5. O frontend encerra a sessão e redireciona para `/license-blocked`.

Desbloqueio (`commercial_blocked = false`) **não** reduz a versão: novos logins embutem a versão corrente e funcionam normalmente. Sessões antigas (pré-bloqueio) permanecem inválidas.

O Realtime VPS é polling autenticado (`db.subscribe`); ao receber 401 comercial, a sessão é limpa e o intervalo é cancelado no unmount.

## Arquivos principais

- `backend/src/master/commercial/`
- `backend/src/master/commercial/companySessionRevocation.ts`
- `backend/db/migrations/019_commercial_projection_master_source.sql`
- `backend/db/migrations/020_company_session_version.sql`
- `backend/src/controllers/dataController.ts` (403 comercial)
- `backend/src/middlewares/authMiddleware.ts` (401 sessão bloqueada)
- `backend/src/services/authLoginService.ts` (gate por projeção)
- `src/pages/admin/Company.tsx` (somente leitura comercial)
- `src/pages/LicenseBlockedPage.tsx`
