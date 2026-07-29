# FASE 33 — Onboarding Inteligente

## Objetivo

Transformar o Wizard / detalhe da empresa em um **assistente visual de implantação**, exibindo a jornada completa com progresso, pendências, etapa atual, quem executou, tempos e timeline — **somente com dados já existentes**.

## Escopo

- Apenas `src/master` (frontend Master).
- Sem novas regras de negócio, APIs, migrations ou alterações no operacional.
- Funcionário / batida: exibidos como **pendentes** (dados ainda não expostos no Master).

## Jornada visual

1. Empresa criada  
2. Administrador criado  
3. Plano definido  
4. Licença ativa  
5. Primeiro acesso enviado  
6. Primeiro Login realizado  
7. Primeiro funcionário cadastrado *(pendente — sem fonte Master)*  
8. Primeira batida registrada *(pendente — sem fonte Master)*  
9. Empresa operacional  

## Fontes reutilizadas

- `CommercialJourney` + `steps` + timestamps (`inviteSentAt`, `firstLoginAt`, …)
- `DeploymentWizard.summary` / `wizardSteps` / `progressPercent`
- `CommercialAutomation.state.timeline` (quem: automático vs manual)
- CRM (`lastAccessAt`, `deploymentDate`) como referência complementar
- `MasterCompanyRow` (cadastro / plano / admin)

## UI

| Elemento | Onde |
|----------|------|
| Fluxo com setas ↓ | `MasterIntelligentOnboarding` |
| Barra de progresso | idem |
| Tempo médio / decorrido | timestamps existentes |
| Pendências + etapa atual | chips + highlight |
| Quem executou | automação / e-mail admin |
| Timeline jornada + automação | `MasterVisualTimeline` |
| Detalhe da empresa | painel onboarding |
| Página do wizard | painel compacto no topo |

## Arquivos

- `src/master/ux/deriveIntelligentOnboarding.ts` (+ teste)
- `src/master/components/MasterIntelligentOnboarding.tsx`
- `src/master/components/MasterVisualTimeline.tsx` (pending visual)
- `src/master/pages/MasterCompanyDetailPage.tsx`
- `src/master/pages/MasterImplantationWizardPage.tsx`

## Confirmação

Nenhuma funcionalidade removida. Nenhuma regra comercial nova. Automação FASE 30 e wizard FASE 28 intactos.

## Validação final (2026-07-20)

| Comando | Resultado |
|---------|-----------|
| `npm run build` | OK |
| `npm run lint` | OK |
| `npx vitest run` | OK — **148** arquivos / **680** testes (inclui `deriveIntelligentOnboarding.test`) |
