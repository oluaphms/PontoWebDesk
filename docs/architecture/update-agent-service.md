# Fase 23 — Agente de Atualização (LOCAL / HYBRID)

## Objetivo

Executar atualizações fora do navegador, como serviço Windows (`PontoWebDesk Updater Service`).

A Fase 20 entregou o Control Plane administrativo (releases, instalações, requests, histórico).  
A Fase 23 entrega o **protocolo de agente** + o **binário/serviço** que executa.

## Separação de responsabilidades

| Camada | Responsável | Onde |
|--------|-------------|------|
| Catálogo / aprovação | Master Panel (humano) | `/api/master/updates/*` |
| Execução | Updater Service | `/api/update-agent/*` + `updater-agent/` |
| Auth operacional SaaS | AuthSessionProvider | **intocado** |

## Protocolo

### Autenticação

- Token `uag_*` emitido por `POST /api/master/updates/installations/:id/agent-token`
- Persistido apenas o hash SHA-256
- Middleware `requireUpdateAgentAuth` — namespace isolado

### Endpoints do agente

1. `POST /api/update-agent/heartbeat` — versão, fingerprint, health, solicitações disponíveis
2. `POST /api/update-agent/claim` — claim atômico + manifesto (URL, sha256, signature)
3. `POST /api/update-agent/report` — estágios: downloading → verified → backup → install → restart → health → completed|failed|rolling_back

### Schema (migration 023)

- Colunas aditivas em `master_installations` (machine, health)
- Colunas aditivas em `master_releases` (signature)
- `master_update_agent_tokens`
- `master_update_executions` (claim, lease, stage, result)

## Ciclo do agente

```
heartbeat → claim → download → verify → backup
→ install → restart → health_check → completed
                 ↘ falha → rolling_back → restore → failed
```

## O que NÃO fica no navegador

- Download do artefato
- Verificação de assinatura
- Backup / restore
- Restart de serviços Windows
- Health pós-restart
- Rollback automático

O Master Panel continua sendo apenas o painel de controle (criar release, aprovar request, ver histórico).

## Consolidação Fase 23B

- `completed` / `failed` / claim (`manual_required`) só pelo Updater Agent
- Publish exige `artifactUrl` HTTPS + SHA-256; assinatura se `MASTER_UPDATE_REQUIRE_SIGNATURE` ou algoritmo ≠ sha256
- Master UI: fluxo automático (sem “Concluir” / “Fase 21”)
- Checksum de backup ignora `backup.meta.json` (rollback restaurável)
- REP legado: avaliado em `rep-update-legacy-evaluation.md` — **mantido** sem unificação automática
