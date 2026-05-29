# Migração de dados: Supabase → PostgreSQL VPS

Guia para copiar **todos os dados** do Supabase para a VPS, com schema já aplicado (`npm run db:migrate:full`).

**Não** rode `db:migrate:full` novamente após importar. **Não** use `db:apply-schema` no mesmo banco.

## Pré-requisitos

| Item | Onde obter |
|------|------------|
| `SUPABASE_DATABASE_URL` | Supabase → Project Settings → Database → **Connection string** → **Direct** (porta **5432**) |
| `DATABASE_URL` | VPS → `backend/.env` |
| `pg_dump` / `pg_restore` / `psql` | **pg_restore 17+** se o dump foi criado com **pg_dump 17** (formato custom **1.16**). `pg_restore` 16 **não** lê 1.16. |

Em `backend/.env`:

```env
SUPABASE_DATABASE_URL=postgresql://postgres.[ref]:[PASSWORD]@db.[ref].supabase.co:5432/postgres
DATABASE_URL=postgresql://USER:PASS@127.0.0.1:5432/SEU_DB
```

## Fluxo resumido

```text
[PC] pg_dump Supabase (data-only) → supabase-data.dump
[PC] scp dump → VPS
[VPS] backup VPS → pre-import-cleanup.sql → pg_restore → post-import-compat.sql
[PC/VPS] validate-migration.mjs
[VPS] db:seed (senha API admin) + testes API/frontend
```

---

## 1. Exportar dados do Supabase (no PC)

```powershell
cd backend
# Preencha SUPABASE_DATABASE_URL no .env antes
.\scripts\data-migration\export-supabase.ps1
# Gera: backend/data/supabase-data.dump
```

Linux/macOS:

```bash
cd backend && bash scripts/data-migration/export-supabase.sh
```

Alternativa SQL (ficheiros grandes, menos fiável em FKs):

```bash
pg_dump "$SUPABASE_DATABASE_URL" --data-only --inserts --column-inserts \
  --schema=public --schema=auth \
  -f supabase-data.sql
```

---

## 2. Backup na VPS (obrigatório)

```bash
ssh root@177.7.51.209
cd /caminho/PontoWebDesk/backend
pg_dump "$DATABASE_URL" --format=custom --file=vps-backup-$(date +%Y%m%d).dump
```

---

## 3. Enviar dump para a VPS

```powershell
scp backend\data\supabase-data.dump root@177.7.51.209:/root/
```

---

## 4. Importar na VPS

**Cliente PostgreSQL 17** (obrigatório para dumps com header **1.16**):

```bash
pg_restore --version
# Se 16.x ainda falhar com "unsupported version (1.16)":
sudo apt update && sudo apt install -y postgresql-client-17
export PGRESTORE=/usr/lib/postgresql/17/bin/pg_restore
$PGRESTORE --list /root/PontoWebDesk/backend/data/supabase-data.dump | head
```

```bash
cd /caminho/PontoWebDesk/backend
export DATABASE_URL='postgresql://...'

bash scripts/data-migration/import-to-vps.sh /root/supabase-data.dump
```

Se o import falhou com `unsupported version` **depois** do `pre-import-cleanup`, o banco ficou vazio. Corrija o `pg_restore` e **rode o script de novo** (não precisa novo dump). Opcional: recuperar estado anterior com `vps-pre-import-*.dump` gerado no mesmo diretório.

O script:

1. Faz backup automático (`vps-pre-import-*.dump`)
2. `pre-import-cleanup.sql` — remove seed e trunca tabelas `public` (mantém `_schema_migrations`)
3. `pg_restore --data-only --disable-triggers`
4. `post-import-compat.sql` — `phone`→`telefone`, `admissao`→`data_admissao`, índices `punches` para API

---

## 5. Validar integridade

Com túnel SSH ou URLs diretas:

```bash
cd backend
npm run db:data:validate
```

Compara contagens de tabelas chave (`companies`, `users`, `employees`, `time_records`, `punches`, …) e `auth.users`.

---

## 6. Login na API (password_hash)

Utilizadores importados **não** têm `password_hash` (login Supabase era GoTrue).

Para cada admin que precisa entrar pela API:

```bash
SEED_ADMIN_EMAIL=rh@empresa.com SEED_ADMIN_PASSWORD='senha-forte' npm run db:seed
```

Ou SQL:

```sql
UPDATE public.users SET password_hash = '<bcrypt>' WHERE lower(email) = 'rh@empresa.com';
```

(Gere bcrypt com `node -e "import('bcryptjs').then(b=>b.hash('senha',10).then(console.log))"` no backend.)

---

## 7. Testar API

```bash
# Health
curl http://127.0.0.1:3000/api/health

# Login
curl -s -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"rh@empresa.com","password":"senha-forte"}'

# Colaboradores (substitua TOKEN e companyId)
curl -s "http://127.0.0.1:3000/api/employees?companyId=SEU_COMPANY_ID" \
  -H "Authorization: Bearer TOKEN"

# Batidas (fila API — tabela punches; dados históricos estão em time_records)
curl -s -X POST http://127.0.0.1:3000/api/punches \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"company_id":"...","user_id":"...","type":"entrada","timestamp":"2026-05-22T12:00:00Z"}'
```

Compare no SQL:

```sql
SELECT count(*) FROM employees;
SELECT count(*) FROM time_records;
SELECT count(*) FROM punches;
```

---

## 8. Testar frontend

1. `.env.local`: `VITE_LOCAL_API_BASE_URL=http://177.7.51.209/api` (ou domínio Traefik)
2. Login com utilizador que tem `password_hash`
3. Listagem de colaboradores, cartão de ponto, relatórios
4. Registos de ponto vêm principalmente de **`time_records`** (não só `punches`)

---

## Conflitos e ordem

| Situação | Ação |
|----------|------|
| Já correu `db:seed` na VPS | `pre-import-cleanup` remove `admin@local.test` |
| Tabelas com dados de teste | Truncate em cascata antes do restore |
| FK `public.users` → `auth.users` | Dump inclui `--schema=auth` |
| Fotos em Storage | Dump inclui `--schema=storage`; na VPS o shim `storage.*` existe no bootstrap |

## O que NÃO fazer

- Não importar dump com `--clean` (apagaria schema)
- Não rodar `db:migrate:full` depois do import
- Não commitar `.env` nem ficheiros `.dump` (contêm credenciais)

## Scripts npm

| Comando | Descrição |
|---------|-----------|
| `npm run db:data:export` | `pg_dump` Supabase → `data/supabase-data.dump` |
| `npm run db:data:validate` | Compara contagens Supabase vs VPS |
| `npm run db:data:import` | Só referência — import deve correr **na VPS** via `import-to-vps.sh` |

## Resultado esperado

Todos os dados do Supabase disponíveis na VPS, com o mesmo schema, sem dependência do Supabase Cloud. O frontend e a API passam a usar apenas `DATABASE_URL` na VPS.
