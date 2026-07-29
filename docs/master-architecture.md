# Arquitetura do Módulo Master

Documento de estabilização arquitetural. Descreve o estado atual do módulo Master
(frontend + backend + contratos). **Não substitui** regras de negócio em código.

Última auditoria final: 2026-07-26.

---

## 1. Visão geral

O Master é o control plane comercial/operacional do PontoWebDesk:

- autenticação e autorização Master (JWT/sessão separados do app operacional)
- gestão de tenants / empresas
- jornada comercial, automação e provisionamento
- licenciamento e vigência (`CommercialLicenseViewState`)
- assinatura SaaS / finanças
- CRM comercial
- crash safety, recovery e transactions de domínio
- contratos HTTP compartilhados (`@pontowebdesk/master-contract`)

Princípio: **evolução incremental**. Grandes refatorações estruturais do detalhe
comercial já foram concluídas; novas features devem encaixar nos boundaries atuais.

---

## 2. Camadas

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend Master (src/master)                                │
│  Pages → companyDetail presentacionais → useMasterCompany…  │
│  api/* (HTTP clients) → services/* (facades finas)          │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP /api/master/*
┌───────────────────────────▼─────────────────────────────────┐
│ Backend (backend/src/master)                                │
│  routes → middlewares(auth/perm) → controllers → services   │
│  adapters/postgres | memory · tx · crashSafety · recovery   │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│ shared/master-contract  (+ DB / migrations Master)          │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Fluxo comercial (empresa)

1. Cadastro / lead no Master (`tenant_manager`)
2. Contato / CRM
3. Negociação (plano comercial do tenant)
4. Pagamento **manual** no Master (sem gateway obrigatório na automação)
5. Automação: provisiona tenant, empresa operacional, admin, licença
6. Convite / primeiro acesso (etapa independente)
7. Implantação / onboarding visual
8. Assinatura SaaS (ciclo alinhado ao tipo de instalação)

UI de detalhe: `MasterCompanyDetailPage` (orquestrador) + pasta
`src/master/components/companyDetail/`.

---

## 4. Provisionamento

- Serviço canônico: `MasterCompanyProvisioningService`
- Jornada: `CommercialJourneyService`
- Automação: `CommercialAutomationService` (confirmação manual de pagamento)
- Escrita operacional: writer canônico de company operacional
- Locks / idempotência / retries cobertos por testes de hardening

**Single Writer:** criação/reparo de company operacional passa pelo writer de
provisionamento — evitar inserts paralelos ad hoc.

---

## 5. Licenciamento

- Avaliação e view state **somente no backend**
- Contrato canônico: `CommercialLicenseViewState` em `@pontowebdesk/master-contract`
- Frontend **exibe** `licenseValidity.*` — não recalcula vigência
- UI de detalhe: `LicensePanel` (nunca usa `row.status` como proxy de vigência)

---

## 6. Assinatura SaaS

- Planos: `plansApi` / controllers de plans
- Assinatura da empresa distinta do rótulo comercial `row.plano`
- UI: `SubscriptionPanel` + painéis de finance/notification (legados, fetch próprio)
- Ciclo filtrado por `installationType` (mensal SaaS Web / anual on-premise)

---

## 7. Crash Safety & Recovery

- Transações de domínio: `MasterDomainTransaction` / `runMasterDomainTransaction`
- Testes: `backend/src/master/crashSafety/`
- Recovery de órfãos / company operacional: serviços de recovery + integrity tests
- Falhas de e-mail/SMTP e alguns órfãos podem exigir intervenção operacional
  (documentado nos testes/relatórios de crash)

---

## 8. Frontend — detalhe da empresa

### Hook principal

`useMasterCompanyDetail` — **única fonte de estado/ações** da tela de detalhe:

- load / loading / error / refresh
- journey, automation, crmLite, plans/subscription
- ações (status, provisionar, convite, automação, plano, favorito)
- derivações: `unifiedTimeline`, pacotes `quickActions*` / `subscription*`

É um **orquestrador de página** (agrega vários domínios da mesma tela).  
Não é um contexto global. Dividir o hook só faria sentido se as seções
passassem a rotas/páginas independentes.

### Componentes presentacionais (`companyDetail/`)

| Componente | Responsabilidade |
|---|---|
| `CommercialSummaryCard` | Resumo executivo |
| `CommercialPipeline` | Pipeline comercial visual |
| `AutomationPipeline` | Pipeline de automação + callbacks |
| `TechnicalProvisionPanel` | Checklist técnico |
| `LicensePanel` | Vigência (`licenseValidity`) |
| `SubscriptionPanel` | Assinatura SaaS |
| `CRMPanel` | Wrapper do CRM existente |
| `UnifiedTimeline` | Timeline única cronológica |
| `CustomerHealthPanel` | Saúde (indisponível se sem dado) |
| `QuickActionsPanel` | Ações concentradas |
| `TechnicalLogsPanel` | Logs/IDs (accordion) |
| `DetailField` / `displayFormat` | Primitivos de UI |

Barrel: `src/master/components/companyDetail/index.ts`.

Regras dos presentacionais:

- sem `fetch` / `axios` / `useEffect` de dados
- sem cópia de estado de API
- props (ou `{ data, actions }`) vindas do hook

**Resíduo aceito:** `MasterCompanyCrmPanel` (usado por `CRMPanel`) ainda busca CRM
internamente — componente legado reutilizado de propósito; não faz parte do hook.

---

## 9. Contratos (Master Contract)

Pacote: `shared/master-contract`

- `commercialLicenseViewState.ts` — campos canônicos de vigência
- `tenant.ts`, `license.ts`, `dashboard.ts`
- Governança: testes em `backend/src/master/contract/` + HTTP `masterApi.http.test.ts`
- Endpoints que expõem validity devem reportar violações via validators do backend

---

## 10. Fluxo de dados (detalhe)

```
companyId (rota)
    → useMasterCompanyDetail.load()
        → MasterTenantsService.get
        → fetchCommercialJourney / Automation
        → fetchTenantCrm (lite)
        → fetchSaasPlans + fetchCompanyPlanSubscription
    → props estáveis (memo) → painéis presentacionais
    → ações → APIs existentes → refresh parcial/total no hook
```

Nenhum painel novo deve introduzir segunda fonte de verdade para essa tela.

---

## 11. Auth / permissões

- Login Master separado do operacional
- Middlewares: `requireMasterLogin`, `requireMasterPermission`
- FE: `hasMasterPermission(...)` para gates de UI (assinatura/finance)
- Não misturar sessão Master com `AuthSessionProvider` operacional
  (`MasterBootstrap` documenta isso)

---

## 12. Testes de arquitetura relevantes

- Contract / HTTP contract
- Crash safety
- Provisioning (+ hardening)
- Integrity operacional/estrutural
- Auth / founder protection (quando aplicável)

Rodar a partir de `backend/` com os scripts Vitest do pacote.

---

## 13. Dívida técnica não crítica (conhecida)

| Item | Natureza | Ação |
|---|---|---|
| Wrappers `@deprecated` no BE (BillingService, etc.) | Compatibilidade | Manter até remoção planejada |
| CRM panel com fetch próprio | Legado reutilizado | Incremental se unificar CRM no hook |
| Aliases de tipos de licença | Compat | Não remover sem migração de imports |

Nenhum desses itens bloqueia estabilização arquitetural.

---

## 14. Política de evolução

A arquitetura do módulo Master pode ser considerada **estabilizada**.

Novas evoluções devem ocorrer por meio de **funcionalidades incrementais** e
**correções pontuais**, evitando novas grandes refatorações estruturais.
