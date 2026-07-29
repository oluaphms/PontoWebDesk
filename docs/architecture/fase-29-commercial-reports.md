# FASE 29 — Central de Relatórios Comerciais

## Objetivo

Central única de relatórios no menu **Relatórios** (`/master/finance`), com KPIs comerciais, tabelas detalhadas, filtro por período e exportação CSV / Excel / PDF.

## Escopo respeitado

- Sem alteração de REP, RH, Banco de Horas, Espelho, Realtime, Mobile ou auth operacional.
- Evolução de `MasterFinancePage` + `GET /api/master/finance` (sem rota paralela).
- Composição somente-leitura sobre tenants, CRM, billing, licenças, updates e jornada.

## Indicadores disponíveis

| Relatório | Fonte |
|-----------|--------|
| Empresas por cidade | CRM (`master_crm_profiles.city`) |
| Empresas por plano | Tenants (`plan`) |
| Clientes ativos / bloqueados / teste | Tenant status / plan |
| Receita mensal / anual | Billing Engine (faturas `paid`) |
| Licenças vencendo | License Manager (`expiryWarning`) |
| Empresas sem login | Onboardings (`first_login_at` null) |
| Empresas sem atualização | Update Central (outdated/pending) |
| Atualizações realizadas / com falha | Update requests |
| Implantações concluídas | `implantation_completed_at` |

## Exportação

- **CSV** — UTF-8 BOM, delimitador `;`
- **Excel** — `xlsx` (abas Relatorios + KPIs)
- **PDF** — `jspdf` + `autotable`

## Filtro de período

Query `?from=&to=` em `GET /finance` aplica-se a receita, updates e implantações.

## Verificação

| Check | Resultado |
|-------|-----------|
| Build frontend | OK |
| Lint | OK (0 errors) |
| Build backend | OK |
| Testes Master | **111/111** |

## Arquivos principais

- `backend/src/master/reports/composeCommercialReports.ts`
- `backend/src/master/reports/commercialReports.types.ts`
- `backend/src/controllers/master/financeController.ts`
- `src/master/pages/MasterFinancePage.tsx`
- `src/master/api/financeApi.ts`
- `src/master/utils/commercialReportExport.ts`
