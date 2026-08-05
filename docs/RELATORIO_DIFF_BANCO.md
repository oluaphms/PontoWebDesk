# Relatório de diferenças — banco local × VPS

**Data:** 2026-08-04  
**Local:** Docker `pg16-restore` → `127.0.0.1:55432` / DB `pontowebdesk`  
**VPS:** não inventariado nesta sessão (SSH indisponível)

## Inventário LOCAL (baseline)

| Objeto | Contagem |
|--------|----------|
| tables | 159 |
| views | 8 |
| indexes | 576 |
| triggers | 63 |
| functions | 147 |
| constraints | 1337 |
| foreign keys | 97 |
| RLS policies (todas) | 115 |
| policies `vps_%` | 109 |
| extensions | 3 (`pgcrypto`, `plpgsql`, `uuid-ossp`) |

### Ledger `_schema_migrations` (local) — entradas `backend/%`

Apenas parcialmente refletidas no ledger (amostra aplicada até ~008). Schema operacional amplo veio também de migrations `supabase/*` (232 entradas no ledger). Policies `vps_%` = 109 indicam efeito de RLS completo no local, mesmo com ledger backend incompleto para 009–043.

## Inventário VPS

| Objeto | Contagem |
|--------|----------|
| (todos) | **N/D — SSH bloqueado** |

## Diferenças

| Item | Diferença |
|------|-----------|
| Comparação automática | **IMPOSSÍVEL nesta sessão** |
| Causa | Sem SSH / Postgres não exposto |
| Esperado pós-sync | VPS deve convergir para baseline local (incl. 041–043 e 109 `vps_%`) |

## Como fechar este relatório (após SSH)

```bash
# Na VPS, com DATABASE_URL carregada:
psql "$DATABASE_URL" -c "
SELECT 'tables', count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'
UNION ALL SELECT 'views', count(*) FROM information_schema.views WHERE table_schema='public'
UNION ALL SELECT 'indexes', count(*) FROM pg_indexes WHERE schemaname='public'
UNION ALL SELECT 'triggers', count(*) FROM information_schema.triggers WHERE trigger_schema='public'
UNION ALL SELECT 'functions', count(*) FROM information_schema.routines WHERE routine_schema='public'
UNION ALL SELECT 'constraints', count(*) FROM information_schema.table_constraints WHERE constraint_schema='public'
UNION ALL SELECT 'fks', count(*) FROM information_schema.table_constraints WHERE constraint_schema='public' AND constraint_type='FOREIGN KEY'
UNION ALL SELECT 'rls', count(*) FROM pg_policies WHERE schemaname='public'
UNION ALL SELECT 'vps_rls', count(*) FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'vps_%'
UNION ALL SELECT 'ext', count(*) FROM pg_extension;
"
```

Diff = comparar cada linha com a tabela LOCAL acima.
