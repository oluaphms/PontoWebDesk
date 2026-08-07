# Relatório — RC2.2.6 Baseline técnica

**Data:** 2026-08-06  
**Fase:** RC2.2.6 — Consolidação da Baseline RC2  
**Fonte oficial criada:** `docs/RC2_BASELINE.md` (**RC2-BASELINE-1.0.0**)  
**Restrições:** sem RC2.3; sem alteração de Bootstrap / PostgreSQL Embedded / Runtime Builder (código funcional)

---

## 1. Resumo executivo

A fase RC2.2.6 **congelou a baseline operacional** RC2.2 em um único documento normativo (`RC2_BASELINE.md`), **unificou nomenclatura de pastas**, **resolveu `secrets.json` vs `secrets.dat`** (oficial: **`secrets.json`** na baseline RC2.2; `secrets.dat` reservado RC2.3+), **sincronizou versões de documentação** (`0.2.0-rc2.2`, `rc2.2-baseline`, patches LAYOUT/PG 1.0.1), e **atualizou** Layout, Bootstrap doc, PG doc, Runtime Builder doc, schemas `install-state` e README do pacote.

**Código funcional** dos três pacotes RC2.2 **não foi modificado** (restrição explícita). Persistência runtime de `phase` / `productVersion` em `InstallState.ts` permanece com valores RC2.1 até fase futura que autorize patch de constantes no Bootstrap.

---

## 2. Atividades executadas

| # | Atividade | Resultado |
|---|-----------|-----------|
| 1 | Nomes oficiais PF/PD | Consolidados em `RC2_BASELINE.md` §2–4 |
| 2 | secrets.json vs secrets.dat | **Oficial RC2.2.6:** `Config\secrets.json` |
| 3 | Sincronização versões RC2 | Docs + schemas; histórico RC2.1 marcado obsoleto |
| 4 | `docs/RC2_BASELINE.md` | Criado |
| 5 | Verificação duplicidades | Tabela §5 |
| 6 | Atualização documentação | Arquivos listados §3 |
| 7 | Critério PASS baseline | §6 |

---

## 3. Arquivos criados e modificados

### Criados

| Arquivo |
|---------|
| `docs/RC2_BASELINE.md` |
| `docs/RELATORIO_RC2_2_6_BASELINE.md` |

### Modificados (documentação / templates apenas)

| Arquivo | Alteração |
|---------|-----------|
| `docs/RC2_INSTALL_LAYOUT.md` | `RC2-LAYOUT-1.0.1`, subtree `Database\` completa, `secrets.json`, refs baseline |
| `docs/RC2_BOOTSTRAP.md` | Reescrito para RC2.2 / `0.2.0-rc2.2` / embedded |
| `docs/RC2_POSTGRESQL_EMBEDDED.md` | `RC2-PG-1.0.1`, `secrets.json`, paths layout |
| `docs/RC2_DATABASE_RUNTIME_BUILDER.md` | Ref baseline |
| `docs/RC2_2_DECISOES_PENDENTES.md` | Alinhamento secrets (1 linha) |
| `rc2/bootstrap/schemas/install-state.json` | `phase`, `productVersion` baseline |
| `rc2/bootstrap/schemas/install-state.example.json` | idem |
| `rc2/bootstrap/README.md` | Baseline + versão pacote |

### Não modificados (conforme escopo)

| Área |
|------|
| `rc2/bootstrap/src/**` |
| `rc2/database-runtime-builder/**` (código) |
| `docs/ARQUITETURA_INSTALADOR_PROFISSIONAL_RC2.md` (RC2-ARCH estratégico intacto) |
| Relatórios/auditorias históricas (`AUDITORIA_*`, `HOMOLOGACAO_*`) |

---

## 4. Nomenclatura oficial (atividade 1)

Todos os segmentos abaixo estão **único** em PascalCase sob `PontoWebDesk` — **sem** alias `database`, `DB`, `Postgres` como pasta:

`Backend`, `Frontend`, `Database`, `Agent`, `Updater`, `Bin`, `Migrations`, `Config`, `Storage`, `Logs`, `Backups`, `Temp`, `Rollback`, `Updates`.

**PASS** — convenção registrada em `RC2_BASELINE.md` §2.

---

## 5. Verificação de duplicidades e fontes de verdade (atividade 5)

| Item | Política baseline | Múltiplas fontes? | Veredito |
|------|-------------------|-------------------|----------|
| Nomes de pastas PF/PD | `RC2_BASELINE.md` §2 | Docs RC2 alinhados | **PASS** |
| Path segredos | `Config\secrets.json` | Layout + PG + baseline | **PASS** |
| `secrets.dat` | Apenas RC2.3+ reservado | Mencionado como futuro, não dual ativo | **PASS** |
| Manifest produto | `layout.manifest.json` (PF) | Distinto de Database/Migrations | **PASS** (papéis separados) |
| Manifest PG | `Database\manifest.json` | Builder only | **PASS** |
| Manifest migrations | `Migrations\manifest.json` | Distinto | **PASS** |
| VERSION produto | `PF\VERSION` | Distinto de Database | **PASS** |
| VERSION PG | `Database\VERSION` = 16.8 | Distinto de PG_VERSION em pgdata | **PASS** |
| Versão pacote Bootstrap | `0.2.0-rc2.2` | Doc + baseline + schema | **PASS** |
| Versão install-state runtime | `InstallState.ts` grava RC2.1 | Template/schema baseline RC2.2 | **WARNING** |
| Arquitetura estratégica | RC2-ARCH-1.0.0 | Baseline operacional complementa | **PASS** |
| Homologação VM | Histórico reprovado | Não alterado RC2.2.6 | **WARNING** |

---

## 6. Sincronização de versões (atividade 3)

| Identificador | Valor baseline RC2.2.6 |
|---------------|--------------------------|
| RC2-ARCH | `1.0.0` (documento inalterado) |
| RC2-LAYOUT | **`1.0.1`** (patch editorial) |
| RC2-PG | **`1.0.1`** (patch editorial) |
| RC2-BASELINE | **`1.0.0`** (novo) |
| Bootstrap npm | `0.2.0-rc2.2` |
| Runtime Builder npm | `0.1.0-rc2.2.5` |
| install-state `phase` (template) | `rc2.2-baseline` |
| install-state `productVersion` (template) | `0.2.0-rc2.2` |

Referências **`0.1.0-rc2.1`** / **`rc2.1-complete`** removidas dos docs RC2 ativos; mantidas apenas como histórico em `RC2_BASELINE.md` §1.3.

---

## 7. Matriz PASS / WARNING / FAIL por módulo

| Módulo | PASS | WARNING | FAIL |
|--------|------|---------|------|
| **RC2_BASELINE (novo)** | Fonte única operacional | — | — |
| **RC2-LAYOUT doc** | Nomes + Database tree + secrets | ADR-001 pendente (pré-existente) | — |
| **RC2-PG doc** | Alinhado baseline | — | — |
| **RC2_BOOTSTRAP doc** | Sincronizado RC2.2 | — | — |
| **Runtime Builder doc** | Ref baseline | — | — |
| **Install State schemas** | Templates baseline | Runtime `InstallState.ts` drift | — |
| **Bootstrap código** | Paths = baseline §5 | Constants phase/version | — |
| **Integração campo** | — | Homologação VM pendente | — |

---

## 8. Tabela — Módulo × Status × Compatibilidade

| Módulo | Status RC2.2.6 | Compatibilidade baseline |
|--------|----------------|---------------------------|
| RC2_BASELINE | **Congelado** | N/A (referência) |
| RC2-ARCH | **Congelado** | Estratégico; complementado pela baseline |
| RC2-LAYOUT | **1.0.1** | **Alta** |
| RC2-PG | **1.0.1** | **Alta** |
| Bootstrap (doc) | **Sincronizado** | **Alta** |
| Bootstrap (runtime metadata) | **Drift conhecido** | **Média** |
| PostgreSQL Embedded (código) | **Inalterado** | **Alta** (paths/secrets filename) |
| Runtime Builder (código) | **Inalterado** | **Alta** |
| Install State (schema file) | **Sincronizado** | **Alta** |

---

## 9. Veredito final da fase RC2.2.6

### Critérios do enunciado (§7)

| Critério | Atendido? |
|----------|-----------|
| Única baseline documental | **Sim** — `RC2_BASELINE.md` |
| Única convenção de nomenclatura (oficial) | **Sim** — §2 baseline |
| Única convenção de versionamento (oficial) | **Sim** — §1 baseline |
| Única fonte oficial operacional da arquitetura RC2.2 | **Sim** — baseline prevalece sobre conflitos doc |

### Veredito emitido: **PASS** (consolidação documental RC2.2.6)

**Ressalva única (WARNING operacional, não revoga PASS da fase):** até autorização de alterar `InstallState.ts`, novos installs podem persistir `phase: rc2.1-complete` e `productVersion: 0.1.0-rc2.1` enquanto templates/schemas já refletem **`rc2.2-baseline`** / **`0.2.0-rc2.2`**. Isso foi **aceito** para cumprir “Não alterar Bootstrap”.

---

## 10. Próximo passo recomendado (fora RC2.2.6)

1. Build redist PG 16.8 via Runtime Builder e addendum homologação VM.  
2. Fase futura **micro-patch Bootstrap** (somente constantes `PHASE` / `PRODUCT_VERSION`) — **não** RC2.3.  
3. RC2.3 somente após gate explícito de produto (API runtime, serviços Windows).

---

*RC2.2.6 concluída — baseline técnica congelada em `RC2-BASELINE-1.0.0`.*
