# RC2.3.2 — API Windows Service

**Pacote:** `@pontowebdesk/api-service` `0.1.0-rc2.3.2`  
**Serviço SCM:** `PontoWebDeskApi`  
**Runtime:** `@pontowebdesk/api-runtime` (ProcessRunner + health sidecar)

---

## Escopo

Registro e controle do serviço Windows via **SCM nativo** (`sc.exe`, `net start/stop`) — **sem NSSM**, **sem Docker**.

| Componente | Função |
|------------|--------|
| `ServiceInstaller` | `sc create`, description, start= auto, deploy `Bin\api-service-host.js` |
| `ServiceRecovery` | `sc failure` — 5s / 30s / 60s, reset 86400s |
| `ServiceController` | install/uninstall/start/stop/restart/status |
| `ServiceValidator` | SCM + porta 3000 + health 3011 |
| `ApiService` | Orquestração + `installAndStart()` |
| `serviceHost.js` | binPath → `ApiRuntime.start()` |

**binPath:** `{Backend\node\node.exe} {Bin\api-service-host.js}`

---

## CLI

```powershell
cd rc2\api-service
npm run build
npm start -- install
npm start -- uninstall
npm start -- start
npm start -- stop
npm start -- restart
npm start -- status
npm start -- validate
```

---

## Bootstrap

`install_backend` (embedded + `@pontowebdesk/api-service` instalado):

1. `installAndStart()` — SCM + health sidecar  
2. `validateHealth()`

Env:

| Variável | Efeito |
|----------|--------|
| `RC2_BOOTSTRAP_API_SERVICE=1` | força API service |
| `RC2_BOOTSTRAP_API_SERVICE=0` | desliga |
| `RC2_BOOTSTRAP_API_SERVICE_STUB=1` | skip install_backend |

---

## Limitações RC2.3.2

- Host Node como serviço depende de `sc create` + processo filho (RC2.3.3 pode endurecer host nativo).
- Health `/api/*` na porta **3011** (api-runtime); porta **3000** = Backend.
- Não inclui Frontend (RC2.3.3).

---

## Referências

- `docs/RC2_API_RUNTIME.md`
- `docs/RELATORIO_RC2_3_2_IMPLEMENTACAO.md`
