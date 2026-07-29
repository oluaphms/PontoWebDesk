# Avaliação do protocolo legado REP (`/api/rep/agent-version`)

**Fase 23B — sem alteração automática.** Este documento é apenas análise.

## O que existe hoje

| Aspecto | Control Plane + Updater (Fase 20/23) | REP legado |
|---------|--------------------------------------|------------|
| Endpoint | `/api/update-agent/*` + `/api/master/updates/*` | `GET /api/rep/agent-version` |
| Fonte de versão | `master_releases` (Postgres) | Variáveis de ambiente (`REP_AGENT_*`) |
| Auth | Token por instalação (`uag_*`) | Device key / Bearer REP |
| Download/install | Updater Service Windows | Scripts / agente REP (`scripts/rep-agent-auto-update.mjs` etc.) |
| Assinatura | SHA-256 obrigatório + HMAC/RSA opcional | Campo `signature_kind: sha256+authenticode` (informativo) |
| Histórico / approve | `master_update_requests` + events | Nenhum no Master |

Arquivos relevantes (não modificados nesta fase):

- `backend/src/controllers/repAgentVersionController.ts`
- `backend/src/routes/repRoutes.ts`
- Possíveis consumidores em `scripts/` e pacotes REP

## Por que não unificar agora

1. **Contrato diferente** — REP usa `device_id` e auth de dispositivo; o Updater usa `installation_id` Master.
2. **Componente distinto** — `rep-agent` já é um componente no Control Plane, mas o endpoint legado **não lê** `master_releases`.
3. **Risco operacional** — agentes REP em campo podem depender do endpoint atual; remover ou redirecionar sem migração coordenada quebra auto-update de dispositivos.
4. **Escopo Fase 23B** — regras obrigatórias: **não alterar REP**.

## Caminho seguro sugerido (futuro — requer aprovação)

1. Publicar releases `component=rep-agent` no Control Plane (já suportado).
2. Fazer `repAgentVersionController` **ler** a última release publicada de `rep-agent` quando existir; senão fallback para `REP_AGENT_*` (compat).
3. Migrar o auto-update REP para claim/report do Updater **ou** manter REP Agent baixando via manifesto do Control Plane sem claim (só check de versão).
4. Deprecar `REP_AGENT_DOWNLOAD_URL` após período de dual-write.
5. Só então remover o caminho legado.

## Recomendação Fase 23B

**Manter o protocolo REP legado intacto.**  
Unificação é desejável, mas **não é segura sem plano de migração de frota e período de compatibilidade**. Nenhuma alteração foi aplicada ao REP nesta consolidação.
