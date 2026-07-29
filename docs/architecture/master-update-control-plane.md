# Control Plane de atualizações — Fase 20

O Painel Master centraliza catálogo de versões, changelog, instalações,
solicitações de atualização/rollback e histórico.

## Modelo persistente

- `master_releases`: versões SemVer por componente/canal, changelog, artefato e SHA-256.
- `master_installations`: versão reportada por empresa e componente.
- `master_update_requests`: workflow administrativo de atualização ou rollback.
- `master_update_events`: histórico append-only.

Migration: `backend/db/migrations/021_master_update_control_plane.sql`.

## Classificação

Uma instalação é:

- `current`: versão reportada igual ou superior à release publicada;
- `outdated`: versão reportada menor que a release publicada;
- `unknown`: versão ausente ou inválida.

Versões são comparadas por SemVer estrito. Valores como `rep-agent.mjs` e
timestamps de build não são tratados como versões.

## Workflow seguro

```text
requested → approved → manual_required → completed
                                 └──────→ failed → manual_required
requested/approved/manual_required/failed → cancelled
```

Concluir uma solicitação confirma manualmente a versão instalada. Rollback só é
oferecido quando a release atual referencia explicitamente uma release anterior.

## Limite desta fase

O Control Plane não envia comandos nem executa URLs/binários no cliente. A
execução automática requer a Fase 21:

1. artefato assinado;
2. download para staging;
3. validação SHA-256 e Authenticode;
4. backup local;
5. troca atômica e reinício;
6. health check;
7. rollback local;
8. confirmação assinada ao Master.

Até essa integração, “Atualizar” cria uma solicitação auditável e gera o fluxo
manual. Isso evita apresentar alteração de metadado como atualização real.

## Endpoints

- `GET/POST /api/master/updates/releases`
- `POST /api/master/updates/releases/:id/actions/:action`
- `GET/POST /api/master/updates/installations`
- `GET/POST /api/master/updates/requests`
- `POST /api/master/updates/requests/:id/actions/:action`
- `GET /api/master/updates/history`

Todas as rotas usam autenticação Master e permissões `deployments:read/write`.

