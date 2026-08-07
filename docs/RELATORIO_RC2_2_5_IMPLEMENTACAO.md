# Relatório — RC2.2.5 Database Runtime Builder

**Data:** 2026-08-06  
**Fase:** RC2.2.5 (exclusiva)  
**Pacote:** `@pontowebdesk/database-runtime-builder` `0.1.0-rc2.2.5`

---

## Resumo executivo

Foi entregue um módulo **independente** em `rc2/database-runtime-builder/` que, a partir de uma instalação **PostgreSQL 16.8 x64** no host de build, monta a árvore redistribuível `Database/` (bin, lib, share, locale, licenses, tools, VERSION, manifest.json), calcula **SHA256** por arquivo, valida integridade e expõe CLI `build` / `validate`. **Bootstrap, InstallManager, Updater, migrações e pipeline RC2.2 homologado não foram alterados.**

---

## Arquivos criados

| Caminho |
|---------|
| `rc2/database-runtime-builder/package.json` |
| `rc2/database-runtime-builder/tsconfig.json` |
| `rc2/database-runtime-builder/vitest.config.ts` |
| `rc2/database-runtime-builder/src/constants.ts` |
| `rc2/database-runtime-builder/src/types.ts` |
| `rc2/database-runtime-builder/src/fsUtil.ts` |
| `rc2/database-runtime-builder/src/discoverSource.ts` |
| `rc2/database-runtime-builder/src/manifest.ts` |
| `rc2/database-runtime-builder/src/validator.ts` |
| `rc2/database-runtime-builder/src/builder.ts` |
| `rc2/database-runtime-builder/src/cli.ts` |
| `rc2/database-runtime-builder/src/index.ts` |
| `rc2/database-runtime-builder/src/runtime.test.ts` |
| `docs/RC2_DATABASE_RUNTIME_BUILDER.md` |
| `docs/RELATORIO_RC2_2_5_IMPLEMENTACAO.md` |

*(Artefatos gerados localmente após `npm run build`: `rc2/database-runtime-builder/dist/`.)*

---

## Arquivos modificados

| Caminho | Motivo |
|---------|--------|
| `rc2/database-runtime-builder/package-lock.json` | Gerado por `npm install` no pacote |

**Nenhum** arquivo em `rc2/bootstrap/`, `InstallManager`, Updater ou scripts de migração foi modificado.

---

## Fluxo implementado

1. **Descoberta** (`discoverPostgreSqlSource`): `RC2_PG_SOURCE_ROOT` / `PWD_PG_SOURCE_ROOT` / `PGROOT` / `%ProgramFiles%\PostgreSQL\16` → `postgres --version` → exige **16.8** (major/minor); rejeita 17, 18, 16.7, etc.
2. **Build** (`buildRuntime` / `buildRuntimeFromSource`): cópia curada de `bin` (DLLs + EXEs, exceto StackBuilder/pgAdmin), `lib`, `share`, `locale` ← `share/locale`, `licenses`, `tools` (psql, pg_dump, pg_restore), grava `VERSION`, gera `manifest.json`.
3. **Validação** (`validateRuntime`): binários obrigatórios, diretórios, hashes SHA256; modo estrito para arquivos extras.
4. **CLI** (`npm start -- build|validate`): saída JSON + exit code 0/1.

---

## Testes executados

Comando (no pacote):

```powershell
cd rc2\database-runtime-builder
npm install
npm run build
npm test
npx vitest run --coverage
```

| Resultado | Detalhe |
|-----------|---------|
| **14/14** testes | PASS |
| Cenários | runtime válido, incompleto, `postgres.exe` ausente, manifest inválido, hash divergente, versão incompatível (16.7/18), arquivos extras, build mínimo end-to-end |

---

## Build executado

| Etapa | Resultado |
|-------|-----------|
| `npm run build` (`tsc`) | **PASS** |
| Build de runtime real contra PG 16.8 no host | **WARNING** — ambiente atual possui PG **18**; `discoverPostgreSqlSource` falha conforme especificação até existir origem 16.8 |

---

## Cobertura de testes (v8)

| Métrica | Valor |
|---------|-------|
| Statements | **69,77%** |
| Branches | **75,70%** |
| Functions | **74,07%** |
| Lines | **69,77%** |

Áreas com cobertura baixa esperada: `cli.ts` (entrypoint), `discoverSource.ts` (spawn real de `postgres.exe` — requer host 16.8).

---

## PASS / WARNING / FAIL por item

| Item | Veredito |
|------|----------|
| Módulo independente (`rc2/database-runtime-builder`) | **PASS** |
| Layout `Database/` (bin, lib, share, locale, licenses, VERSION, manifest) | **PASS** |
| `tools/` para layout RC2 (psql, pg_dump, pg_restore) | **PASS** |
| Pin PostgreSQL **16.8 x64** com erro claro | **PASS** |
| `manifest.json` (nome, tamanho, SHA256, data, versão, categoria) | **PASS** |
| Validator fail-closed | **PASS** |
| Testes via `npm test` no pacote | **PASS** |
| Documentação `RC2_DATABASE_RUNTIME_BUILDER.md` | **PASS** |
| Bootstrap / InstallManager / Updater inalterados | **PASS** |
| Pipeline RC2.2 homologado inalterado | **PASS** |
| Runtime redistribuível **gerado em máquina real 16.8** | **WARNING** |
| Cobertura ≥ 80% global | **WARNING** (69,77%) |
| Homologação VM com PG embarcado funcional | **FAIL** *(pré-requisito: copiar artefato para `%ProgramFiles%\PontoWebDesk\Database\` após build 16.8)* |

---

## Limitações restantes

- Build **requer** PostgreSQL **16.8 x64** instalado no **build host** (não Docker; não MSI no cliente).
- Este host de desenvolvimento (**PG 18**) não pode produzir o redist oficial até instalar side-by-side PG 16.8 ou apontar `RC2_PG_SOURCE_ROOT` para VM/build agent 16.8.
- VC++ Redistributable x64 no cliente ainda depende de precheck RC2.2 (ADR pendente).
- Compliance jurídico redist EDB: ADR RC2-PG-001 / D-04 não fechados nesta entrega.
- `share/` completo aumenta tamanho do instalador; otimização de subset é evolução RC2.2.x.

---

## Próximo passo recomendado

1. Em **build agent ou VM** com PostgreSQL **16.8 x64** (EDB ZIP/portable):  
   `npm start -- build --out D:\artifacts\Database --source "C:\Program Files\PostgreSQL\16"`
2. Validar: `npm start -- validate --out D:\artifacts\Database`
3. Copiar árvore para `C:\Program Files\PontoWebDesk\Database\` na VM de homologação.
4. Reexecutar `RC2_BOOTSTRAP_MODE=embedded` e registrar addendum em `docs/HOMOLOGACAO_RC2_2_VM_REAL.md`.
5. *(Futuro, fora RC2.2.5)* integrar artefato ao pipeline Inno/`verify-installer-runtime-rc2` sem alterar lógica Bootstrap.

---

*Entrega RC2.2.5 concluída conforme escopo; homologação de campo permanece bloqueada até origem PG 16.8 no build.*
