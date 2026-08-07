# RC2 Bootstrap

Infraestrutura do instalador profissional — baseline **`RC2-BASELINE-1.0.0`**.

**Pacote:** `@pontowebdesk/rc2-bootstrap` **`0.2.0-rc2.4.2`** (pipeline RC2.4.2)

## Documentação

- **Baseline oficial:** `docs/RC2_BASELINE.md`
- **Bootstrap:** `docs/RC2_BOOTSTRAP.md`

## Modos

- `RC2_BOOTSTRAP_MODE=structural` — pipeline outline (default)
- `RC2_BOOTSTRAP_MODE=embedded` — PostgreSQL embarcado RC2.2
- `RC2_BOOTSTRAP_PG_STUB=1` — stub PG (testes)

## Uso

```bash
cd rc2/bootstrap
npm install
npm run build
npm test
node dist/index.js
node dist/index.js doctor
```

---

## 13. RC2.4.2 STATUS — InstallManager Complete Pipeline

**Marco:** `RC2.4.2`  
**Data:** 2026-08-06

### Implementado

| Área | Detalhe |
|------|---------|
| Pipeline | `InstallPipelineExecutor` — todos os steps `INSTALLING_PIPELINE_STEPS` |
| PostgreSQL | `install_postgresql` … `db_migrate_full` (modo `full`; stub/structural sem binários) |
| Dados iniciais | `import_initial_data` — `Migrations/database/initial.sql` + validação VERSION |
| Backend | `install_backend` — API Service + health |
| Frontend / Agent | validação + `Config/components.json` |
| Serviços | `register_services` + `ServiceManager.stopService` (rollback) |
| Atalhos | `Config/shortcuts.manifest.json` (Setup.exe cria atalhos físicos depois) |
| First run | `backend.env`, dirs ProgramData, health opcional |
| install-state | `completedSteps`, `startedAt`, `finishedAt`, `errors[]`, `phase` |
| Rollback | `RollbackCoordinator` — stop serviços iniciados; logs preservados |
| Testes | `tests/pipelineSteps.test.ts` + regressão bootstrap (29 testes) |

### Modos

- **`structural`** — dry-run professional (valida layout quando possível, sem SCM/PG real)
- **`full`** — embedded install (`RC2_BOOTSTRAP_MODE=embedded`)

### Pendente

- Setup.exe (RC2.4.3+)
- Atalhos físicos Desktop / Menu Iniciar (Inno)
- Updater real (`install_updater` outline)
