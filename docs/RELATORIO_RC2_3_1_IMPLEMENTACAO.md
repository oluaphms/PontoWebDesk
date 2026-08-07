# Relatório — RC2.3.1 API Runtime Infrastructure

**Data:** 2026-08-06  
**Pacote:** `@pontowebdesk/api-runtime` `0.1.0-rc2.3.1`

---

## Resumo

Entregue módulo **`rc2/api-runtime/`** com infraestrutura para executar o Backend compilado fora do Docker: leitura de `backend.env`, validação de layout RC2, `spawn` do `server/dist/server.js`, health sidecar (`/api/health/live`, `/api/health/ready`, `/api/version`), log JSON em `api-runtime.log` e interfaces de integração futura (Bootstrap / InstallManager / Updater).

**Não** registrado serviço Windows. **Não** alterados: `backend/`, PostgreSQL Embedded, Runtime Builder, Bootstrap (código).

---

## Arquivos criados

| Caminho |
|---------|
| `rc2/api-runtime/package.json` |
| `rc2/api-runtime/tsconfig.json` |
| `rc2/api-runtime/vitest.config.ts` |
| `rc2/api-runtime/src/ApiRuntime.ts` |
| `rc2/api-runtime/src/ConfigLoader.ts` |
| `rc2/api-runtime/src/EnvironmentManager.ts` |
| `rc2/api-runtime/src/RuntimeValidator.ts` |
| `rc2/api-runtime/src/ProcessRunner.ts` |
| `rc2/api-runtime/src/HealthServer.ts` |
| `rc2/api-runtime/src/Logger.ts` |
| `rc2/api-runtime/src/paths.ts` |
| `rc2/api-runtime/src/types.ts` |
| `rc2/api-runtime/src/public.ts` |
| `rc2/api-runtime/src/cli.ts` |
| `rc2/api-runtime/src/integration/hooks.ts` |
| `rc2/api-runtime/tests/**/*.test.ts` |
| `rc2/api-runtime/tests/helpers/tempLayout.ts` |
| `docs/RC2_API_RUNTIME.md` |
| `docs/RELATORIO_RC2_3_1_IMPLEMENTACAO.md` |
| `docs/AUDITORIA_RC2_3_1.md` |

---

## Arquivos modificados

Nenhum arquivo fora de `rc2/api-runtime/` e `docs/` listados acima.

---

## Build

```powershell
cd rc2\api-runtime
npm run build   # PASS (tsc)
```

---

## Testes

```powershell
npm test        # 24/24 PASS
```

| Suite | Testes |
|-------|--------|
| ConfigLoader | 5 |
| EnvironmentManager | 4 |
| RuntimeValidator | 5 |
| Logger | 2 |
| HealthServer | 5 |
| ApiRuntime + hooks | 3 |
| **Total** | **24** |

---

## Cobertura (v8)

| Statements | Branches | Functions | Lines |
|------------|----------|-----------|-------|
| 72,07% | 80,35% | 80,85% | 72,07% |

Baixa cobertura esperada em `ProcessRunner.ts` e `cli.ts` (spawn/entrypoint não exercitados com backend real).

---

## PASS / WARNING / FAIL

| Item | Veredito |
|------|----------|
| Módulo `rc2/api-runtime` conforme estrutura | **PASS** |
| Sem Docker / compose / Vite | **PASS** |
| Backend monorepo inalterado | **PASS** |
| Bootstrap / PG / Runtime Builder inalterados | **PASS** |
| ≥ 20 testes, 100% PASS | **PASS** (24/24) |
| SCM `PontoWebDeskApi` | **WARNING** — RC2.3.2 |
| Substituição Docker em produção | **WARNING** — requer empacotamento Backend + install_backend |
| Integração InstallManager | **WARNING** — só interfaces |

---

## Próximo passo (RC2.3.2)

Registrar serviço Windows `PontoWebDeskApi` e ligar `install_backend` no InstallManager via `InstallManagerApiRuntimeDelegate`.

---

*RC2.3.1 concluída.*
