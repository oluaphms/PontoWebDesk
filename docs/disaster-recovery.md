# Disaster Recovery — PontoWebDesk (P0.3)

## Escopo

Recuperação do **PostgreSQL VPS** (fonte de verdade do path LOCAL_API).  
Backup JSON por tenant (`/admin/backup`) **não substitui** este procedimento.

## Ambientes

| Ambiente | Stack |
|----------|--------|
| Development | FE local + API local + Postgres local |
| Production | FE Vercel + API VPS + Postgres VPS |

## Backup completo

### O que inclui

- Dump lógico do banco (`pg_dump` formato custom `-Fc`)
- Metadados: data/hora UTC, host, database name, tamanho do arquivo

### O que não inclui

- Uploads de fotos no disco da VPS (`UPLOAD_DIR`) — backup de filesystem separado
- Secrets (`.env`) — fora do dump; guardar em cofre

### Como executar

```bash
# Na máquina com acesso à DATABASE_URL (ou na VPS)
export DATABASE_URL='postgresql://...'
./scripts/disaster-recovery/backup.sh
# Artefato: ./backups/pontowebdesk-YYYYMMDD-HHMMSS.dump
```

### Automação recomendada

- Cron diário na VPS + cópia offsite (S3/outro host)
- Retenção: 7 diários + 4 semanais (ajustar ao contrato)

## Restore completo

```bash
export DATABASE_URL='postgresql://...'   # destino (idealmente vazio/staging)
export BACKUP_FILE=./backups/pontowebdesk-....dump
./scripts/disaster-recovery/restore.sh
```

**Atenção:** `restore.sh` apaga/recria objetos do dump no destino. Nunca apontar para produção sem janela e confirmação.

## Rollback de release (API/FE)

| Superfície | Procedimento | Tempo estimado |
|------------|--------------|----------------|
| Frontend Vercel | Redeploy deployment anterior | 2–10 min |
| API VPS | Checkout tag anterior + `npm run build` + `pm2 restart` | 5–15 min |
| Schema DB | Restore dump pré-migrate (se migration falhou) | 15–60+ min (tamanho) |

## RPO / RTO (definir com evidência do drill)

| Métrica | Alvo piloto (recomendado) | Como medir |
|---------|---------------------------|------------|
| RPO | ≤ 24h (backup diário) ou menor se WAL | Idade do último dump bom |
| RTO | ≤ 2h (piloto) | Tempo restore drill |

Atualizar estes números após o primeiro drill real — **não** usar claims de compliance sem evidência.

## Validação (sem alterar dados de produção)

```bash
export BACKUP_FILE=./backups/....dump
./scripts/disaster-recovery/verify-backup.sh
```

`verify-backup.sh` usa `pg_restore --list` (somente leitura do arquivo). Não conecta ao banco de produção para escrever.

## Procedimento de validação pós-restore (staging)

1. `GET /api/health` e `/api/health/db` → ok  
2. Login admin  
3. Listar employees  
4. Abrir espelho / attendance period  
5. Comparar contagens críticas (`companies`, `employees`, `time_records`) com snapshot prévio  

## Relacionados

- `docs/operacional/backup-dados.md` (export tenant JSON)
- `docs/runbooks/falha-de-dr.md`
- `docs/runbooks/vps-comandos-operacionais.md`
