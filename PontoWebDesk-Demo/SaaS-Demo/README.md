# PontoWebDesk — SaaS Demo (portátil)

Pacote **independente** para demonstração em qualquer PC com **Docker Desktop**.

## Pré-requisitos

1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado e em execução (Linux engine).
2. Portas livres no host: **3010** (frontend), **3000** (API), **5432** (PostgreSQL).
3. ~4 GB livres (imagens Node + Postgres + build).

## Como iniciar

1. Copie a pasta `SaaS-Demo` para o HD/pendrive.
2. Abra `SaaS-Demo` no Explorer.
3. Dê duplo clique em `scripts\iniciar.bat`.

O script executa `docker compose up -d --build`, aguarda os serviços e abre **http://localhost:3010**.

### URLs

| Serviço | URL |
|---------|-----|
| Frontend | http://localhost:3010 |
| API health | http://localhost:3000/api/health |

### Credenciais Master (demo)

- `owner1@demo.local` / `DemoOwner1!`
- `owner2@demo.local` / `DemoOwner2!`

(Defina/altere em `.env` e `backend/.env` se quiser.)

## Como restaurar o banco

1. **Primeiro start (instalador / start-stack.ps1):** aplica `npm run db:migrate:full` no container backend (schema RC1, incl. Master).

2. **Dados demo opcionais** (se `backup_demo.sql` tiver conteúdo real):

```bat
scripts\restaurar_banco.bat
```

Detalhes: `database/README.md`.

Para gerar um dump novo a partir do PC de desenvolvimento:

```bat
scripts\exportar_backup.bat
```

## Como parar

```bat
scripts\parar.bat
```

Equivale a `docker compose down` (mantém o volume do Postgres, salvo se você usar `down -v`).

## Estrutura

```
SaaS-Demo/
  backend/          # API Express
  frontend/         # App Vite/React
  shared/           # @pontowebdesk/master-contract
  database/         # backup SQL + README
  scripts/          # iniciar / parar / restaurar / exportar
  docker-compose.yml
  .env
  README.md
```

## Notas

- Este pacote **não depende** da pasta original do repositório.
- `node_modules`, `dist`, `.git` e caches **não** são incluídos — o Compose instala deps no build da imagem.
- Uso exclusivo para **demonstração**; não é hardening de produção.
