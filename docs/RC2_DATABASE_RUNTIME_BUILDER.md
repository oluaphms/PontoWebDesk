# RC2.2.5 — Database Runtime Builder

**Fonte operacional:** `docs/RC2_BASELINE.md` (**RC2-BASELINE-1.0.0**)  
**Versão:** `0.1.0-rc2.2.5`  
**Pacote:** `@pontowebdesk/database-runtime-builder`  
**Escopo:** produzir runtime PostgreSQL **16.8 x64** redistribuível para `%ProgramFiles%\PontoWebDesk\Database\` (consumido pelo Bootstrap RC2.2 **sem alterações**).

---

## Arquitetura

Módulo **independente** em `rc2/database-runtime-builder/`. Não depende do Bootstrap, InstallManager, Updater ou scripts de migração.

| Componente | Responsabilidade |
|------------|------------------|
| `discoverSource.ts` | Localiza instalação PG no host de build (`RC2_PG_SOURCE_ROOT`, `Program Files\PostgreSQL\16`) |
| `builder.ts` | Copia subset curado, gera `VERSION` e `manifest.json` |
| `manifest.ts` | SHA256, tamanho, data, versão e categoria por arquivo |
| `validator.ts` | Integridade pós-build (binários, dirs, hashes) |
| `cli.ts` | `build` / `validate` para CI e release |

```mermaid
flowchart LR
  A[PG 16.8 instalado no build host] --> B[discoverSource]
  B --> C[builder copy curado]
  C --> D[manifest + VERSION]
  D --> E[validator]
  E --> F[Database/ redistribuível]
  F --> G[Bootstrap RC2.2 precheck]
```

---

## Fluxo

1. **Descoberta:** executar `postgres.exe --version` na origem; aceitar **somente** major **16** e minor **8**.
2. **Cópia:** `bin/` (DLLs + EXEs exceto StackBuilder/pgAdmin), `lib/`, `share/`, `locale/` (de `share/locale`), `licenses/`, `tools/` (`psql`, `pg_dump`, `pg_restore`) — alinhado a `docs/RC2_INSTALL_LAYOUT.md` e `docs/RC2_POSTGRESQL_EMBEDDED.md`.
3. **Metadados:** `VERSION` com `16.8`; `manifest.json` com lista completa de arquivos.
4. **Validação:** falha fechada se faltar item obrigatório ou hash divergir.
5. **Instalação:** o instalador/Inno copia a árvore para `C:\Program Files\PontoWebDesk\Database\`; o Bootstrap encontra `bin\postgres.exe` no path já configurado em `ConfigManager`.

### CLI

```powershell
cd rc2\database-runtime-builder
npm install
npm run build

# Requer PostgreSQL 16.8 x64 no host (ex.: RC2_PG_SOURCE_ROOT)
npm start -- build --out D:\artifacts\Database --source "C:\Program Files\PostgreSQL\16"

npm start -- validate --out D:\artifacts\Database
```

Variáveis de ambiente:

| Variável | Uso |
|----------|-----|
| `RC2_PG_SOURCE_ROOT` | Raiz da instalação PG 16.8 (prioridade) |
| `PWD_PG_SOURCE_ROOT` | Alias |
| `PGROOT` | Alias |

---

## Estrutura de saída

```
Database/
  bin/           # postgres.exe, initdb.exe, pg_ctl.exe, pg_isready.exe, DLLs
  tools/         # psql.exe, pg_dump.exe, pg_restore.exe (layout RC2)
  lib/
  share/
  locale/
  licenses/
  VERSION
  manifest.json
```

Contrato Bootstrap (inalterado): `%ProgramFiles%\PontoWebDesk\Database\bin\postgres.exe`.

---

## Manifesto (`manifest.json`)

- `schemaVersion`: 1  
- Metadados globais: produto, `postgresqlVersion`, `architecture`, `builtAt`, `builderVersion`  
- Por arquivo: `path`, `name`, `size`, `sha256`, `data` (mtime ISO), `versao`, `category`

O manifesto **não** inclui a si mesmo na lista de hashes (evita recursão). Revalidar após editar manualmente qualquer arquivo.

---

## Validação

O validator verifica:

- `bin/postgres.exe`, `initdb.exe`, `pg_ctl.exe`, `pg_isready.exe`
- Diretórios `bin`, `lib`, `share`
- Recomendados: `locale`, `licenses`
- `VERSION`, `manifest.json`
- SHA256 e tamanho de cada entrada do manifesto
- Modo estrito (`rejectExtraFiles`): arquivos no disco não listados → **FAIL**

---

## Limitações

- **Build host:** é necessário PostgreSQL **16.8 x64** instalado **no momento do build**; o artefato final é autocontido (cliente não precisa de PG pré-instalado).
- **Não usa Docker** nem MSI EDB no destino.
- **Não executa** `initdb`, serviço, roles nem migrations (fora do escopo RC2.2.5).
- **VC++ runtime:** DLLs MSVC podem exigir Visual C++ Redistributable x64 no cliente (precheck RC2.2 / ADR pendente).
- **Patch PG:** aceita `16.8.x`; rejeita `16.7`, `17.x`, `18.x`, etc.
- **Tamanho:** `share/` completo aumenta o instalador; otimizações futuras são RC2.2.x sem mudar Bootstrap.

---

## Licenciamento

PostgreSQL é licenciado sob a [PostgreSQL License](https://www.postgresql.org/about/licence/) (similar BSD). O builder copia arquivos de copyright/licença para `licenses/` quando presentes na origem EDB. **Compliance jurídico** do redistribuível permanece responsabilidade do release (ADR RC2-PG-001 / D-04 em `docs/RC2_2_DECISOES_PENDENTES.md`).

---

## Estratégia de atualização

- **Patch 16.8.x:** rebuild do runtime, bump em `Database/VERSION` + manifest, substituir árvore no instalador, restart serviço PG (sem `pg_upgrade`).
- **Major/minor fora de 16.8:** **não** gerar runtime com este builder; nova fase RC2-PG + Bootstrap discovery.

---

## Critérios de aceite (RC2.2.5)

| # | Critério | Status esperado |
|---|----------|-----------------|
| 1 | Módulo independente em `rc2/database-runtime-builder` | PASS |
| 2 | Saída com layout `Database/` documentado | PASS |
| 3 | Pin 16.8 x64 com erro claro se versão diferente | PASS |
| 4 | `manifest.json` com SHA256 completo | PASS |
| 5 | Validator fail-closed | PASS |
| 6 | Testes automatizados `npm test` no pacote | PASS |
| 7 | Bootstrap **não** modificado | PASS |
| 8 | Homologação VM com PG embarcado real | WARNING até build em host 16.8 + cópia para PF |

---

## Referências

- `docs/RC2_BASELINE.md` (RC2-BASELINE-1.0.0)  
- `docs/RC2_POSTGRESQL_EMBEDDED.md` (RC2-PG-1.0.1)  
- `docs/RC2_INSTALL_LAYOUT.md` (RC2-LAYOUT-1.0.1)  
- `docs/RELATORIO_RC2_2_5_IMPLEMENTACAO.md`
