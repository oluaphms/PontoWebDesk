# FASE 28 — Wizard de Implantação

## Objetivo

Assistente passo a passo no Painel Master para implantar um cliente, com barra de progresso, validações por etapa e retomada de implantação interrompida.

## Escopo respeitado

- Sem alteração de REP, RH, Banco de Horas, Espelho, Realtime, Mobile ou auth operacional da empresa (além do provisionamento admin já existente na jornada).
- Evolução da jornada comercial (`CommercialJourneyService`) — sem sistema paralelo.
- Update Agent: apenas emissão de token; execução continua fora do navegador.

## Etapas

| # | Etapa | API |
|---|--------|-----|
| 1 | Cadastrar empresa | `register_company` |
| 2 | Criar administrador | `create_admin` |
| 3 | Escolher plano | `choose_plan` |
| 4 | Gerar licença | `generate_license` |
| 5 | Enviar primeiro acesso | `send_first_access` |
| 6 | Gerar Token do Update Agent | `issue_agent_token` (SaaS pode dispensar) |
| 7 | Finalizar implantação | `finalize` → status **Implantação concluída** |

## Endpoints

```
GET  /api/master/tenants/:id/wizard
POST /api/master/tenants/:id/wizard/steps/:step
```

Compat: `GET/POST …/journey*` permanece; snapshot inclui `wizard`.

## UI

- Rota: `/master/tenants/:companyId/implantacao`
- Após `POST /tenants` (nova empresa) → redireciona ao wizard
- Detalhe do cliente: card “Assistente de Implantação” + progresso + CTA Continuar/Abrir
- Barra de progresso + lista de etapas + formulários por etapa
- Token `uag_*` exibido uma única vez (copiar)

## Persistência

Migration `026_master_deployment_wizard.sql`:

- `wizard_meta` (installationId, agentTokenIssuedAt, agentSkipped, …)
- `implantation_completed_at`

## Ao concluir

- Empresa operacional criada
- Licença ativa (+ projeção comercial)
- Administrador provisionado
- Primeiro acesso enviado
- Updater registrado (ou dispensado em SaaS)
- Status: **Implantação concluída**

## Verificação

| Check | Resultado |
|-------|-----------|
| Build frontend | OK |
| Lint | OK (0 errors) |
| Build backend | OK |
| Testes Master | **107/107** |

## Arquivos principais

- `backend/src/master/journey/deploymentWizard.ts`
- `backend/src/master/journey/CommercialJourneyService.ts`
- `backend/src/master/api/controllers/commercialJourney.controllers.ts`
- `backend/db/migrations/026_master_deployment_wizard.sql`
- `src/master/pages/MasterImplantationWizardPage.tsx`
- `src/master/api/companiesApi.ts`
