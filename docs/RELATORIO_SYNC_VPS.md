# Relatório de sincronização da VPS

**Data:** 2026-08-04  
**Alvo:** `root@177.7.51.209` / `srv1694106.hstgr.cloud`  
**Contexto:** VPS esteve desligada por falta de pagamento e foi reativada hoje. Ausência de migrations/endpoints novos = **atraso de sync**, não defeito.

## Status

| Etapa | Status | Evidência |
|-------|--------|-----------|
| 1. Acesso SSH | **BLOQUEADO** | `Permission denied (publickey,password)` — sem chave em `~/.ssh`, BatchMode sem senha |
| 2. Backup do banco | **NÃO EXECUTADO** | Dependente de SSH |
| 3. Atualizar código (`git pull`) | **NÃO EXECUTADO** | Dependente de SSH |
| 4. Instalar dependências | **NÃO EXECUTADO** | Dependente de SSH |
| 5. Migrations pendentes | **NÃO EXECUTADO** | 041–043 ainda fora do remote Git |
| 6. Validar erros de migrate | **NÃO EXECUTADO** | — |
| 7. Comparar estrutura local × VPS | **NÃO EXECUTADO** | Postgres 5432 fechado externamente (correto); só via tunnel SSH |

## Observações de rede (pré-sync)

| Porta | Host | Resultado |
|-------|------|-----------|
| 22 | 177.7.51.209 | OPEN |
| 443 / 80 / 3000 | API host | OPEN |
| 5432 | VPS | closed (só localhost) |
| 6379 | VPS | closed |

## API atual (pré-sync)

| Endpoint | Resultado |
|----------|-----------|
| `GET /api/health` | **200** `{"status":"ok","db":"connected"}` |
| `GET /api/health/db` | **200** |
| `GET /api/health/time` | **200** |
| `GET /api/health/ready` | **404** `not_found` — código antigo em execução |
| `GET /api/health/live` | **404** `not_found` — código antigo em execução |

Nota: `origin/main` já tem `ready`/`live`. Após pull + build + `pm2 restart` esses endpoints devem passar a responder.

## Bloqueio

**Causa:** sem credencial SSH (senha root ou chave privada).  
**Correção:** fornecer acesso SSH; em seguida executar backup → pull → npm ci/build → `db:migrate:full` → restart → revalidar.

## Pré-requisito Git (paralelo)

Push de `041`–`043` para `origin/main` antes do `git pull` na VPS (ou SCP desses 3 arquivos).
