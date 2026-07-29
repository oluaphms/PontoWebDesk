# Scripts Disaster Recovery (P0.3)

Requer `pg_dump` / `pg_restore` no PATH (Linux VPS ou Git Bash/WSL no Windows).

```bash
chmod +x scripts/disaster-recovery/*.sh
export DATABASE_URL='postgresql://...'
./scripts/disaster-recovery/backup.sh
export BACKUP_FILE=./backups/pontowebdesk-....dump
./scripts/disaster-recovery/verify-backup.sh
# Restore (destrutivo):
# CONFIRM_RESTORE=YES ./scripts/disaster-recovery/restore.sh
```

Documentação: `docs/disaster-recovery.md`
