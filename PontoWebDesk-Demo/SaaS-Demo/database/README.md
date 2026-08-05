# Banco de dados — SaaS Demo

## Motor detectado

- **PostgreSQL 16** (mesmo motor do ambiente local do projeto: `backend/.env.development` apontava para `127.0.0.1:55432`).

## Arquivo de backup

- `backup_demo.sql` — dump em SQL texto (`pg_dump -F p`).

## Como restaurar

1. Com Docker Desktop ligado, na pasta `SaaS-Demo`:

```bat
scripts\restaurar_banco.bat
```

Isso sobe o serviço `postgres` e aplica o SQL via `psql`.

2. Manualmente:

```bat
docker compose up -d postgres
type database\backup_demo.sql | docker compose exec -T postgres psql -U postgres -d pontowebdesk
```

## Como regenerar o backup (máquina de origem)

```bat
scripts\exportar_backup.bat
```

Ajuste `PGHOST`/`PGPORT` no BAT se o Postgres local usar outra porta (ex.: 55432).

## Credenciais do compose

| Item | Valor |
|------|--------|
| User | postgres |
| Password | postgres |
| Database | pontowebdesk |
| Porta no host | 5432 |
