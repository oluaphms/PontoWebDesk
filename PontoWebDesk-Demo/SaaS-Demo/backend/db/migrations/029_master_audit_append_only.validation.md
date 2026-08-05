# Fase 5.1 — Validação: master_audit append-only

**Data:** 2026-07-21  
**Escopo:** somente imutabilidade de `public.master_audit`  
**Compatibilidade:** API pública, frontend e formato dos registros **não alterados**

## Resultado

| Controle | Estado |
|---|---|
| Trigger bloqueia UPDATE | Implementado |
| Trigger bloqueia DELETE | Implementado |
| Trigger bloqueia TRUNCATE | Implementado |
| Repository sem UPSERT/UPDATE/DELETE/clear | Implementado |
| Dual-write PG sem sobrescrita | Implementado |
| API / frontend / schema de colunas | Sem mudanças |

## Migrations criadas

| Arquivo | Papel |
|---|---|
| `backend/db/migrations/029_master_audit_append_only.sql` | Fonte canônica |
| `supabase/migrations/20260721170000_master_audit_append_only.sql` | Espelho Supabase |

## Triggers criadas

| Trigger | Evento | Nível |
|---|---|---|
| `trg_master_audit_append_only_row` | `BEFORE UPDATE OR DELETE` | `FOR EACH ROW` |
| `trg_master_audit_append_only_truncate` | `BEFORE TRUNCATE` | `FOR EACH STATEMENT` |

Função: `public.master_audit_append_only()`  
Erro explícito: `master_audit is append-only (Fase 5.1): <TG_OP> not allowed` (`ERRCODE 42501`)

## Privilégios aplicados

- `REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.master_audit FROM PUBLIC`
- Loop em roles com login (não-superuser): `REVOKE UPDATE, DELETE, TRUNCATE` (best-effort)
- `SELECT` / `INSERT` existentes preservados
- Autorização de leitura Master permanece na API (`audit:read`) — sem mudança de matriz de papéis nesta fase

## Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `backend/src/master/adapters/postgres/MasterAuditRepository.ts` | INSERT puro; removidos `ON CONFLICT DO UPDATE` e `clear()` |
| `backend/src/master/registry/MasterRepositoryRegistry.ts` | Dual-write sem DELETE no PG; `clear()` só buffer InMemory |
| `backend/src/master/adapters/postgres/postgresRepositories.test.ts` | Teste append-only (sem clear/UPSERT) |
| Migrations 029 (+ espelho Supabase) | Trigger + REVOKE |

## Validação executada

- `npx tsc -p tsconfig.json --noEmit` — OK
- `vitest` postgresRepositories + registry + audit.service — OK
- Grep no repository: sem `ON CONFLICT`, `DO UPDATE`, `DELETE FROM`, `TRUNCATE`, `.clear(`
- Aplicação da migration no Postgres local: **pendente** (`DATABASE_URL` placeholder no `.env`)

### Como validar no banco (após aplicar 029)

```sql
INSERT INTO public.master_audit (id, action, resource, message)
VALUES ('aud_probe', 'PROBE', 'audit', 'ok'); -- deve OK

UPDATE public.master_audit SET message = 'x' WHERE id = 'aud_probe';
-- ERROR: master_audit is append-only (Fase 5.1): UPDATE not allowed

DELETE FROM public.master_audit WHERE id = 'aud_probe';
-- ERROR: master_audit is append-only (Fase 5.1): DELETE not allowed

TRUNCATE public.master_audit;
-- ERROR: master_audit is append-only (Fase 5.1): TRUNCATE not allowed
```

## Notas

- Buffer InMemory (`AuditService.clear`) continua apenas para isolamento de testes / restart de processo; **não** apaga `public.master_audit`.
- Admin Master pela API já não tinha endpoint de edição/exclusão de audit; a proteção agora é também no banco.
