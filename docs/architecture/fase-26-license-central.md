# FASE 26 — Central de Licenciamento

## Objetivo

Central única de licenciamento no Painel Master, com visão comercial consolidada e mutações exclusivas do Master, integradas ao Commercial Projection Service (Master → SaaS).

## Escopo respeitado

- Sem alteração de REP, RH, Banco de Horas, Espelho, Realtime, Mobile ou auth operacional da empresa.
- Página existente `/master/licenses` evoluída (sem rota nova).
- APIs existentes estendidas por composição (`central` / `items` / `history`).

## O que foi entregue

### Backend

| Item | Detalhe |
|------|---------|
| Composição | `composeLicenseCentral.ts` — empresa, plano, tipo, licença, emissão, expiração, último pagamento, status, bloqueio, limites, versão, histórico |
| Ações | `activate`, `suspend`, `block`, `renew`, `reactivate` (+ legado `unblock`/`expire`/modos) |
| Histórico | Persistido em `meta.history` + audit HTTP; `GET /licenses/:id/history` |
| Limites | `maxEmployees` / `maxDevices` via PATCH/create → `contractedLimits` na projeção comercial |
| Projeção | `CommercialProjectionService` passa limites da licença para `companies` (SaaS read-only) |
| Versão | `master_installations.reported_version` (quando disponível) |
| Pagamento | Última fatura `paid` do Billing Engine por `tenantId` |

### Frontend

- `MasterLicensesPage` reescrita como **Central de Licenciamento**.
- Colunas pedidas + botões Ativar / Suspender / Bloquear / Renovar / Reativar.
- Painel de detalhe + histórico completo.
- Aviso explícito: somente Master altera; SaaS recebe projeção.

### Integração Commercial Projection

Fluxo já wired em `createMasterComposition` (após `action` / `create` / `update` / `setRules`):

```
Master ação de licença → LicenseManagerService → projectCommercialStateToSaas → public.companies
```

Empresa não escreve campos comerciais (proteção já existente em `commercialFields`).

## Verificação

| Check | Resultado |
|-------|-----------|
| `npm run build` (frontend) | OK |
| `npm run lint` | OK (0 errors) |
| `npm run build` (backend) | OK |
| `vitest run src/master` | **100/100** passed |

## Arquivos principais

- `backend/src/master/licenseManager/composeLicenseCentral.ts`
- `backend/src/master/licenseManager/licenseCentral.types.ts`
- `backend/src/master/api/controllers/licenseManager.controllers.ts`
- `backend/src/master/commercial/deriveCommercialProjection.ts`
- `src/master/pages/MasterLicensesPage.tsx`
- `src/master/api/licensesApi.ts`

## Notas

- **Suspender** vs **Bloquear**: ambos usam status `Bloqueada`; distinção em `meta.blockKind` (`suspended` | `blocked`).
- **Reativar**: limpa bloqueio e força `Ativa` (renova validade se estiver expirada).
- Versão instalada fica `—` se `master_installations` estiver vazia ou migration ausente.
- Último pagamento fica `—` se não houver fatura `paid` no Billing Engine para o tenant.
