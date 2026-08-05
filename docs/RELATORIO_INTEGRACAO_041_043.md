# RELATORIO_INTEGRACAO_041_043.md

**Modo:** READ ONLY  
**Data:** 2026-08-04  
**Projetos:** `D:\PontoWebDesk` (principal / VPS) · `D:\PontoWebDesk_Local` (SaaS Local + evolução RC)  
**Referência remota do principal:** `origin/main` @ `2da240e` (clone local principal está 48 commits atrás)

Nenhum arquivo foi copiado, alterado ou commitado nesta análise.

---

## 1. Conteúdo completo das migrations

### 041 — `041_departments_id_default.sql`

```sql
-- departments.id no legado é text PRIMARY KEY sem DEFAULT.
-- INSERT via /api/data/departments sem "id" falhava com 23502 (null id).
-- Alinhado a job_titles/schedules/work_shifts (gen_random_uuid).

ALTER TABLE public.departments
  ALTER COLUMN id SET DEFAULT (gen_random_uuid())::text;
```

### 042 — `042_plan_employee_limit_contracted_seats.sql`

- `CREATE OR REPLACE FUNCTION public.enforce_company_plan_employee_limit()`
- Lógica: só `INSERT` de `role=employee` + `status=active`
- Limite = `companies.contracted_limits->>'maxUsers'` (numérico)
- Sem `maxUsers` / enterprise → não bloqueia
- Não recria o trigger (espera trigger já existente)

### 043 — `043_vps_rls_all_tenant_tables.sql`

- Loop dinâmico em tabelas `public` com coluna `company_id`, excluindo `master_%`
- Por tabela: `ENABLE` + `FORCE ROW LEVEL SECURITY`
- `DROP/CREATE POLICY vps_<table>_tenant` usando `vps_tenant_row_visible(company_id::text)`
- Idempotente; depende de `vps_tenant_row_visible` (016/017)

---

## 2. Objetos criados / alterados

| Migration | Tabelas | Índices | Triggers | Functions | Views | Policies |
|-----------|---------|---------|----------|-----------|-------|----------|
| **041** | Altera `departments` (DEFAULT em `id`) | — | — | — | — | — |
| **042** | — | — | Não cria (usa `trg_users_enforce_plan_employee_limit` já existente) | **Replace** `enforce_company_plan_employee_limit()` | — | — |
| **043** | — (só RLS em tabelas existentes) | — | — | Comentário em `vps_tenant_row_visible` | — | **N policies** `vps_<tbl>_tenant` (1 por tabela operacional com `company_id`; baseline local = **109**) |

Nenhuma das três é “schema Local-only” (não cria tabelas `license_*` do instalador Windows).

---

## 3. Comparação com o banco / código do projeto principal

### 3.1 Presença nos trees

| Item | `D:\PontoWebDesk` (disco, behind) | `origin/main` (principal remoto) | `D:\PontoWebDesk_Local` |
|------|-----------------------------------|----------------------------------|-------------------------|
| 041 / 042 / 043 | Ausentes | **Ausentes** | Presentes |
| 016 RLS parcial | Presente | Presente | Presente (hash idêntico ao principal) |
| 017 fail-closed | Ausente no disco behind | Presente | Presente |
| 019 `contracted_limits` | Ausente no disco behind | Presente | Presente |
| Trigger/função limite (supabase `20260430140000_…`) | Versão **antiga** free=5 / pro=50 | Versão **antiga** free=5 / pro=50 | Versão **nova** = mesma lógica da 042 |
| `planLimitsCore.getMaxEmployeesForPlan` | Retorna `null` (ilimitado por tier) | Igual | Igual |

### 3.2 Efeito prático no principal hoje

| Tema | Principal (`origin/main`) | Impacto |
|------|---------------------------|---------|
| Limite de colaboradores no DB | Função supabase antiga **hardcode** 5/50 | **Desalinhada** de `planLimitsCore` (null) e de `contracted_limits` (019+) |
| RLS VPS | Só lista fixa da **016** (~13 tabelas) | Cobertura incompleta vs modelo multi-tenant amplo |
| `departments.id` DEFAULT | Sem 041 | INSERT sem `id` pode falhar 23502 se o backend não gerar UUID |

### 3.3 Baseline local (Postgres `pg16-restore`, referência Local)

| Check | Valor |
|-------|-------|
| `departments.id` default | `(gen_random_uuid())::text` |
| `enforce_company_plan_employee_limit` | Presente (lógica contracted) |
| Policies `vps_%` | 109 |
| Tabelas `company_id` (não-master) sem policy VPS | 0 |

---

## 4. Classificação: obrigatória onde? Substitui o quê? Depende de código Local?

### 041 — departments DEFAULT

| Pergunta | Resposta |
|----------|----------|
| Obrigatória produção (VPS)? | **Sim (recomendada)** — corrige PK text sem default; espelha padrão de `011_employees_id_default` já no principal |
| Só SaaS Local? | **Não** — bug do `/api/data` + tabela `departments` (allowlist nos **dois** projetos) |
| Substitui migration antiga? | **Não** — complemento; não remove objeto anterior |
| Depende de código só no Local? | **Não**. Local tem `ensureInsertRowId()` no `dataController` (app gera UUID); **principal `origin/main` não tem** essa função. A 041 é até **mais importante** no principal como rede de segurança no banco. Extensão `pgcrypto`/`gen_random_uuid` já usada no ecossistema |

### 042 — limite por `contracted_limits`

| Pergunta | Resposta |
|----------|----------|
| Obrigatória produção? | **Sim** — alinha trigger DB ao modelo comercial já versionado no principal (019 `contracted_limits`, Master, `Company.tsx` com `contracted_limits` no origin) e a `planLimitsCore` (tier sem hard cap) |
| Só SaaS Local? | **Não** — não referencia instalador/licença Local; usa `companies.contracted_limits` do control plane SaaS/VPS |
| Substitui migration antiga? | **Sim, em parte** — **substitui o corpo** da função criada por `supabase/migrations/20260430140000_enforce_plan_employee_limit_trigger.sql` (versão free=5/pro=50 no principal). Não dropa o trigger; `CREATE OR REPLACE FUNCTION` basta se o trigger já existir |
| Depende de código só no Local? | **Não**. `planLimitsCore` idêntico nos dois. Coluna `contracted_limits` já está em `origin/main` (019). Frontend principal origin já lê `contracted_limits` em Company |

**Nota:** No Local, o arquivo **supabase** `20260430140000_…` já foi reescrito com a lógica da 042. No principal remoto, o supabase ainda está na versão antiga — por isso a **042 backend** é o veículo limpo de correção na VPS sem reescrever histórico supabase (ou pode-se alinhar o supabase depois).

### 043 — RLS em todas as tabelas com `company_id`

| Pergunta | Resposta |
|----------|----------|
| Obrigatória produção? | **Sim (hardening multi-tenant VPS)** — completa a 016 (lista curta) para cobertura total operacional |
| Só SaaS Local? | **Não** — comentário “Wave 2 RC” / VPS; exclui explicitamente `master_*`; é política de isolamento SaaS na VPS |
| Substitui migration antiga? | **Estende** a 016 (reaplica policies com mesmo nome `vps_%_tenant` onde couber; cobre tabelas que a 016 nunca listou) |
| Depende de código só no Local? | **Parcialmente no enforcement de boot, não no SQL.** SQL depende só de `vps_tenant_row_visible` (016/017 — **017 já no origin**). Local `server.ts` **aborta** boot se produção sem `VPS_RLS_ENFORCED=true`; principal origin só **warn**. Portar **043 não exige** portar o fail-closed do server; são decisões independentes |

---

## 5. Referências backend / frontend

| Estrutura | Principal | Local |
|-----------|-----------|-------|
| `departments` em data API | Allowlist sim | Allowlist + `ensureInsertRowId` |
| `enforce_company_plan_employee_limit` / `PLAN_LIMIT_REACHED` | supabase antiga + `planEnforcement.ts` / `planLimitsCore` | supabase nova + 042 + mesmos services |
| `contracted_limits` | origin: migration 019 + Master + Company UI | Idem + 042 |
| `vps_tenant_row_visible` / `VPS_RLS_ENFORCED` | 016 + `tenantRls.ts` + warn no server | 016/017/043 + `tenantRls.ts` + fail-closed no server |
| Frontend “043/041” explícito | Não | Não (só docs/RELEASE) |
| Licenciamento Local (`src/platform/license*`) | N/A ao SQL 041–043 | Existe, **não é lido pelas migrations 041–043** |

**Conclusão de acoplamento:** as três migrations falam com o **produto SaaS/VPS principal**, não com o empacotamento Windows Local.

---

## 6. É seguro portar para o projeto principal?

**Sim, com pré-requisitos.**

| Risco | Mitigação |
|-------|-----------|
| 041 em DB sem `gen_random_uuid` | Extensão já usada (`011`, etc.) |
| 042 sem coluna `contracted_limits` | Garantir 019 (já em `origin/main`) aplicada na VPS antes |
| 042 sem trigger prévio | Se trigger nunca existiu, 042 só troca a função — criar trigger como na supabase `20260430140000` (bloco DROP/CREATE TRIGGER) |
| 043 sem 016/017 | Aplicar 016 (e 017 do origin) antes |
| 043 + `VPS_RLS_ENFORCED=true` sem setar GUC de company | Mesmo risco da 016; API já usa `applyTenantRlsTransaction` |
| Mudança de comportamento 042 | Tenants free/pro **deixam de ser cortados em 5/50 no DB** a menos que `contracted_limits.maxUsers` esteja preenchido — isso **corrige** o desalinhamento com `planLimitsCore`, não é regressão acidental do Local |

Não há dependência de código exclusivamentemente Local para o SQL funcionar.

---

## 7. Plano de integração (não executado)

### 7.1 Arquivos a copiar (principal ← Local)

```
backend/db/migrations/041_departments_id_default.sql
backend/db/migrations/042_plan_employee_limit_contracted_seats.sql
backend/db/migrations/043_vps_rls_all_tenant_tables.sql
```

Opcional (alinhamento histórico supabase, separado):

```
supabase/migrations/20260430140000_enforce_plan_employee_limit_trigger.sql
```
(versão Local — mesma lógica da 042; só se quiserem consistência do arquivo supabase no monorepo; na VPS já aplicada, preferir **não reaplicar** cegamente — usar 042 + ledger)

### 7.2 Conflitos esperados

| Conflito | Detalhe |
|----------|---------|
| Numeração | Principal `origin` termina em **040**; 041–043 encaixam sem colisão de nome |
| Função 042 × supabase antiga | `CREATE OR REPLACE` sobrescreve corpo free=5/pro=50 — **desejado** |
| Policies 043 × 016 | Mesmo nome de policy; 043 recrea e **amplia** conjunto de tabelas |
| Clone principal behind 48 | Antes de integrar: `git pull` no principal para ter 017–040 |
| Local `dataController.ensureInsertRowId` | **Não** é requisito da 041; portar o helper é melhoria de app opcional, fora do escopo mínimo SQL |

### 7.3 Ordem correta

1. Atualizar tree principal para `origin/main` (ter 016–040).  
2. Confirmar na VPS (após backup): 016, 017, 019 no ledger / objetos presentes.  
3. Copiar e versionar 041 → 042 → 043 no principal.  
4. `db:migrate:full` (ou apply ordenado) na VPS.  
5. Só então decidir `VPS_RLS_ENFORCED=true` (e eventual fail-closed do server, se desejarem paridade Local).

### 7.4 Validações necessárias

```sql
-- 041
SELECT column_default FROM information_schema.columns
 WHERE table_name='departments' AND column_name='id';

-- 042
SELECT pg_get_functiondef('public.enforce_company_plan_employee_limit()'::regprocedure);
-- deve mencionar contracted_limits; não deve hardcodar v_max := 5/50

-- 043
SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'vps_%';
-- tabelas company_id sem policy:
-- (query da seção 12.3 de RELATORIO_VPS_SYNC.md)
```

Smoke: criar departamento sem `id`; inserir employee respeitando `contracted_limits`; cross-tenant com RLS on.

### 7.5 Impacto na VPS

| Migration | Impacto |
|-----------|---------|
| 041 | Baixo — só DEFAULT; INSERT legado passa a funcionar |
| 042 | Médio — **muda** enforcement de seats (tira hardcap 5/50; passa a honrar contrato) |
| 043 | Médio/Alto em superfície — habilita RLS em ~100 tabelas; com `VPS_RLS_ENFORCED=false` policies são permissivas via `vps_tenant_row_visible`; com `true`, isolamento real |

Backup (`pg_dump`) obrigatório antes do apply.

---

## 8. Conclusão final

# DEVEM IR PARA PRODUÇÃO

**Justificativa técnica:**

1. **Não são artefatos do instalador SaaS Local.** Não criam schema de licença Windows, Compose Demo nem packaging; operam sobre `departments`, `companies.contracted_limits` e RLS VPS — todos do produto principal SaaS/VPS.  
2. **041** corrige falha de INSERT em tabela já allowlisted no principal; o padrão já existe (`011_employees_id_default`); o backend principal ainda **não** gera `id` no `dataController` como o Local.  
3. **042** corrige **inconsistência já existente no principal**: `planLimitsCore` + comercial (`contracted_limits` desde 019) vs trigger supabase antigo free=5/pro=50 ainda no `origin/main`.  
4. **043** completa a **016** (já no principal) para isolamento multi-tenant na VPS; é hardening de produção, não feature Local.  
5. Dependências SQL (016/017/019, `gen_random_uuid`, trigger de seats) já estão no caminho de produção do principal (`origin/main`), não exclusivas do Local.

**Ressalva:** “Ir para produção” significa versionar no **projeto principal** e aplicar na **VPS** após backup e pré-requisitos 016→019. Não confundir com “obrigatório para o .exe Local” — o Local já as consome no seu próprio tree; o gap é o **produto principal / VPS** que ainda não as tem.
