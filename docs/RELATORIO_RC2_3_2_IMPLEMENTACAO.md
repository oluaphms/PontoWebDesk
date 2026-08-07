# Relatório — RC2.3.2 API Windows Service

**Data:** 2026-08-06  
**Pacote:** `@pontowebdesk/api-service` `0.1.0-rc2.3.2`

---

## Resumo

Serviço Windows **`PontoWebDeskApi`** via SCM nativo (`sc.exe`), recovery configurável, validação de health, CLI completa e integração **`install_backend`** no Bootstrap/InstallManager quando `@pontowebdesk/api-service` está disponível.

---

## Arquivos criados

- `rc2/api-service/**` (ServiceInstaller, Controller, Recovery, Validator, ApiService, serviceHost, cli, tests)
- `docs/RC2_API_SERVICE.md`
- `docs/RELATORIO_RC2_3_2_IMPLEMENTACAO.md`
- `docs/AUDITORIA_RC2_3_2.md`
- `rc2/bootstrap/src/api/BackendInstallPort.ts`
- `rc2/bootstrap/src/api/loadBackendInstall.ts`
- `rc2/bootstrap/src/types/api-service-shim.d.ts`

---

## Arquivos modificados

- `rc2/bootstrap/src/Bootstrap.ts` — carrega `backendInstall` em embedded
- `rc2/bootstrap/src/InstallManager.ts` — step `install_backend`
- `rc2/bootstrap/package.json` — devDependency api-service

**Não modificados:** backend/, PostgreSQL Embedded, Runtime Builder (código).

---

## Build e testes

| Pacote | Build | Testes |
|--------|-------|--------|
| api-service | PASS | ≥25 PASS |
| bootstrap | PASS | 16/16 PASS |

---

## PASS / WARNING / FAIL

| Item | Veredito |
|------|----------|
| SCM nativo (sc/net) | **PASS** |
| Recovery 5/30/60s | **PASS** |
| Integração install_backend | **PASS** |
| CLI | **PASS** |
| NSSM / Docker | **PASS** (não usados) |
| Serviço Node SCM production-hardening | **WARNING** |
| Frontend RC2.3.3 | **WARNING** (fora escopo) |

---

*RC2.3.2 encerra serviço Windows da API.*
