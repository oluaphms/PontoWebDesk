# Auditoria RC2.1 — Gate Review (Bootstrap)

**Data:** 2026-08-06  
**Escopo auditado:** `rc2/bootstrap/`, `docs/RC2_BOOTSTRAP.md`, `docs/RELATORIO_RC2_1_BOOTSTRAP.md`  
**Referência normativa:** `docs/ARQUITETURA_INSTALADOR_PROFISSIONAL_RC2.md` (**RC2-ARCH-1.0.0**)  
**Modo:** revisão somente leitura — **nenhum código alterado**

---

## Resumo executivo

A implementação RC2.1 entrega um **esqueleto modular** (Bootstrap, InstallManager, persistência de estado, precheck mínimo, stubs) coerente com o escopo **estrutural** declarado em `RC2_BOOTSTRAP.md` e `RELATORIO_RC2_1_BOOTSTRAP.md`. Há **boa separação de responsabilidades** entre arquivos, **sem dependências circulares** detectadas e **sem lógica de negócio** da aplicação.

Porém, face à **arquitetura congelada completa**, existem **lacunas materiais**: a máquina de estados **não modela** o pipeline canônico de instalação (PostgreSQL → migrate → componentes → First Run → Completed); `install-state.json` **não registra etapa corrente** conforme § recuperação da arquitetura; **Recovery/rollback** não estão integrados ao fluxo; **CLI** é mínima e frágil a exceções; **testes** cobrem apenas caminho feliz parcial.

| Dimensão | Veredito |
|----------|----------|
| Estrutura RC2.1 (componentes + dry-run) | **PASS** |
| Alinhamento máquina de estados × pipeline RC2-ARCH-1.0.0 | **FAIL** |
| Recovery / rollback × arquitetura §10 / Recuperação | **FAIL** |
| Documentação × código | **WARNING** |
| Prontidão para RC2.2 (sem bloqueio arquitetural grave) | **WARNING** |

**Veredito global desta auditoria:** **WARNING** (base aceitável como fundação RC2.1 estrutural; **não** atende o fluxo de instalação descrito na arquitetura congelada).

**Decisão de gate (liberação):** ver seção final.

---

## 1. Arquitetura (SRP, acoplamento, coesão, DIP, OCP)

### Pontos positivos (**PASS**)

- **SRP:** cada classe em `src/` concentra uma preocupação (paths, log, validação, estado, orquestração, recovery stub, SCM stub).
- **Coesão:** `InstallStateStore` + `stateMachine.ts` isolam persistência e regras de transição.
- **Acoplamento:** `InstallManager` depende de **tipos** (`InstallManagerDeps`) e abstrações implícitas via injeção manual em `Bootstrap.ts` — sem import circular.
- **Grafos de import:** `stateMachine` → `types`; `InstallState` → `stateMachine` + `types`; demais módulos folha ou hub (`Bootstrap`).

### Achados

| ID | Arquivo | Linha | Causa | Impacto | Gravidade | Sugestão |
|----|---------|-------|-------|---------|-----------|----------|
| ARQ-01 | `src/InstallManager.ts` | 7–12 | Dependências concretas (`InstallStateStore`, `Validation`, …), sem interfaces | RC2.2 dificulta mocks/alternativas (DbMigrate, steps plugáveis) | Média | Introduzir interfaces mínimas (`IInstallStateStore`, `IValidation`) na RC2.2 sem quebrar API |
| ARQ-02 | `src/Bootstrap.ts` | 21–27 | Expõe todos os componentes como `readonly` públicos | Consumidores acoplam-se a internals; API instável | Baixa | Preferir façade com getters limitados ou factory documentada |
| ARQ-03 | `src/InstallManager.ts` | 18–96 | Orquestrador monolítico; extensão exige editar classe | **OCP** fraco para dezenas de etapas RC2 | Alta | RC2.2: pipeline por `InstallStep` registrável |
| ARQ-04 | `docs/RC2_BOOTSTRAP.md` | 35 | Diagrama `VAL --> CFG` | Documentação incorreta: `Validation` recebe `BootstrapPaths`, não `ConfigManager` | Baixa | Corrigir diagrama na próxima revisão doc |
| ARQ-05 | `src/InstallManager.ts` | 65 | `registerService()` é `async`; chamada **sem** `await` | Promise flutuante; ordem log/persistência vs stub indefinida em RC2.2 | Média | `await` ou remover chamada até RC2.2 real |

**DIP:** parcial — injeção existe, mas sem contratos formais (**WARNING**).

**OCP:** insuficiente para pipeline completo RC2 (**FAIL** como preparação de extensão, não como violação RC2.1 estrutural).

---

## 2. Máquina de estados

### Modelo implementado

Estados: `NOT_STARTED`, `PRECHECK`, `INSTALLING`, `INSTALLED`, `FAILED`, `RECOVERY` (`src/types.ts`, `src/stateMachine.ts`).

### Pipeline solicitado na auditoria × RC2-ARCH-1.0.0 (§ fluxo vertical / sequência §4)

| Etapa canônica (auditoria / arquitetura) | Representação no código |
|------------------------------------------|-------------------------|
| Idle | `NOT_STARTED` (aprox.) |
| PreCheck | `PRECHECK` |
| Install PostgreSQL … Register Services … First Run | **Ausente** (deveria ser sub-estados ou `currentStep` durante `INSTALLING`) |
| Completed | `INSTALLED` (**inalcançável** no fluxo RC2.1) |

A arquitetura exige: *«Cada etapa grava em `install-state.json`»* (`ARQUITETURA…RC2.md` ~L583) e *«Etapa corrente / versão schema»* (~L888). O schema atual **só** persiste `state` coarse + `history` — **sem campo de etapa** (`installPostgresql`, `dbMigrateFull`, etc.).

### Análise formal (`stateMachine.ts`)

| Verificação | Resultado |
|-------------|-----------|
| Transições inválidas bloqueadas | **Sim** — `assertTransition` em `InstallState.ts:55` |
| `NOT_STARTED` → `INSTALLED` | **Negada** (correto) |
| `FAILED` → `PRECHECK` | **Permitida** (L9) — **sem implementação**; retry ambíguo vs RECOVERY |
| `INSTALLED` → qualquer | **Nenhuma** — estado terminal; repair/uninstall não modelados |
| Loops | `FAILED`→`PRECHECK`→…→`FAILED`; `RECOVERY`→`NOT_STARTED`→…→`RECOVERY` — possíveis se expostos |
| Estados inalcançáveis (RC2.1) | **`INSTALLED`** no dry-run; **`RECOVERY`** nunca pelo `InstallManager` |
| Rollback | **Não modelado** (arquitetura §10 / Recuperação exige rollback install parcial) |
| Fail-closed | Precheck falho → `FAILED` (**OK**); estados inválidos → `throw` (**OK**); JSON corrompido → exceção não tratada (**parcial**) |

| ID | Arquivo | Linha | Causa | Impacto | Gravidade | Sugestão |
|----|---------|-------|-------|---------|-----------|----------|
| SM-01 | `src/types.ts` | 24–32 | Ausência de `currentStep` / enum de etapas | Não cumpre arquitetura para retomada/rollback por etapa | **Alta** | Estender schema v1 ou v2 com `step` + ADR de compatibilidade |
| SM-02 | `src/InstallManager.ts` | 71–95 | Nenhum caminho para `INSTALLED` | Completed inalcançável | **Alta** (RC2.2+) | Steps finais + transição `INSTALLING`→`INSTALLED` |
| SM-03 | `src/stateMachine.ts` | 9 | `FAILED` → `PRECHECK` sem fluxo | Retentativa inconsistente com RECOVERY | Média | Remover aresta ou implementar `retryFromFailed()` documentado |
| SM-04 | `src/InstallState.ts` | 41–44 | `JSON.parse` sem tratamento | Install quebrado trava Bootstrap | Média | RC2.2: quarentena + `FAILED` + código EXxxx |
| SM-05 | `src/InstallManager.ts` | 29–36 | Reexecução em `FAILED`/`INSTALLED` lança erro | Fail-closed OK; repair CLI inexistente | Média | Comando `repair` + RecoveryManager |

**Veredito seção 2:** **FAIL** em relação ao pipeline RC2-ARCH-1.0.0; **PASS** apenas para máquina coarse RC2.1 documentada.

---

## 3. Recovery Manager

Implementação: `src/RecoveryManager.ts` — apenas transições de estado (`enterRecovery`, `resetToNotStarted`).

| Verificação | Resultado |
|-------------|-----------|
| Rollback parcial | **Não** |
| Rollback total | **Não** |
| Persistência | **Sim** — via `InstallStateStore.save` |
| Estado inconsistente (arquivo inválido) | **Não tratado** |
| Integração com `InstallManager` | **Não** — componente órfão no fluxo seco |
| Entrada RECOVERY desde `PRECHECK` | **Proibida** — `throw` L23 |

| ID | Arquivo | Linha | Causa | Impacto | Gravidade | Sugestão |
|----|---------|-------|-------|---------|-----------|----------|
| REC-01 | `src/RecoveryManager.ts` | 14–27 | Sem remoção de serviços/arquivos | Não atende fluxo arquitetura § Recuperação (rollback install) | **Alta** | RC2.2+: orquestrar com `ServiceManager` real + limpeza ProgramData |
| REC-02 | `src/Bootstrap.ts` | 42–48 | `RecoveryManager` instanciado mas não usado em `runStructuralDryRun` | API morta; falsa sensação de cobertura | Média | Documentar explicitamente ou wire mínimo em falha INSTALLING |
| REC-03 | `src/RecoveryManager.ts` | — | Sem idempotência / concorrência | Duplo Setup pode corromper histórico | Média | Lock file ou transação atômica write |

**Veredito seção 3:** **FAIL** vs arquitetura de recuperação; **PASS** vs escopo RC2.1 “sem restore”.

---

## 4. Install State / schema

**Arquivos:** `schemas/install-state.json`, `schemas/install-state.example.json`, runtime via `InstallStateStore`.

| Campo | Obrigatório implícito | Presente |
|-------|----------------------|----------|
| `schemaVersion` | Sim | Sim (fixo `1`) |
| `state` | Sim | Sim |
| `updatedAt` | Sim | Sim |
| `architectureVersion` | Recomendado | Sim |
| `phase` | Informativo | Sim |
| `history` | Sim | Sim |
| `lastError` | Em FAILED | Sim |
| **Etapa corrente (arch)** | Sim | **Não** |
| **Versão produto / build** | Arch tabela rollback | **Não** |

| ID | Arquivo | Linha | Causa | Impacto | Gravidade | Sugestão |
|----|---------|-------|-------|---------|-----------|----------|
| IS-01 | `src/types.ts` | 24–32 | Schema sem `step` | Incompatível com “etapa corrente” RC2-ARCH | Alta | Campo opcional `step?: InstallStepId` |
| IS-02 | `src/InstallState.ts` | 43–45 | Validação mínima (`schemaVersion`, `state`) | Campos extras ignorados; versões futuras frágeis | Baixa | Validador JSON Schema dedicado |
| IS-03 | `schemas/install-state.json` vs `.example.json` | — | Dois templates similares | Duplicidade confusa | Baixa | Unificar ou documentar diferença |
| IS-04 | Arquitetura vs código | — | Log oficial `install.log`; código usa `bootstrap.log` | Suporte cruzado difícil | Média | Renomear ou dual-write na RC2.2 |

**Expansibilidade:** `history[]` e `phase` ajudam; falta `step` e versionamento de produto (**WARNING**).

---

## 5. CLI (`src/index.ts`)

| Verificação | Resultado |
|-------------|-----------|
| Comandos | **Um único** — dry-run implícito |
| Validações | Delegadas ao `Validation` |
| Mensagens | JSON stdout; sem stderr humanizado |
| Tratamento de erro | **Ausente** — exceções não capturadas |

| ID | Arquivo | Linha | Causa | Impacto | Gravidade | Sugestão |
|----|---------|-------|-------|---------|-----------|----------|
| CLI-01 | `src/index.ts` | 4–7 | Sem `try/catch` | Exit code não determinístico em falha de I/O | Média | Capturar e emitir JSON `{ ok:false, error }` |
| CLI-02 | `src/index.ts` | — | Sem `--help`, repair, uninstall | Setup Inno não tem contrato CLI | Média | Definir interface CLI RC2.2 antes do Inno |
| CLI-03 | `package.json` | 7–9 | `bin` aponta `index.js` (dry-run destrutivo?) | Executar bin sempre muta ProgramData | Média | Subcomando `dry-run` vs `install` |

**Veredito seção 5:** **WARNING**.

---

## 6. Public API (`src/public.ts`)

| Verificação | Resultado |
|-------------|-----------|
| Dependências internas expostas | Exporta classes concretas + `stateMachine` — aceitável, porém amplo |
| API pequena | **Não** — 8 módulos + tipos |
| API estável | Sem `exports` no `package.json`; consumidor depende de caminho `dist/public.js` |
| `public.ts` vs `index.ts` | Entry CLI ≠ barrel público |

| ID | Arquivo | Linha | Causa | Impacto | Gravidade | Sugestão |
|----|---------|-------|-------|---------|-----------|----------|
| API-01 | `package.json` | — | Falta `"exports": "./dist/public.js"` | Instabilidade de import em monorepo | Média | Campo `exports` + `types` |
| API-02 | `src/public.ts` | 4–8 | Exporta `InstallManager` e internals | Superfície grande para Setup.exe | Baixa | Export mínimo: `Bootstrap`, tipos, `INSTALL_STATES` |
| API-03 | `src/Bootstrap.ts` | 21–27 | Campos públicos mutáveis indiretamente via sub-objetos | Encapsulamento fraco | Baixa | Readonly façade |

**Veredito seção 6:** **WARNING** (não vaza segredos; superfície ampla).

---

## 7. Documentação × código

| Documento | Consistência |
|-----------|--------------|
| `RC2_BOOTSTRAP.md` | Alinhado ao código RC2.1; diagrama `Validation→ConfigManager` errado; deixa claro limites |
| `RELATORIO_RC2_1_BOOTSTRAP.md` | Afirma **PASS** e “Seguir RC2-ARCH-1.0.0” — **otimista** para pipeline/etapas/recovery da arquitetura |
| `README.md` | Consistente |

| ID | Arquivo | Linha | Causa | Impacto | Gravidade | Sugestão |
|----|---------|-------|-------|---------|-----------|----------|
| DOC-01 | `RELATORIO_RC2_1_BOOTSTRAP.md` | 59, 79 | “Seguir RC2-ARCH” sem ressalvar ausência de etapas | Gate review pode assumir completude | Média | Nota explícita: alinhamento **estrutural**, não funcional |
| DOC-02 | `RC2_BOOTSTRAP.md` | 35 | Ligação Validation–Config | Diagrama enganoso | Baixa | Ajuste Mermaid |

**Veredito seção 7:** **WARNING**.

---

## 8. Testes (`src/Bootstrap.test.ts`)

| Aspecto | Cobertura |
|---------|-----------|
| Transições | 2 casos (`canTransition`) |
| Dry-run win32 | 2 testes condicionais |
| `InstallStateStore` | 1 teste history |
| RecoveryManager | **0** |
| markFailed / FAILED | **0** |
| JSON inválido | **0** |
| CLI | **0** |
| Estados proibidos / loops | **0** |
| Não-win32 precheck fail | **Não assertado** |

| ID | Arquivo | Linha | Causa | Impacto | Gravidade | Sugestão |
|----|---------|-------|-------|---------|-----------|----------|
| TST-01 | `src/Bootstrap.test.ts` | 25–28 | `if (win32)` enfraquece CI Linux | Regressão plataforma não detectada | Média | Mock `os.platform` ou testes dedicados win32 |
| TST-02 | — | — | Sem testes `assertTransition` / Recovery | Regressões SM-03/SM-05 | Média | Matriz completa de transições |
| TST-03 | — | — | Cobertura ~5 testes | Baixa confiança para RC2.2 | Média | Meta mínima: failed precheck, recovery, corrupt state |

**Veredito seção 8:** **WARNING** (insuficiente para gate RC2.2).

---

## 9. Performance

| ID | Arquivo | Linha | Causa | Impacto | Gravidade | Sugestão |
|----|---------|-------|-------|---------|-----------|----------|
| PERF-01 | `src/Logger.ts` | 30 | `appendFileSync` síncrono | Gargalo em install com milhares de linhas | Baixa | Buffer/async ou stream RC2.2 |
| PERF-02 | `src/InstallState.ts` | 61 | `history` append ilimitado | JSON grande ao longo do tempo | Baixa | Rotacionar/truncar histórico |
| PERF-03 | `src/ConfigManager.ts` | 37–39 | Cópia shallow a cada `getPaths()` | Negligível | Info | — |

Sem singleton necessário; instanciação por execução Setup é adequada (**PASS**).

---

## 10. Preparação RC2.2 — bloqueios arquiteturais

| Bloqueio | Descrição | Bloqueia RC2.2? |
|----------|-----------|-----------------|
| B1 | Falta modelo de **sub-etapas** em `install-state.json` | **Sim** — retomada/rollback |
| B2 | `InstallManager` não extensível (OCP) | **Sim** — pipeline longo |
| B3 | `ServiceManager` stub + chamada async incorreta | Parcial |
| B4 | Recovery desconectado | **Sim** — fail install na arch |
| B5 | ADR-001 / ADR-003 pendentes (arch) | **Sim** — homologação |
| B6 | CLI/bin sem subcomandos | Parcial |
| B7 | Log `bootstrap.log` vs `install.log` | Parcial (suporte) |

**Conclusão:** a fundação **não impede** iniciar RC2.2, mas exige **evolução de schema e orquestração** antes de instalar PostgreSQL de verdade. Nenhum bloqueio de **dependência circular** ou **monólito RC1**.

---

## Riscos

| Risco | Probabilidade | Consequência |
|-------|---------------|--------------|
| Retomada de install após falha mid-pipeline | Alta (RC2.2) | Reinstalação manual / estado inconsistente |
| `install-state.json` corrompido | Média | Setup aborta sem recovery guiado |
| Documentação PASS enganar gate | Média | RC2.2 iniciado sem schema de etapas |
| Promise flutuante em `registerService` | Baixa (stub) | Race em RC2.2 real |

---

## Dívida técnica

1. Máquina de estados **coarse** vs pipeline **fine-grained** da arquitetura.  
2. RecoveryManager **sem** rollback físico e **fora** do fluxo principal.  
3. Schema `install-state` **incompleto** para “etapa corrente”.  
4. Testes **mínimos**; matriz de transições não validada.  
5. CLI **sem** contrato de comandos/erros.  
6. `package.json` **sem** `exports` estável.  
7. Divergência **bootstrap.log** / **install.log**.

---

## Recomendações (priorizadas — não implementadas nesta auditoria)

| P | Ação |
|---|------|
| P0 | ADR curto: mapeamento `InstallStepId` ↔ persistência (`state` + `step`) antes de RC2.2 |
| P0 | Estender `InstallStateDocument` com `currentStep` (compatível `schemaVersion`) |
| P1 | Pipeline plugável (`InstallStep[]`) no `InstallManager` |
| P1 | Integrar `RecoveryManager` em falhas de `INSTALLING` + stub de rollback |
| P1 | CLI: subcomandos + tratamento global de erros |
| P2 | Testes: transições completas, corrupt JSON, Recovery |
| P2 | `package.json` `exports`; reduzir superfície `public.ts` |
| P2 | Alinhar nome de log com arquitetura |

---

## Critérios para liberar RC2.2

Todos devem ser atendidos **antes** de homologar instalador com PostgreSQL real:

1. **Schema:** `install-state.json` registra **etapa corrente** alinhada ao fluxo arquitetura (PostgreSQL → … → First Run).  
2. **Orquestração:** pelo menos **esqueleto** de steps com persistência após cada etapa (mesmo que stub).  
3. **Recovery:** caminho documentado e testado `INSTALLING` falha → RECOVERY / rollback parcial (mesmo que inicialmente no-op com log).  
4. **Transições:** matriz testada; política clara `FAILED` vs `RECOVERY` vs retry.  
5. **ADR-001** e **ADR-003** fechados (frontend layout + health endpoints).  
6. **CLI/contrato** Setup ↔ Bootstrap definido (install/repair/dry-run).  
7. Cobertura de testes: cenários negativos (precheck fail, state corrupt, reentrada).

---

## Tabela consolidada de achados (severidade Alta)

| ID | Gravidade |
|----|-----------|
| SM-01, SM-02, REC-01, IS-01 | Alta |
| ARQ-03, ARQ-05, SM-03, SM-04, SM-05, REC-02, IS-04, CLI-01 | Média |
| Demais | Baixa / Informativa |

---

## Veredito da auditoria (PASS / WARNING / FAIL)

| Nível | Resultado |
|-------|-----------|
| **Implementação RC2.1 estrutural (escopo declarado)** | **PASS** |
| **Conformidade RC2-ARCH-1.0.0 (instalação + recovery + estado)** | **FAIL** |
| **Qualidade engenharia (docs, testes, API, CLI)** | **WARNING** |

---

## Decisão de gate

**APROVADO COM RESSALVAS**

- **Aprovado** como **baseline RC2.1** (módulos, dry-run, persistência coarse, sem regressão RC1).  
- **Ressalvas obrigatórias:** itens P0/P1 e critérios RC2.2 acima **antes** de considerar RC2.1 “completo” perante a arquitetura congelada ou iniciar homologação com PostgreSQL.

*Não reprovado:* a entrega cumpre o escopo estrutural explícito; reprovação total aplicaria se o gate exigisse **pipeline completo** já na RC2.1 — o que a arquitetura descreve como alvo RC2.1 amplo, mas o código/documentação RC2_BOOTSTRAP delimitam como fase `rc2.1-structural`.

---

**APROVADO COM RESSALVAS**
