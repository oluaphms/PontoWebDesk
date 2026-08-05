# SaaS-Local vs SaaS-Demo — portas

## Diagnóstico (ago/2026)

`npm run dev` na raiz falhava com **Port 3010 is already in use** porque o
container Docker `pontowebdesk-saas-demo-frontend-1` publicava `0.0.0.0:3010`.
O backend da demo também ocupava a **3000**.

## Mapa de portas (host)

| Serviço | SaaS-Local (monorepo raiz) | SaaS-Demo (Docker) |
|---------|----------------------------|--------------------|
| Frontend | **3010** (Vite) | **3110** → container 3010 |
| Backend API | **3000** (Express) | **3100** → container 3000 |
| PostgreSQL | **5432** | **5433** → container 5432 |

Os dois ambientes podem coexistir no mesmo PC.

## SaaS-Local — URLs

- Frontend: http://localhost:3010  
- API: http://localhost:3000/api  
- Agent REP (`npm run rep:agent`): `REP_SAAS_URL` → base sem `/api`, tipicamente `http://localhost:3000`

Configuração: `.env.development`, `backend/.env.development`, `vite.config.ts`.

Override opcional da porta do Vite: `VITE_DEV_PORT=3020`.

## SaaS-Demo — URLs

- Frontend: http://localhost:3110  
- API: http://localhost:3100/api  

## Scripts úteis (raiz)

| Script | Função |
|--------|--------|
| `scripts\local\verificar-portas.bat` | Mostra quem usa 3010/3000/5432/55432 e 3110/3100/5433 |
| `scripts\local\iniciar-local.bat` | Avisa conflitos, sobe API + Vite |
| `scripts\local\parar-local.bat` | Encerra processos Node do Vite/API locais |
| `scripts\local\parar-demo-docker.bat` | `docker compose down` na pasta SaaS-Demo |
| `scripts\local\iniciar-postgres-local.bat` | Sobe o Postgres Docker do SaaS-Local (`pg16-restore` :55432) |

## Banco de dados (importante)

| Ambiente | Container | Porta host |
|----------|-----------|------------|
| **SaaS-Local** | `pg16-restore` | **55432** |
| **SaaS-Demo** | `pontowebdesk-saas-demo-postgres-1` | **5433** |

O backend local (`backend/.env.development`) usa `127.0.0.1:55432`.  
Se `pg16-restore` estiver parado, `/api/health` retorna 503 e o Master mostra **Failed to fetch**.

Subir o banco local:

```bat
scripts\local\iniciar-postgres-local.bat
```

Depois reinicie a API: `cd backend && npm run dev`

No `.env` da raiz havia uma linha duplicada `VITE_API_URL=http://localhost:3010/`
(incorreta — 3010 é o frontend). Removida; a API local continua em
`.env.development` → `http://localhost:3000/api`.
