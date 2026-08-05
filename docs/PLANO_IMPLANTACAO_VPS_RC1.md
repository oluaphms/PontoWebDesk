# PLANO_IMPLANTACAO_VPS_RC1.md

**Modo:** READ ONLY (documento de plano — nenhuma alteração executada nesta geração)  
**Data:** 2026-08-04  
**Escopo:** levar migrations **041, 042, 043** ao produto principal e aplicá-las na VPS  
**Fonte SQL:** `D:\PontoWebDesk_Local\backend\db\migrations\041_*.sql` … `043_*.sql`  
**Destino Git:** `D:\PontoWebDesk` → `origin/main` (`2da240e` no momento da análise)  
**Alvo runtime:** VPS (`/root/PontoWebDesk`, API `pontoweb-api` / PM2)

Conclusão prévia: **041–043 DEVEM IR PARA PRODUÇÃO** (`docs/RELATORIO_INTEGRACAO_041_043.md`).

---

## 1. O projeto principal está pronto para receber 041–043?

### 1.1 Estado do clone `D:\PontoWebDesk`

| Check | Valor | Ação antes de integrar |
|-------|-------|------------------------|
| Working tree | **clean** | OK |
| Branch | `main` **48 commits atrás** de `origin/main` | **Obrigatório:** `git pull --ff-only origin main` antes de copiar 041–043 |
| Última migration no disco (behind) | ~016 | Após pull: até **040** |
| Última migration em `origin/main` | **040** | Slot livre para **041–043** (sem colisão de nome) |

### 1.2 Pré-requisitos presentes em `origin/main` (recepção OK)

| Dependência | Presente em origin? | Uso |
|-------------|---------------------|-----|
| `011_employees_id_default.sql` | Sim | Padrão análogo à 041 |
| `016_vps_rls_tenant_isolation.sql` | Sim | Cria `vps_tenant_row_visible` + policies base |
| `017_vps_rls_fail_closed.sql` | Sim | Função fail-closed usada pela 043 |
| `019_commercial_projection_master_source.sql` | Sim | Coluna `companies.contracted_limits` (042) |
| `040_master_local_license_deployments.sql` | Sim | Fim da sequência atual |
| `backend/scripts/apply-full-database.mjs` | Sim | Ledger `_schema_migrations` + apply ordenado |
| `npm run db:migrate:full` | Sim | Script de aplicação recomendado |
| `backend/src/db/tenantRls.ts` | Sim | GUC `app.rls_enforced` / company |
| `services/planLimitsCore.ts` | Sim | Alinhado à lógica 042 (tier sem hard cap) |
| Trigger seats (supabase `20260430140000_…`) | Sim (versão **antiga** free=5/pro=50) | 042 faz `CREATE OR REPLACE` da função |

**Veredito §1:** após **atualizar o clone para `origin/main`**, o principal **possui todos os arquivos de schema/código necessários** para receber 041–043. Falta apenas **adicionar** os três SQL e publicá-los.

---

## 2. Dependências de código ainda ausentes?

| Item | Status no principal (`origin/main`) | Bloqueia 041–043? |
|------|-------------------------------------|-------------------|
| `ensureInsertRowId` no `dataController` (Local) | **Ausente** | **Não** — 041 é DEFAULT no banco; funciona sem o helper |
| Fail-closed no `server.ts` (`throw` se `VPS_RLS_ENFORCED` off) | **Ausente** (só warn) | **Não** — decisão operacional pós-043; SQL independe |
| Reescrita do arquivo supabase `20260430140000` (versão Local) | Principal ainda free=5/pro=50 | **Não** — 042 substitui a função em runtime |
| Frontend específico 041–043 | N/A | **Não** — sem mudança FE obrigatória |
| `VPS_RLS_ENFORCED=true` na VPS | Pode estar false | **Não bloqueia apply**; afeta só o efeito real das policies |

**Veredito §2:** **nenhuma dependência de código Local é obrigatória** para aplicar os três SQL. Melhorias de app (ensureInsertRowId / fail-closed boot) são **opcionais** e fora do caminho mínimo deste plano.

---

## 3. Conflitos com migrations anteriores?

| Par | Tipo de interação | Risco | Tratamento |
|-----|-------------------|-------|------------|
| 041 × schema `departments` | `ALTER … SET DEFAULT` | Baixo | Idempotente na prática; se default já existir, comando é no-op / inofensivo |
| 041 × 011 | Mesmo padrão, tabelas diferentes | Nenhum | — |
| 042 × supabase `20260430140000` | **Replace** do corpo da função | Médio (comportamento) | **Esperado** — remove hardcap 5/50; passa a `contracted_limits.maxUsers` |
| 042 × trigger `trg_users_enforce_plan_employee_limit` | 042 **não** recria o trigger | Baixo | Se trigger existir (fluxo normal VPS), OK; se ausente, validação pós deve criar via supabase ou bloco TRIGGER |
| 043 × 016 | Mesmos nomes `vps_<tbl>_tenant` | Baixo | 043 faz DROP/CREATE; **amplia** conjunto de tabelas |
| 043 × 017 | Usa função fail-closed | Baixo | Garantir 017 **antes** de 043 no ledger |
| 041–043 × 018–040 Master | 043 **exclui** `master_%` | Nenhum | — |
| Colisão de nome de arquivo | origin termina em 040 | Nenhum | 041–043 livres |

**Veredito §3:** conflitos são **compatíveis e intencionais** (042/043 evoluem 016 + função de seats). Não há bloqueio de merge por nome duplicado.

---

## 4. Ordem exata de implantação

### Fase A — Git (estação de trabalho)

1. Em `D:\PontoWebDesk`:  
   `git checkout main`  
   `git pull --ff-only origin main`  
   Confirmar HEAD = `origin/main` e última migration = `040_…`.
2. Copiar **somente**:
   - `PontoWebDesk_Local\backend\db\migrations\041_departments_id_default.sql`
   - `…\042_plan_employee_limit_contracted_seats.sql`
   - `…\043_vps_rls_all_tenant_tables.sql`  
   → para `PontoWebDesk\backend\db\migrations\`.
3. `git add` dos três arquivos.  
4. Commit (mensagem sugerida): `chore(db): add migrations 041-043 for VPS RC1`  
5. `git push origin main`  
6. Anotar SHA do commit publicado.

**Não** neste passo mínimo: alterar frontend, `dataController`, `server.ts`, nem reescrever supabase.

### Fase B — Backend (VPS — código)

1. SSH na VPS.  
2. `cd /root/PontoWebDesk`  
3. `git fetch origin && git pull --ff-only origin main`  
4. Confirmar presença dos três arquivos em `backend/db/migrations/`.  
5. `cd backend && npm ci`  
6. `npm run build` (garantir dist alinhado ao commit; também recupera `health/ready` + `health/live` se build estava atrasado).

### Fase C — Frontend

1. **Nenhuma alteração FE obrigatória** para 041–043.  
2. Se o front de produção for Vercel/estático apontando para a API: **sem redeploy FE** neste plano.  
3. Se houver front servido na própria VPS no mesmo repo: opcional rebuild só se o `git pull` trouxe outras mudanças FE do fast-forward de 48 commits — tratar como parte do pull geral, não das 041–043.

### Fase D — Migrations (VPS — banco)

1. **Backup:**  
   ```bash
   cd /root/PontoWebDesk/backend
   set -a && source .env && set +a
   pg_dump "$DATABASE_URL" --format=custom \
     --file="/root/backup-pre-041-043-$(date +%Y%m%d-%H%M).dump"
   ls -lh /root/backup-pre-041-043-*.dump
   ```
2. Pré-check ledger (somente leitura):  
   ```bash
   psql "$DATABASE_URL" -c \
     "SELECT name FROM _schema_migrations WHERE name LIKE 'backend/01%' OR name LIKE 'backend/04%' ORDER BY 1;"
   ```  
   Confirmar `backend/016_…`, `backend/017_…`, `backend/019_…` (ou equivalentes aplicados). Se 016/017/019 faltarem, rodar `npm run db:migrate:full` **antes** (ou até o ponto necessário) — **não** aplicar 043 sem 016/017.
3. Aplicar pendências incluindo 041–043:  
   ```bash
   cd /root/PontoWebDesk/backend
   npm run db:migrate:full
   ```  
   Preferir isto a `db:migrate` (este último **não** grava ledger).
4. Se `db:migrate:full` falhar só em 041–043, corrigir erro e reexecutar (ledger pula já aplicadas).  
5. Confirmar ledger:  
   ```sql
   SELECT name, applied_at FROM _schema_migrations
   WHERE name IN (
     'backend/041_departments_id_default.sql',
     'backend/042_plan_employee_limit_contracted_seats.sql',
     'backend/043_vps_rls_all_tenant_tables.sql'
   ) ORDER BY 1;
   ```

### Fase E — Restart

```bash
pm2 restart pontoweb-api --update-env
pm2 status
pm2 logs pontoweb-api --lines 80
```

Opcional pós-estabilização (não no mesmo minuto do apply se quiser isolar risco):

- Definir `VPS_RLS_ENFORCED=true` no `backend/.env` → `pm2 restart pontoweb-api --update-env`  
- Só após smoke cross-tenant OK.

### Fase F — Validação (ordem)

1. `curl -sS http://127.0.0.1:3000/api/health`  
2. `curl -sS http://127.0.0.1:3000/api/health/live`  
3. `curl -sS http://127.0.0.1:3000/api/health/ready`  
4. SQL 041 / 042 / 043 (seção 7).  
5. Login + logout API.  
6. INSERT departamento sem `id` (espera 201/ok).  
7. Inserção de employee vs `contracted_limits` (respeita maxUsers).  
8. Amostra cross-tenant com RLS (se `VPS_RLS_ENFORCED=true`).  

---

## 5. Rollback completo

### 5.1 Rollback de código (Git / API)

```bash
cd /root/PontoWebDesk
git log -1 --oneline   # anotar SHA com 041-043
git checkout <SHA_ANTERIOR_SEM_041_043>
cd backend && npm ci && npm run build
pm2 restart pontoweb-api --update-env
```

Ou `git revert <SHA_041_043>` + push + pull (preferível se já compartilhado).

### 5.2 Rollback de banco (preferencial — restore do dump)

```bash
# PARAR escrita se possível
pm2 stop pontoweb-api

# Restore do dump tirado na Fase D
pg_restore --clean --if-exists --no-owner \
  -d "$DATABASE_URL" /root/backup-pre-041-043-YYYYMMDD-HHMM.dump

pm2 start pontoweb-api
```

Este é o rollback **confiável** para 041–043 juntas.

### 5.3 Rollback SQL pontual (só se restore for impossível)

**041 — remover DEFAULT**

```sql
ALTER TABLE public.departments ALTER COLUMN id DROP DEFAULT;
DELETE FROM public._schema_migrations
 WHERE name = 'backend/041_departments_id_default.sql';
```

**042 — restaurar função antiga (free=5 / pro=50)**  
Reaplicar o corpo de `supabase/migrations/20260430140000_enforce_plan_employee_limit_trigger.sql` **versão do origin/main (antiga)**, depois:

```sql
DELETE FROM public._schema_migrations
 WHERE name = 'backend/042_plan_employee_limit_contracted_seats.sql';
```

**043 — reverter cobertura ampla**  
- Opção A: restore dump.  
- Opção B (parcial): dropar policies `vps_%` de tabelas que **não** estavam na lista fixa da 016 e reaplicar só `016_vps_rls_tenant_isolation.sql` + `017_…`; remover ledger `backend/043_…`.  
  (Mais frágil — preferir dump.)

### 5.4 Rollback de env

Se `VPS_RLS_ENFORCED=true` tiver sido ligado neste deploy e houver incidente:

```bash
# em backend/.env
VPS_RLS_ENFORCED=false
pm2 restart pontoweb-api --update-env
```

---

## 6. Checklist de implantação

### Pré

- [ ] SSH VPS disponível  
- [ ] `D:\PontoWebDesk` atualizado (`git pull --ff-only`) até conter 017–040  
- [ ] Fontes 041–043 existem em `PontoWebDesk_Local`  
- [ ] Janela de manutenção comunicada  
- [ ] Disco VPS com espaço para dump  
- [ ] `DATABASE_URL` válida no `backend/.env` da VPS  

### Git

- [ ] Três arquivos copiados para `backend/db/migrations/`  
- [ ] Commit + push em `origin/main`  
- [ ] SHA anotado  

### VPS código

- [ ] `git pull --ff-only`  
- [ ] Arquivos 041–043 visíveis no disco da VPS  
- [ ] `npm ci`  
- [ ] `npm run build` sem erro  

### Banco

- [ ] `pg_dump` custom concluído e tamanho > 0  
- [ ] Pré-check: 016, 017, 019 aplicados  
- [ ] `npm run db:migrate:full` sem erro  
- [ ] Ledger contém 041, 042, 043  

### Restart

- [ ] `pm2 restart pontoweb-api --update-env`  
- [ ] Processo online  
- [ ] Logs sem crash loop  

---

## 7. Checklist pós-implantação

### Health

- [ ] `GET /api/health` → 200, `db: connected`  
- [ ] `GET /api/health/live` → 200  
- [ ] `GET /api/health/ready` → 200  

### SQL — 041

```sql
SELECT column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'departments'
  AND column_name = 'id';
-- esperado: contém gen_random_uuid
```

- [ ] DEFAULT presente  
- [ ] Smoke: criar departamento sem enviar `id` → sucesso  

### SQL — 042

```sql
SELECT pg_get_functiondef('public.enforce_company_plan_employee_limit()'::regprocedure);
```

- [ ] Definição contém `contracted_limits`  
- [ ] Definição **não** contém `v_max := 5` / `v_max := 50` fixos  
- [ ] Trigger `trg_users_enforce_plan_employee_limit` existe em `users`  

### SQL — 043

```sql
SELECT count(*) AS vps_policies
FROM pg_policies
WHERE schemaname = 'public' AND policyname LIKE 'vps_%';
```

- [ ] Contagem alinhada ao esperado do ambiente (baseline local de referência: **109**)  
- [ ] Query de tabelas `company_id` (não-master) sem policy `vps_%_tenant` retorna **0** linhas  

### Funcional

- [ ] Login OK  
- [ ] Logout OK  
- [ ] Leitura banco de horas / espelho (amostra)  
- [ ] Financeiro Master (se usado neste ambiente)  
- [ ] Cross-tenant: tenant A não lê dados de B (com RLS enforced, se ativado)  

### Operacional

- [ ] Dump pré-deploy guardado (≥ 7 dias / política interna)  
- [ ] `VPS_RLS_ENFORCED` documentado (false temporário vs true definitivo)  
- [ ] Nenhuma regressão crítica em PM2 logs (1h)  
- [ ] Atualizar runbook / checklist produção com SHA e horário  

---

## 8. Resumo executivo

| Pergunta | Resposta |
|----------|----------|
| Principal pode receber 041–043? | **Sim**, após `git pull` (hoje o clone está 48 commits atrás) |
| Código Local obrigatório? | **Não** |
| Conflitos bloqueantes? | **Não** (042/043 evoluem objetos existentes de propósito) |
| FE obrigatório? | **Não** |
| Apply recomendado | `npm run db:migrate:full` + backup prévio |
| Rollback preferencial | `pg_restore` do dump `backup-pre-041-043-*.dump` |

**Ordem mental:** Git (pull + add 041–043 + push) → VPS pull + build → **backup** → migrate → restart → validar.
