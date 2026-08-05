# Fase 5.2 — Consulta escalável da auditoria Master

**Data:** 2026-07-21
**Objetivo:** substituir leitura em memória por consulta direta ao PostgreSQL, com filtros server-side, paginação, ordenação e cursor. Sem alterar estrutura da auditoria nem a API pública existente.

## Leitura: memória → PostgreSQL

| Caminho | Antes | Depois |
|---|---|---|
| `GET /audit` | `AuditService.list()` (buffer 2000) | `MasterAuditRepository.query()` (PG direto) em modo postgres |
| `GET /logs` (bloco audit) | `AuditService.list()` | `audit.query({ limit })` (PG direto) |
| Modo memory (testes) | buffer | `AuditService.query()` — mesma semântica |

O buffer InMemory permanece apenas como fonte no modo `memory` e para hidratação; nenhuma leitura HTTP depende dele quando `MASTER_PERSISTENCE=postgres`.

## Filtros server-side

`from`, `to` (período), `companyId`, `actor` (id exato **ou** e-mail parcial), `ip` (parcial), `action` (prefixo), `resource` (exato), `result` (`success` | `failure` | `all`, derivado da ação — sem coluna nova).

## Paginação / ordenação / cursor

- **Offset:** `limit` (1–500, default 100) + `offset`.
- **Cursor keyset:** base64 de `"<at>|<id>"`; predicado `(at, id) < (cursor)` (desc) evita `OFFSET` grande.
- **Ordenação:** `order=asc|desc` sobre `(at, id)`.
- Resposta inclui `pagination { total, limit, offset, order, nextCursor, hasMore }`, mantendo também `audit` e `count`.

## Migrations criadas

| Arquivo | Conteúdo |
|---|---|
| `backend/db/migrations/030_master_audit_query_indexes.sql` | Índices de consulta |
| `supabase/migrations/20260721180000_master_audit_query_indexes.sql` | Espelho Supabase |

## Índices criados

| Índice | Uso |
|---|---|
| `idx_master_audit_at_id_desc (at DESC, id DESC)` | ordenação + keyset |
| `idx_master_audit_resource_at (resource, at DESC)` | filtro resource + período |
| `idx_master_audit_company (company_id, at DESC)` | (028) filtro empresa |
| `idx_master_audit_actor (actor_user_id, at DESC)` | (028) filtro ator |
| `idx_master_audit_action (action, at DESC)` | (028) filtro action/result |
| `idx_master_audit_ip_trgm` / `_actor_email_trgm` | ILIKE parcial (se `pg_trgm` presente) |

## Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `backend/src/master/api/services/audit.service.ts` | modelo de query, cursor, classificação de resultado, `AuditService.query` |
| `backend/src/master/adapters/postgres/MasterAuditRepository.ts` | `query()` PG (filtros + keyset + offset) |
| `backend/src/master/registry/MasterRepositoryRegistry.ts` | porta `audit.query` (PG direto / memória) |
| `backend/src/master/api/services/index.ts` | `queryAudit()`; `getLogs` usa `query` |
| `backend/src/master/api/controllers/masterApi.controllers.ts` | parsing de filtros em `GET /audit` |
| `backend/src/master/api/openapi/master.openapi.ts` | parâmetros do `/audit` |
| `src/master/api/masterApi.ts` | `fetchMasterAudit()` + tipos (compatível) |
| Migrations 030 (+ espelho) | índices |

## Compatibilidade

- `GET /audit` continua retornando `audit` + `count`; novos campos são aditivos.
- `GET /logs` inalterado no shape; `MasterAdminPage` não muda.
- Estrutura de colunas da auditoria intacta (append-only da Fase 5.1 preservado).

## Testes de performance

`src/master/api/services/masterAuditQuery.perf.test.ts`:

- 500 consultas filtradas+paginadas sobre 2000 registros → **mediana < 25 ms**, **p95 < 60 ms** (na prática sub-ms).
- Varredura completa por cursor (2000 registros) sem repetição → **< 500 ms**, cobre 100% do conjunto.

Suíte relacionada (28 testes) e `tsc --noEmit`: OK.

### Load test em banco real (quando `DATABASE_URL` estiver configurado)

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM public.master_audit
WHERE company_id = $1 AND at >= $2 AND at <= $3
ORDER BY at DESC, id DESC
LIMIT 100;
-- Esperado: Index Scan em idx_master_audit_company / idx_master_audit_at_id_desc
```

Keyset (página seguinte):

```sql
SELECT * FROM public.master_audit
WHERE (at, id) < ($cursorAt, $cursorId)
ORDER BY at DESC, id DESC
LIMIT 100;
```

## Observações

- Banco local com `DATABASE_URL` placeholder: aplicar migrations 029 e 030 no ambiente alvo.
- `result` é derivado da ação (regex `FAILED|DENIED|REVOKED|REUSE|INVALID|ERROR|EXPIRED|BLOCKED|REJECT`), sem coluna nova.
