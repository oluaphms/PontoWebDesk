# FASE 27 — Central de Atualizações

## Objetivo

Painel operacional do Updater no Master: visão de versões, canais, contagens de clientes e ações administrativas — **sem executar atualização no navegador**.

## Escopo respeitado

- Sem alteração de REP, RH, Banco de Horas, Espelho, Realtime, Mobile ou auth operacional.
- Página existente `/master/updates` evoluída (sem rota paralela).
- Execução continua exclusiva do **Update Agent** (`/api/update-agent/*`).
- Ações `complete` / `fail` / `prepare_manual` permanecem bloqueadas no browser (403 AGENT_ONLY).

## Entregue

### Backend

| Item | Detalhe |
|------|---------|
| Snapshot | `GET /api/master/updates/central` → `composeUpdatesCentral` |
| Contagens | Atualizados, Pendentes, Executando, Falharam, Rollback |
| Canais | Stable, Beta, **Release Candidate (`rc`)** |
| Tabela enriquecida | `lastUpdateAt` em instalações (último request `completed`) |
| Histórico | `GET /updates/history?installationId=&requestId=` |
| Migration | `025_master_update_channel_rc.sql` (+ mirror supabase) |

### Frontend (`MasterUpdatesPage`)

- KPIs: versão atual, última release, canais, contagens
- Tabela: Empresa, Versão, Canal, Status, Último heartbeat, Última atualização
- Botões: **Aprovar**, **Cancelar**, **Reenviar** (`retry`), **Histórico**
- Banner Agent-only explícito

### Mapeamento de status operacional

| UI | Origem |
|----|--------|
| Pendente | `requested` ou instalação `outdated` sem execução |
| Executando | `approved` / `manual_required` (claim do agente) |
| Falhou | último request `failed` |
| Rollback | request `kind=rollback` ativo |
| Atualizado | SemVer `current` |

## Verificação

| Check | Resultado |
|-------|-----------|
| `npm run build` (frontend) | OK |
| `npm run lint` | OK (0 errors) |
| `npm run build` (backend) | OK |
| `vitest run src/master` | **103/103** passed |

## Arquivos principais

- `backend/src/master/updates/composeUpdatesCentral.ts`
- `backend/src/master/updates/UpdateControlPlaneService.ts`
- `backend/src/master/api/controllers/updateControlPlane.controllers.ts`
- `backend/db/migrations/025_master_update_channel_rc.sql`
- `src/master/pages/MasterUpdatesPage.tsx`
- `src/master/api/updatesApi.ts`

## Garantia Agent-only

O Master **só** aprova/cancela/reenvia. O fluxo de execução permanece:

```
Master approve → Agent heartbeat → claim → download → verify → backup → install → restart → health → completed
```
