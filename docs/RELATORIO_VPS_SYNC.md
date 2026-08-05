# RELATORIO_VPS_SYNC.md

**Modo:** READ ONLY — nenhum objeto alterado na VPS nem no Git  
**Data:** 2026-08-04  
**Escopo:** sincronização banco VPS × código atual (`origin/main` = `2da240e`)  
**Contexto:** VPS reativada hoje após período desligada; migrations nunca aplicadas na VPS são **esperadas**, não bug.

---

## 0. Premissas e limites desta auditoria

| Fonte | Estado observado |
|-------|------------------|
| `D:\PontoWebDesk` | `main` **clean**, **48 commits atrás** de `origin/main` (`77a1fab` → `2da240e`). Disco local desse clone só tem migrations **002–016**. |
| `origin/main` | Referência de “código atual” do remoto. Migrations backend **002–040** (41 `.sql`). |
| `D:\PontoWebDesk_Local` | Working tree suja; contém também **041–043** no disco, **ainda não presentes em `origin/main`**. |
| SSH `root@177.7.51.209` | **FAIL** — `Permission denied (publickey,password)`. Sem chave em `~/.ssh`. |
| Postgres VPS `:5432` | Fechado externamente (esperado). Inventário live do banco VPS = **inacessível nesta sessão**. |
| Baseline local | Docker `pg16-restore` (`127.0.0.1:55432`) usado só como **referência de destino** pós-sync. |

**Conclusão de acesso:** não foi possível ler `_schema_migrations` nem o catálogo da VPS. Itens 4–9 abaixo marcam **N/D (VPS)** onde falta evidência live; o plano SQL de sync está na seção 12.

---

## 1. Migrations existentes no projeto

### 1.1 Backend — `backend/db/migrations/*.sql` em `origin/main` (código atual remoto)

Lista completa (41 arquivos; **não há `001`** — numeração começa em `002`):

```
002_employees_rh_fields.sql
003_api_local_auth.sql
004_employees_password_hash.sql
005_device_credentials_encryption.sql
005_token_revocation_audit.sql
006_rls_tenant_policies.sql
007_employees_role_column.sql
008_punches_photo_url.sql
009_users_status_soft_delete.sql
010_access_profile_role.sql
011_access_profile_admin_gerente.sql
011_employees_id_default.sql
012_afd_imports.sql
013_global_settings_password_policy.sql
014_global_settings_company_id.sql
015_global_settings_maintenance_mode.sql
016_vps_rls_tenant_isolation.sql
017_vps_rls_fail_closed.sql
018_master_persistence.sql
019_commercial_projection_master_source.sql
020_company_session_version.sql
021_master_update_control_plane.sql
022_master_commercial_journey.sql
023_update_agent_protocol.sql
024_master_crm.sql
025_master_update_channel_rc.sql
026_master_deployment_wizard.sql
027_master_auth_persistence.sql
028_master_audit_enrichment.sql
029_master_audit_append_only.sql
030_master_audit_query_indexes.sql
031_master_saas_plans.sql
032_master_subscription_finance.sql
033_master_subscription_notifications.sql
034_master_subscription_notification_preferences.sql
035_master_installation_type.sql
036_master_founder_protection.sql
037_master_company_create_exclusive.sql
038_master_first_access_invite_hardening.sql
039_fix_work_shifts_bootstrap_compat.sql
040_master_local_license_deployments.sql
```

### 1.2 Arquivos presentes só no disco `PontoWebDesk_Local` (fora de `origin/main`)

```
041_departments_id_default.sql
042_plan_employee_limit_contracted_seats.sql
043_vps_rls_all_tenant_tables.sql
```

**Evidência:** `git ls-tree origin/main -- backend/db/migrations/` não lista 041–043.  
**Correção pré-sync (fora desta auditoria read-only):** versionar/pushar 041–043 antes de esperar que `git pull` na VPS as aplique.

### 1.3 Pipeline completo (`db:migrate:full`)

Além de `backend/db/migrations`, `apply-full-database.mjs` aplica também:

1. `vps/bootstrap` ← `backend/db/vps/bootstrap.sql`
2. `vps/base` ← `supabase_full_schema.sql`
3. `supabase/<arquivo>` ← todos `supabase/migrations/*.sql`
4. `backend/<arquivo>` ← todos `backend/db/migrations/*.sql`

---

## 2. Tabela que registra migrations executadas

| Item | Valor |
|------|--------|
| Tabela | `public._schema_migrations` |
| Colunas | `name text PRIMARY KEY`, `applied_at timestamptz NOT NULL DEFAULT now()` |
| Quem grava | `backend/scripts/apply-full-database.mjs` (`npm run db:migrate:full`) |
| Formato dos nomes | `vps/bootstrap`, `vps/base`, `supabase/<file>.sql`, `backend/<file>.sql` |

**Atenção:** `npm run db:migrate` → `apply-migrations.mjs` **aplica SQL sem gravar ledger**. Para auditoria e reexecução segura, usar **`db:migrate:full`**.

---

## 3. Lista completa (backend) — referência de sync

Ver seção 1.1 (+ 1.2 se o alvo incluir RC1 Local).

Nomes esperados no ledger após `db:migrate:full`:

`backend/002_employees_rh_fields.sql` … `backend/040_master_local_license_deployments.sql`  
(+ `backend/041_…`, `backend/042_…`, `backend/043_…` se esses arquivos existirem no tree da VPS).

---

## 4. Comparação com migrations presentes na VPS

| Resultado | **N/D — VPS inacessível (SSH negado)** |
|-----------|----------------------------------------|
| Causa técnica | `Permission denied (publickey,password)` em `root@177.7.51.209` |
| Evidência | Tentativa BatchMode 2026-08-04; sem chave privada local |
| Correção | Fornecer senha root ou chave SSH; então rodar SQL da seção 12.1 |

---

## 5. Quais migrations ainda precisam ser executadas na VPS

| Resultado | **N/D lista exata** (depende do ledger VPS) |
|-----------|-----------------------------------------------|
| Expectativa operacional | Após longo downtime, **é esperado** gap grande vs `origin/main` (potencialmente tudo após o último `backend/*` aplicado, tipicamente pré-017/018 se a VPS ficou antiga). |
| Como obter lista exata | Seção 12.1 (diff ledger × arquivos no disco da VPS). |

---

## 6. Migrations 041, 042, 043 — aplicadas na VPS?

| Migration | Em `origin/main`? | Aplicada na VPS? |
|-----------|-------------------|------------------|
| 041 | **NÃO** | **N/D** (e arquivo nem está no remote) |
| 042 | **NÃO** | **N/D** |
| 043 | **NÃO** | **N/D** |

**Baseline local (`pg16-restore`) — efeito das mudanças (não prova VPS):**

| Check | Local |
|-------|-------|
| Ledger `backend/%041|042|043%` | Ausente (schema aplicado fora do ledger ou por outros meios) |
| `departments.id` DEFAULT | `(gen_random_uuid())::text` → efeito **041** presente |
| `enforce_company_plan_employee_limit()` | Existe → efeito **042** presente |
| Policies `vps_%` | **109** / 109 tabelas com `company_id` (não-master) → efeito **043** presente |
| Tabelas `company_id` sem policy `vps_%_tenant` | **0** |

---

## 7. Tabelas criadas por 041 / 042 / 043

| Migration | Cria tabelas? | Objetos |
|-----------|---------------|---------|
| 041 | **Não** | `ALTER TABLE departments … SET DEFAULT` |
| 042 | **Não** | `CREATE OR REPLACE FUNCTION enforce_company_plan_employee_limit()` |
| 043 | **Não** | Loop: `ENABLE/FORCE RLS` + `CREATE POLICY vps_<tbl>_tenant` em tabelas com `company_id` (exceto `master_%`) |

**Tabelas Master (018+)** que a VPS precisa ter após sync até 040 (amostra de `018_master_persistence.sql`):

`master_tenants`, `master_subscriptions`, `master_licenses`, `master_invoices`, `master_payments`, `master_pix_charges`, `master_refunds`, `master_billing_webhooks`, `master_audit`, `master_logs` (+ demais 019–040).

Existência na VPS: **N/D** sem SSH.

---

## 8. Policies RLS

| Escopo | Local (baseline) | VPS |
|--------|------------------|-----|
| Policies `vps_%` | **109** | **N/D** |
| Alvo 043 | 1 policy `vps_<table>_tenant` por tabela `public` com `company_id` e sem prefixo `master_` | **N/D** |

---

## 9. Tabelas com `company_id` sem RLS VPS (deveriam ter)

| Local | **0** faltantes (109/109) |
|-------|---------------------------|
| VPS | **N/D** — usar SQL 12.3 |

---

## 10. Backend da VPS × commit atual

| Check | Resultado |
|-------|-----------|
| Commit referência | `origin/main` = `2da240e` |
| Commit em execução na VPS | **N/D** (sem SSH; sem endpoint `/api/version`) |
| Inferência | API **não** corresponde ao `origin/main` atual |

**Evidência:**

- `origin/main` define `GET /api/health/live` e `GET /api/health/ready` em `backend/src/routes/apiRouter.ts`.
- Público hoje:
  - `GET /api/health` → **200** `{"status":"ok","db":"connected"}`
  - `GET /api/health/live` → **404** `{"ok":false,"error":"not_found"}`
  - `GET /api/health/ready` → **404** `{"ok":false,"error":"not_found"}`

**Causa técnica:** processo Node/PM2 na VPS ainda serve build **anterior** a `origin/main` (esperado pós-reativação sem `git pull` + rebuild + restart).  
**Correção:** na VPS, `git fetch && git checkout/pull` para `2da240e` (ou `main` atualizado) → `npm ci` → `npm run build` → `pm2 restart pontoweb-api --update-env`.

---

## 11. Endpoints de health na versão publicada

| Endpoint | Publicado agora | Em `origin/main` |
|----------|-----------------|------------------|
| `GET /api/health` | **EXISTE (200)** | SIM |
| `GET /api/health/live` | **AUSENTE (404)** | SIM (código) |
| `GET /api/health/ready` | **AUSENTE (404)** | SIM (código) |

Não classificado como bug de produto: é **drift de deploy**.

---

## 12. Inventário e diferenças (local × VPS)

### 12.0 Baseline LOCAL (destino desejado pós-sync)

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
| extensions | `plpgsql`, `pgcrypto`, `uuid-ossp` |

### 12.1 VPS — migrations faltantes / tabelas / índices / triggers / functions / views / extensions / RLS

| Categoria | Diferença VPS vs local |
|-----------|------------------------|
| migrations faltantes | **N/D** — rodar 12.2 |
| tabelas faltantes | **N/D** |
| índices faltantes | **N/D** |
| triggers faltantes | **N/D** |
| functions faltantes | **N/D** |
| views faltantes | **N/D** |
| extensions faltantes | **N/D** (mínimo esperado: pgcrypto, uuid-ossp, plpgsql) |
| policies RLS faltantes | **N/D** (alvo: 109 `vps_%` se 043 aplicada) |

### 12.2 Comandos SQL / shell — diagnóstico na VPS (somente leitura)

```bash
# SSH + carregar DATABASE_URL
cd /root/PontoWebDesk/backend
set -a && source .env && set +a

# Ledger backend
psql "$DATABASE_URL" -c "SELECT name, applied_at FROM _schema_migrations WHERE name LIKE 'backend/%' ORDER BY 1;"

# Diff: arquivos no disco vs ledger (falta aplicar)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
WITH disk(name) AS (
  -- preencher manualmente ou via script; exemplo conceito:
  SELECT unnest(ARRAY[
    'backend/002_employees_rh_fields.sql',
    /* ... até 040 ... */
    'backend/040_master_local_license_deployments.sql'
  ])
)
SELECT d.name AS missing_on_vps
FROM disk d
LEFT JOIN public._schema_migrations m ON m.name = d.name
WHERE m.name IS NULL
ORDER BY 1;
SQL

# Contagens (comparar com baseline local)
psql "$DATABASE_URL" -c "
SELECT 'tables' k, count(*)::text v FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'
UNION ALL SELECT 'views', count(*)::text FROM information_schema.views WHERE table_schema='public'
UNION ALL SELECT 'indexes', count(*)::text FROM pg_indexes WHERE schemaname='public'
UNION ALL SELECT 'triggers', count(*)::text FROM information_schema.triggers WHERE trigger_schema='public'
UNION ALL SELECT 'functions', count(*)::text FROM information_schema.routines WHERE routine_schema='public'
UNION ALL SELECT 'constraints', count(*)::text FROM information_schema.table_constraints WHERE constraint_schema='public'
UNION ALL SELECT 'fks', count(*)::text FROM information_schema.table_constraints WHERE constraint_schema='public' AND constraint_type='FOREIGN KEY'
UNION ALL SELECT 'rls', count(*)::text FROM pg_policies WHERE schemaname='public'
UNION ALL SELECT 'vps_rls', count(*)::text FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'vps_%'
UNION ALL SELECT 'ext', count(*)::text FROM pg_extension;
"

# 041 / 042 / 043 checks
psql "$DATABASE_URL" -c "
SELECT column_default FROM information_schema.columns
 WHERE table_schema='public' AND table_name='departments' AND column_name='id';
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND proname IN ('enforce_company_plan_employee_limit','vps_tenant_row_visible');
SELECT count(*) AS vps_policies FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'vps_%';
"
```

### 12.3 SQL — tabelas com `company_id` sem policy VPS

```sql
SELECT c.table_name
FROM information_schema.columns c
JOIN information_schema.tables t
  ON t.table_schema = c.table_schema AND t.table_name = c.table_name
WHERE c.table_schema = 'public'
  AND c.column_name = 'company_id'
  AND t.table_type = 'BASE TABLE'
  AND c.table_name NOT LIKE 'master_%'
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = c.table_name
      AND p.policyname = format('vps_%s_tenant', c.table_name)
  )
ORDER BY 1;
```

### 12.4 Comandos para SINCRONIZAR a VPS (plano — **não executado** nesta auditoria)

```bash
# 0) Backup obrigatório
cd /root/PontoWebDesk/backend
set -a && source .env && set +a
pg_dump "$DATABASE_URL" --format=custom \
  --file="/root/backup-pre-sync-$(date +%Y%m%d-%H%M).dump"

# 1) Código = origin/main (2da240e)
cd /root/PontoWebDesk
git fetch origin
git checkout main
git pull --ff-only origin main
# Se 041-043 ainda não estiverem no remote: copiar/push antes deste passo

# 2) Deps + build API
cd /root/PontoWebDesk/backend
npm ci
npm run build

# 3) Migrations pendentes (usa ledger _schema_migrations)
npm run db:migrate:full
# Se 041-043 já estiverem no tree após push:
#   o mesmo comando aplica backend/041_*.sql … backend/043_*.sql

# 4) Restart
pm2 restart pontoweb-api --update-env

# 5) Validar endpoints
curl -sS http://127.0.0.1:3000/api/health
curl -sS http://127.0.0.1:3000/api/health/live
curl -sS http://127.0.0.1:3000/api/health/ready
```

**SQL pontual** (só se `db:migrate:full` não for usado e os arquivos existirem no servidor):

```bash
# Exemplo — NÃO rodar cego sem backup; preferir db:migrate:full
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/041_departments_id_default.sql
psql "$DATABASE_URL" -c "INSERT INTO _schema_migrations(name) VALUES ('backend/041_departments_id_default.sql') ON CONFLICT DO NOTHING;"
# idem 042, 043
```

---

## 13. Checklist diagnóstico (objetivos 1–11)

| # | Objetivo | Status |
|---|----------|--------|
| 1 | Migrations no projeto | **OK** — listadas (origin: 002–040; Local+: 041–043 fora do remote) |
| 2 | Tabela de ledger | **OK** — `public._schema_migrations` |
| 3 | Lista completa | **OK** — seção 1 |
| 4 | Comparar com VPS | **BLOQUEADO** — sem SSH |
| 5 | Lista a executar na VPS | **BLOQUEADO** — depende 4 |
| 6 | 041/042/043 aplicadas | **Arquivo ausente em origin**; VPS **N/D** |
| 7 | Tabelas dessas migrations | **N/A** (não criam tabelas); Master 018+ **N/D** na VPS |
| 8 | Policies RLS | Local 109; VPS **N/D** |
| 9 | Tabelas sem RLS devidas | Local 0; VPS **N/D** |
| 10 | Backend = commit atual | **NÃO** (inferido: ready/live 404) |
| 11 | health / live / ready | health **OK**; live/ready **404** na publicada |

---

## 14. Veredicto desta auditoria (somente diagnóstico)

**Sync incompleta / não comprovável end-to-end sem SSH.**

Bloqueios para fechar o relatório de diferenças com números VPS:

1. **SSH** — causa: sem credencial; evidência: Permission denied; correção: chave ou senha.  
2. **041–043** — causa: não estão em `origin/main`; evidência: `git ls-tree`; correção: commit/push antes do pull na VPS.  
3. **Deploy API** — causa: build antigo; evidência: live/ready 404 vs código em origin; correção: pull + build + pm2 restart.

Nenhuma alteração automática foi feita.
