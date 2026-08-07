# RC2.3.1 — API Runtime Infrastructure

**Pacote:** `@pontowebdesk/api-runtime` `0.1.0-rc2.3.1`  
**Baseline:** `docs/RC2_BASELINE.md` (`RC2-BASELINE-1.0.0`)  
**Escopo:** infraestrutura para executar o Backend **sem Docker** — **sem** registro SCM (`PontoWebDeskApi` = RC2.3.2)

---

## Objetivo

Preparar o runtime nativo da API em `%ProgramFiles%\PontoWebDesk\Backend\`, lendo configuração de `%ProgramData%\PontoWebDesk\Config\backend.env`, validando layout RC2 e iniciando `server/dist/server.js` via `spawn`.

**Não altera** o código do monorepo `backend/`.

---

## Módulo

```
rc2/api-runtime/
  src/
    ApiRuntime.ts          # orquestração
    ConfigLoader.ts        # backend.env
    EnvironmentManager.ts  # env obrigatório
    RuntimeValidator.ts    # pré-flight
    ProcessRunner.ts       # spawn Node
    HealthServer.ts        # /api/health/*, /api/version (sidecar)
    Logger.ts              # api-runtime.log
    integration/hooks.ts   # interfaces Bootstrap / InstallManager / Updater
    public.ts              # exports
    cli.ts                 # pwd-api-runtime
  tests/
```

---

## Paths (RC2)

| Item | Path |
|------|------|
| Backend root | `%ProgramFiles%\PontoWebDesk\Backend` |
| Entry | `Backend\server\dist\server.js` |
| Node redist | `Backend\node\node.exe` (fallback: `process.execPath`) |
| Env | `%ProgramData%\PontoWebDesk\Config\backend.env` |
| Log | `%ProgramData%\PontoWebDesk\Logs\api-runtime.log` |
| Health (sidecar) | `127.0.0.1:3011` (default) |

---

## Variáveis obrigatórias (`backend.env`)

`DATABASE_URL`, `PGHOST`, `PGPORT`, `PGDATABASE` — geradas pelo Bootstrap RC2.2 (`DatabaseProvisioner`).

---

## Health (estrutura RC2.3.1)

Servidor **separado** do Backend (não modifica rotas existentes):

| Rota | Significado |
|------|-------------|
| `GET /api/health/live` | Processo api-runtime + health server up |
| `GET /api/health/ready` | `RuntimeValidator` OK |
| `GET /api/version` | Versão do componente api-runtime |

---

## CLI

```powershell
cd rc2\api-runtime
npm install
npm run build
npm start -- --validate    # só validação
npm start -- --dry-run     # health + validate, sem spawn backend
npm start                  # validate + spawn backend
```

---

## Integração futura

Interfaces em `src/integration/hooks.ts`:

- `BootstrapApiRuntimeHook`
- `InstallManagerApiRuntimeDelegate` (`install_backend`)
- `UpdaterApiRuntimeDelegate`
- `API_RUNTIME_SERVICE_NAME` = `PontoWebDeskApi`

**RC2.3.1:** nenhuma alteração no Bootstrap / InstallManager.

---

## Limitações

- Sem Docker / compose / Vite.
- Sem serviço Windows SCM.
- Sem migrations (validação TCP PG apenas).
- Backend real não empacotado automaticamente nesta fase.

---

## Referências

- `docs/RELATORIO_RC2_3_1_IMPLEMENTACAO.md`
- `docs/AUDITORIA_RC2_3_1.md`
