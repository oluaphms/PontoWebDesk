# FASE 31 — Simplificação do Painel Master (operação comercial manual)

## Objetivo

Reorganizar apenas o **frontend** do módulo Master (`src/master`) para um painel comercial simples, **sem remover** rotas, APIs, serviços, controllers, repositórios, migrations ou automações.

## Escopo respeitado

- Sem alterações no sistema operacional (REP, Espelho, BH, Portaria 671, Realtime, Mobile, RH).
- Sem alterações em autenticação da empresa, Control Plane ou Updater Agent.
- Sem remoção de tabelas, migrations, backends ou funcionalidades — apenas ocultação na navegação diária.
- URLs diretas das páginas ocultas continuam funcionando.

## Menu lateral (visível)

1. Dashboard  
2. Empresas  
3. Licenças  
4. Pagamentos  
5. Relatórios  
6. Configurações  
7. *(separador)* Atualizações  
8. Abrir PontoWebDesk / Sair (layout)

## Páginas ocultadas da navegação (preservadas por URL)

Gateway, Deploy, Feature Flags, Storage, Sync, Health, Administração Global, Logs, Auditoria, Status da API/Banco/Agentes, Sincronização, Cobranças, Faturas, PIX Manager, Assinaturas, Segurança, Hub.

## Arquivos principais alterados

| Arquivo | Mudança |
|---------|---------|
| `src/master/menu.ts` | `MASTER_DAILY_MENU` + `MASTER_HIDDEN_MENU` |
| `src/master/components/MasterSidebar.tsx` | Usa menu diário + separador |
| `src/master/layouts/MasterLayout.tsx` | Sub-nav de pagamentos só em `/master/payments` |
| `src/master/MasterApp.tsx` | Rota `/master/settings` (demais rotas intactas) |
| `src/master/pages/MasterSettingsPage.tsx` | Nova — configs comerciais do dia a dia |
| `src/master/pages/MasterDashboardPage.tsx` | KPIs comerciais apenas |
| `src/master/pages/MasterCompaniesPage.tsx` | CRM + ações Abrir/Editar/Bloquear/Desbloquear/Renovar/Contato |
| `src/master/pages/MasterCompanyDetailPage.tsx` | Âncora CRM + Renovar → Licenças |
| `src/master/pages/MasterLicensesPage.tsx` | Desbloquear + Histórico na UI |
| `src/master/components/MasterPaymentsNavigation.tsx` | Banner confirmação manual |
| `src/master/pages/MasterPaymentsPage.tsx` | Fluxo PIX externo / Confirmar Pagamento |
| `src/master/index.ts` | Export `MASTER_HIDDEN_MENU` |

## Confirmação

Nenhuma funcionalidade backend/API foi removida. A automação da FASE 30 permanece após confirmação manual de pagamento.

## Validação final (2026-07-20)

| Comando | Resultado |
|---------|-----------|
| `npm run build` | OK (vite production, ~44s) |
| `npm run lint` | OK (exit 0) |
| `npm test` | OK — **147** arquivos, **678** testes |

Sem regressões detectadas nestas validações.
