# Restaurar paridade Supabase → VPS

O dump `backend/data/supabase-data.dump` (**2,4 MB**, 2026-05-25) contém **todos os dados** que o sistema usava no Supabase, incluindo:

| Funcionalidade | Tabelas no dump |
|----------------|-----------------|
| Horários | `work_shifts` ✓ |
| Escalas simples | `schedules` ✓ |
| Escalas cíclicas | `escala_ciclica` ✓ |
| Escalas mensais | `escala_mensal` ✓ |
| Colaboradores / RH | `users`, `employees`, `departments` ✓ |
| Empresa | `companies` ✓ |
| REP | `rep_devices`, `rep_punch_logs` ✓ |
| Ponto | `time_records`, `punches` ✓ |
| Folha / eventos | `folha_pagamento_*`, `eventos_folha` ✓ |

**Conclusão:** o dump tem o que o sistema precisa. O que falta na VPS é **schema completo** + **importar o dump** + **API com allowlist ampla** (commit recente).

---

## Verificar o dump (no PC)

```powershell
cd backend
node scripts/data-migration/inspect-dump.mjs
# ou: npm run db:inspect-dump
```

---

## Passo a passo na VPS (ordem obrigatória)

### 1. Atualizar código e API

```bash
cd /root/PontoWebDesk
git pull
cd backend
npm run build
pm2 restart pontoweb-api --update-env
```

### 2. Schema completo (só se o banco ainda não tiver todas as tabelas)

**Faça backup antes.**

```bash
cd /root/PontoWebDesk/backend
pg_dump "$DATABASE_URL" --format=custom --file=/root/vps-backup-antes-migrate.dump
npm run db:migrate:full
```

> Não rode `db:migrate:full` de novo depois de importar o dump.

### 3. Garantir tabelas mínimas (se não rodou migrate:full)

```bash
npm run db:ensure-vps
```

### 4. Importar dados do Supabase

Copie o dump para a VPS (se ainda não estiver):

```powershell
scp backend\data\supabase-data.dump root@SEU_IP:/root/PontoWebDesk/backend/data/
```

Na VPS (dump **1.16** exige **postgresql-client-17**; PG 16 não basta):

```bash
sudo apt install -y postgresql-client-17
export PGRESTORE=/usr/lib/postgresql/17/bin/pg_restore
cd /root/PontoWebDesk/backend
export DATABASE_URL='postgresql://...'
bash scripts/data-migration/import-to-vps.sh data/supabase-data.dump
```

Erro `unsupported version (1.16)` = `pg_restore` antigo. O script valida isso **antes** da limpeza nas versões recentes.

### 5. Senha de login (API JWT)

Utilizadores do Supabase não trazem `password_hash`. Para o admin:

```bash
SEED_ADMIN_EMAIL=seu@email.com SEED_ADMIN_PASSWORD='sua-senha' npm run db:seed
```

### 6. Validar contagens

```bash
# Com SUPABASE_DATABASE_URL ainda válido no .env:
npm run db:data:validate

# Só VPS:
npm run db:data:count
```

Deve mostrar linhas em `work_shifts`, `schedules`, `escala_ciclica`, `employees`, etc.

### 7. Frontend (Vercel)

- `VITE_DATA_PROVIDER=LOCAL_API`
- `VITE_API_URL=https://api.phmsdev.com.br`
- Redeploy após `git push`

---

## O que quebrou na migração (resumo)

1. **Schema parcial** — VPS com `schema.sql` mínimo, sem `escala_ciclica`, `rep_devices`, etc.
2. **Dados não importados** — dump existia no PC mas não foi restaurado na VPS.
3. **API allowlist curta** — tabelas como `escala_ciclica`, `timesheets_daily` retornavam `table_not_allowed`.
4. **Camada HTTP** — bugs de `tenant_id`, tipos JSONB e parâmetros SQL (corrigidos nos commits recentes).

O frontend **não removeu** páginas de Horários/Escalas — elas falham ao carregar/gravar dados.

---

## Referência

- [supabase-to-vps-data.md](./supabase-to-vps-data.md) — export/import detalhado
