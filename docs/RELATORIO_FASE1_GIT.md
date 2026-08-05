# FASE 1 — Auditoria Git (PontoWebDesk)

**Data:** 2026-08-04  
**Repo:** `D:\PontoWebDesk_Local` → `origin/main` (`https://github.com/oluaphms/PontoWebDesk.git`)  
**HEAD local vs origin:** `main...origin/main` (working tree com muitas alterações locais)

## Migrations backend (`backend/db/migrations`)

| Escopo | Qtde |
|--------|------|
| No disco | 44 arquivos `.sql` |
| Tracked (git index) | 41 |
| Em `origin/main` | 41 (até `040`) |

- **Não existe `001_*.sql`** — numeração começa em `002` (histórico do projeto; não é gap de arquivo perdido).
- Duplicatas intencionais no histórico: `005_*` (2), `011_*` (2).

### Migrations FORA do Git (untracked)

1. `backend/db/migrations/041_departments_id_default.sql`
2. `backend/db/migrations/042_plan_employee_limit_contracted_seats.sql`
3. `backend/db/migrations/043_vps_rls_all_tenant_tables.sql`

**Impacto:** `git pull` na VPS **não** aplica 041–043 até commit + push (ou cópia manual via SCP).

## VERSION

| Arquivo | Valor | No Git? |
|---------|-------|---------|
| `VERSION` | `1.0.0-rc.1` | **NÃO** (untracked) |
| `installer/VERSION` | `1.0.0-rc.1` | **NÃO** (untracked) |
| `package.json` → `version` | `0.0.0` | SIM (origin também `0.0.0`) |

**Inconsistência:** RC1 usa `1.0.0-rc.1` em arquivos VERSION locais; `package.json` permanece `0.0.0`.

## Arquivos essenciais não commitados (implantação)

| Item | Status |
|------|--------|
| Migrations 041–043 | Untracked |
| `VERSION` / `installer/VERSION` | Untracked |
| Pacote instalador (`installer/scripts/*`, `build-installer.bat`, etc.) | Em grande parte untracked |
| `PontoWebDesk-Demo/` / `SaaS-Demo/` | Untracked (runtime do instalador) |
| Remoção WAVE2 `api/` + várias mudanças backend/front | Modified/Deleted locais (não pushadas nesta sessão) |

## origin/main vs API viva

- `origin/main` **já contém** rotas `/api/health/ready` e `/api/health/live`.
- API pública ainda responde **404** nessas rotas → VPS **não** está no código do `origin/main` atual (esperado após período desligado; exige sync, não é bug de produto).

## Ação necessária antes/durante sync VPS

1. Commit + push de **041, 042, 043** (e idealmente `VERSION`).
2. Na VPS: `git pull` + build + migrate + restart PM2.
