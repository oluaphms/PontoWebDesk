# Auditoria da arquitetura RC2 — Instalador Profissional

**Data:** 2026-08-06  
**Escopo:** Auditoria **somente documental** de `docs/ARQUITETURA_INSTALADOR_PROFISSIONAL_RC2.md`  
**Objetivo:** Congelar a arquitetura RC2 como referência oficial (Parte 1 — sem implementação de código)  
**Método:** Leitura integral do documento de arquitetura; cruzamento interno entre seções; validação contra artefatos citados no próprio documento (RC1 auditado em 2026-08-06).

---

## Veredito global da arquitetura (documento)

| Classificação | Significado |
|---------------|-------------|
| **PASS** | Apto como referência oficial RC2, com ressalvas menores registradas |
| **WARNING** | Lacuna ou ambiguidade que deve ser resolvida **no documento** antes ou durante RC2.1 (ADR/nota) |
| **FAIL** | Contradição entre seções que impede implementação unívoca até correção editorial |

**Resultado global:** **PASS com WARNINGs obrigatórios** (nenhum FAIL bloqueante após interpretação única recomendada; um FAIL editorial leve listado abaixo).

---

## 1. Coerência entre seções

| Item | Classificação | Evidência / observação |
|------|---------------|------------------------|
| Separação RC1 vs RC2 (seção 0 vs 1 vs 11) | **PASS** | Mensagem consistente: RC1 = Docker/Compose; RC2 = serviços/banco local/instalador único |
| Objetivos (2) vs arquitetura (3) vs estrutura (5) | **PASS** | Zero Docker/Node/psql manual alinhado em todo o doc |
| Fluxo install seção 3.5 vs seção 4 | **PASS** | Mesma ordem lógica: PG → banco → schema → migrate → seed → app → agent → updater → serviços → ready |
| DEV vs PROD vs Build | **PASS** | Tríade explícita; RC1/demo só DEV; linha de montagem RC2 só PROD |
| Banco (6) vs Updater (8) vs Recuperação | **PASS** | Migrate via DbMigrate; rollback com pg_restore pareado |
| Roadmap (12) vs conclusão (15) | **PASS** | Fases e maturidade ~25% RC2 coerentes |
| Monitor: seção 3.5 vs roadmap 12 | **FAIL** | **3.5** coloca Monitor no fluxo de install com nota **「RC2.3+」**; **12** agenda Monitor em **RC2.4**. Implementador não sabe se Monitor entra no Setup na RC2.3 ou RC2.4 |
| Rollback automático: seção 8 vs roadmap 12 | **WARNING** | **8** e Recuperação descrevem rollback no Updater (orchestrator já existente); **12** coloca 「rollback automático」 em **RC2.4**. Confunde o que é entregue com RC2.3 (Updater) vs RC2.4 (Monitor + descontinuação RC1) |
| Health checks citados | **WARNING** | **1.2** cita `/health`; **7**/Monitor usam `/api/health/live`; **8** valida `/api/health/ready`. Falta tabela normativa 「qual endpoint em qual gate」 |
| Frontend :3010 vs UI unificada na API | **WARNING** | **4** e **5** alternam 「3010」 vs 「URL unificada」; **7** mantém serviço **PontoWebDeskWeb** opcional. Decisão arquitetural única não congelada (Opção A/B) |
| ProgramData RC1 `\Local` vs RC2 raiz `\PontoWebDesk\` | **PASS** | Explicitado em **5** e coexistência **0**; migrador RC2.4 |

**Ação editorial recomendada (FAIL/WARNING):** Alinhar Monitor → **RC2.4** em **3.5**; esclarecer rollback mínimo em **RC2.3** (Updater) vs Monitor/recuperação ampliada em **RC2.4**; adicionar ADR curto 「Frontend: static na API vs serviço Web :3010」 e 「Health endpoints」.

---

## 2. Responsabilidades por componente

| Componente | Classificação | Observação |
|------------|---------------|------------|
| Matriz 3.3 (Bootstrap, PG, DbMigrate, API, Frontend, Agent, Updater, Monitor) | **PASS** | Responsabilidade única bem delimitada; coluna 「o que não faz」 reduz overlap |
| Backend vs REP server-side vs Agent REP | **WARNING** | **3.3** diz API não fala com relógio 「diretamente」; backend tem `repAgentAuthService` e APIs REP. Agent REP fala com hardware. Falta uma linha: 「API = servidor; Agent = edge/hardware」 para evitar leitura de duplicação |
| Bootstrap vs DbMigrate (criação DB/roles) | **PASS** | **4** lista criação banco/roles antes de schema; **3.3** atribui SQL structural ao DbMigrate; Bootstrap apenas orquestra — coerente se 「install」 do DbMigrate inclui roles |
| Updater vs DbMigrate em update | **PASS** | Updater para serviços/binários; DbMigrate só schema |
| Monitor vs SCM recovery | **WARNING** | Ambos reiniciam serviços; doc deve fixar: SCM = primeira linha; Monitor = escalação/agregação health (evitar loop duplo) |

---

## 3. Dependências

| Dependência | Classificação | Observação |
|-------------|---------------|------------|
| Tabela 3.2 (API→PG, UI→API, REP→API, Updater→API/REP/PG) | **PASS** | Acíclica; localhost |
| Ordem de start PG → API → REP (**8.1**) | **PASS** | Alinhada com **7** |
| Updater híbrido → Master Control Plane | **PASS** | Opcional; **8.2** |
| DbMigrate → `apply-full-database.mjs` (repo root paths) | **WARNING** | Script assume `repoRoot` com `supabase/` na raiz; empacotamento **Migrations/** deve espelhar paths ou wrapper redefine `repoRoot` — não detalhado no doc (impacto implementação RC2.1) |
| Agent `rep-agent` vs pasta `agent/` (clock-sync) | **WARNING** | **13.1** deixa decisão aberta; dependência futura de hardware adapters não está no diagrama RC2 |

---

## 4. Bootstrap (Setup.exe)

| Item | Classificação | Observação |
|------|---------------|------------|
| Escopo: precheck, sequência, serviços, first-run gate | **PASS** | **3.3**, **4**, **install-state.json** |
| Fail-closed instalação | **PASS** | **Arquitetura de Recuperação** — abort + rollback parcial |
| Invisibilidade ao técnico | **PASS** | Alinhado **2** e **DEV vs PROD** |
| Repair / reentrada | **WARNING** | Mencionado implicitamente (re-run Setup); não há máquina de estados (idle / partial / complete) formalizada |
| Coexistência RC1 + RC2 na mesma máquina | **WARNING** | Portas 3000/3010/5432 e AppId não tratados; risco de side-by-side acidental |

---

## 5. Arquitetura de banco

| Item | Classificação | Observação |
|------|---------------|------------|
| Política 6.0 (zero psql/DDL manual) | **PASS** | Clara e repetida |
| Pipeline migrate full = `apply-full-database.mjs` | **PASS** | **6.3** alinhado **1.3** |
| Ordene migrate → seed | **PASS** | **3.5**, **4**; corrige lição RC1 (**1.5**) |
| Roles `pontoweb_app` / `pontoweb_migrate` | **WARNING** | Nome e rotação de senha migrate pós-install não especificados |
| Supabase migration `tenant_id` generated (VPS) | **WARNING** | Não citado; risco conhecido em homologação VPS — doc RC2 deveria referir 「skip list」 ou versão mínima de ledger para Local |
| Backup/restore/rollback DB | **PASS** | **6.5–6.7**, Recuperação, **8** |

---

## 6. Arquitetura de atualização (Updater)

| Item | Classificação | Observação |
|------|---------------|------------|
| Fluxo 8.1 (versão → download → backup → stop → swap → migrate → start → validate → rollback) | **PASS** | Completo; alinhado `updater-agent` citado |
| Migrate pós-update obrigatório vs RC1 | **PASS** | **8.3** gap documentado |
| Modos offline / hybrid / agendado | **PASS** | **8.2** |
| Assinatura + hash | **PASS** | **8**, **9** |
| `PWD_HEALTH_URL` exemplo updater-agent (porta 3001) vs RC2 (3000) | **WARNING** | README updater cita 3001; arquitetura RC2 usa 3000 — doc deve fixar porta/canonical URL no congelamento |
| Pacote `.pwdupdate` vs ZIP | **WARNING** | Formato final não normativo (extensão, layout interno) |

---

## 7. Rollback e recuperação

| Item | Classificação | Observação |
|------|---------------|------------|
| Três cenários (install / update / runtime) | **PASS** | **Arquitetura de Recuperação** |
| Paridade timestamp dump + binários | **PASS** | **10**, artefatos |
| Técnico não executa pg_restore | **PASS** | Política clara |
| Rollback install parcial (detalhe técnico) | **WARNING** | 「limpar ProgramData parcial」 sem critérios (o que apagar se PG já criou cluster) |
| Migrations destrutivas | **PASS** | **10** — backup obrigatório |

---

## 8. Serviços Windows

| Item | Classificação | Observação |
|------|---------------|------------|
| Lista **7** (PG, API, Web, REP, Updater, Monitor) | **PASS** | Nomes consistentes com **0**, **5** |
| Dependências SCM (API depend PG) | **PASS** | **7**, **8.1** |
| Recovery 5s/30s/60s | **PASS** | **7.1** |
| Updater Manual vs Automatic | **WARNING** | **7** Manual/Task; **0** lista Updater no produto — OK, mas instalação 「sempre」 registra serviço Updater; clarificar se desabilitado até RC2.3 |
| NSSM vs serviço PG nativo | **WARNING** | **7** mistura `pg_ctl` e NSSM em **13.3**; PostgreSQL embarcado geralmente registra serviço próprio — definir uma abordagem |

---

## 9. Arquitetura de Build

| Item | Classificação | Observação |
|------|---------------|------------|
| Linha de montagem RC2 vs RC1 atual | **PASS** | **Arquitetura de Build** — clara |
| Comandos npm auditados | **PASS** | Tabela shared/backend/frontend/updater |
| Agent/Updater 「bundle」 sem comando fixo | **WARNING** | Agent e DbMigrate marcados *(RC2)* — pipeline incompleto para congelamento |
| verify-installer-runtime RC2 | **WARNING** | Citado 「sem docker-compose」 mas lista REQUIRED nova não está no doc (só impacto **13.1**) |
| Nome artefato `PontoWebDesk-Setup.exe` vs RC1 `PontoWebDesk-Local-Setup.exe` | **PASS** | Distinção útil; evitar colisão de nome em release |

---

## 10. Roadmap (RC2.1–RC2.5)

| Item | Classificação | Observação |
|------|---------------|------------|
| Prioridades P0/P1/P2 | **PASS** | Sequência lógica PG→API→UI antes REP/Updater |
| RC2.1 escopo mínimo viável | **PASS** | PG + DbMigrate + API + static UI + setup-professional |
| Sobreposição RC2.3 vs RC2.4 (Updater vs rollback/Monitor) | **WARNING** | Ver inconsistência Monitor **FAIL** acima |
| RC2.5 MSI/Intune | **PASS** | Compatibilidade futura enterprise |
| Critério 「congelar RC1 branch/installer」 | **WARNING** | **0** diz mantido até RC2.4; não define tag/git policy (branch name, freeze date) |

---

## 11. Riscos técnicos (documento vs realidade)

| Risco no doc **15.4** | Classificação | Comentário auditor |
|------------------------|---------------|---------------------|
| Tamanho instalador | **PASS** | Relevante |
| Conflito PostgreSQL corporativo | **PASS** | Precheck porta |
| Migrate fail update | **PASS** | Backup + rollback |
| Dois agentes | **PASS** | Pendência decisão **13.1** |
| EPERM sync demo | **PASS** | Build host; não cliente |
| Code signing | **PASS** | |
| **Riscos ausentes** | **WARNING** | VC++ redist Node; Windows Server vs Win10; antivírus bloqueando PG data dir; LGPD backup em ProgramData |

---

## 12. Compatibilidade futura

| Item | Classificação | Observação |
|------|---------------|------------|
| Mesma base Git app + novo runtime | **PASS** | **0**, **2** |
| Master Control Plane / HYBRID | **PASS** | **8.2**, RC2.5 |
| Migrador RC1→RC2 | **WARNING** | Mencionado; sem fluxo (dump Docker volume → pgdata nativo?) |
| `agent/` clock-sync integração posterior | **WARNING** | Pode exigir segundo serviço ou fusão com REP |
| PG major 16 locked | **PASS** | Consistente |
| API versionada + manifest migrationRequired | **PASS** | Build paralelo manifest |

---

## 13. Checklist homologação (seção 14)

| Item | Classificação | Observação |
|------|---------------|------------|
| Cobertura install/update/rollback/reboot | **PASS** | Adequada para 「instalador comercial」 |
| Alinhamento com FAILs homologação RC1 | **PASS** | Master tables, módulos UI |
| Critérios de aceite mensuráveis | **WARNING** | Falta tempo máximo install silencioso, tamanho máximo pacote, código exit catalog (EXxxx citado mas não listado) |

---

## 14. Congelamento como referência oficial

| Critério | Classificação | Requisito para 「congelado」 |
|----------|---------------|------------------------------|
| Documento único e indexado | **PASS** | Índice rápido presente |
| Versão do documento | **WARNING** | Adicionar `RC2-ARCH-1.0.0` + data congelamento + changelog editorial |
| ADRs pendentes registrados | **WARNING** | UI static hosting; Monitor fase; health URLs; coexistência RC1/RC2 |
| Rastreabilidade RC1 audit | **PASS** | Seção 1 + refs homologação |
| Implementação zero | **PASS** | Escopo respeitado |

**Recomendação Parte 1:** Declarar **`docs/ARQUITETURA_INSTALADOR_PROFISSIONAL_RC2.md`** como **referência oficial RC2-ARCH-1.0.0** após correção editorial do **FAIL Monitor (3.5 vs 12)** e inclusão de **nota de decisões abertas** (WARNINGs acima) em apêndice 「Decisões pendentes」 — **sem alterar código**.

---

## 15. Resumo PASS / WARNING / FAIL

### PASS (aprovado para referência)

- Separação RC1 / RC2 e objetivos do instalador profissional  
- Responsabilidades principais e dependências localhost  
- Fluxo de instalação, banco automático, política anti-SQL manual  
- Arquitetura Updater e Recuperação (comercial)  
- Build DEV vs PROD e linha de montagem alvo  
- Serviços Windows (modelo alvo)  
- Checklist homologação RC2  
- Impacto e reaproveitamento RC1 documentados  

### WARNING (corrigir no documento ou ADR antes/durante RC2.1)

- Health endpoints (`/health` vs `/api/health/live` vs `/ready`)  
- Modelo de entrega do frontend (API static vs :3010 vs PontoWebDeskWeb)  
- Roadmap vs rollback/Monitor (RC2.3 vs RC2.4)  
- DbMigrate paths empacotados vs `repoRoot`  
- Decisão `agent/` vs REP-only  
- Updater health URL/porta; formato `.pwdupdate`  
- Rollback install parcial (critérios)  
- verify-runtime RC2 REQUIRED list  
- Pipeline build Agent/DbMigrate não especificado  
- Coexistência RC1+RC2; migrador RC1→RC2  
- Monitor vs SCM recovery overlap  
- Versão/changelog do documento oficial  

### FAIL (contradição editorial)

| ID | Descrição | Onde | Correção sugerida (só doc) |
|----|-----------|------|----------------------------|
| **F-01** | Fase do **Monitor** no fluxo 3.5 (**RC2.3+**) vs roadmap (**RC2.4**) | §3.5 vs §12 | Unificar: Monitor apenas RC2.4 no fluxo canônico; RC2.3 = Updater + migrate + backup |

---

## 16. Conclusão da auditoria

A arquitetura RC2 documentada é **coerente, auditável e utilizável como base oficial**, com maturidade de especificação estimada em **~85%** (faltam ADRs, detalhes de empacotamento DbMigrate/Agent e fechamento de inconsistências menores).

| Resultado final | **PASS** (referência oficial condicionada) |
|-----------------|---------------------------------------------|
| Bloqueadores | **1 FAIL editorial (F-01)** — correção de uma linha/nota de fase |
| Implementação | **Não iniciada** (~25% maturidade produto, conforme §15.3 do doc auditado) |

**Próximo passo sugerido (Parte 2+, fora desta auditoria):** corrigir **F-01** e anexar apêndice 「Decisões pendentes」 no documento de arquitetura; em seguida marcar **RC2-ARCH-1.0.0** congelado.

---

*Auditoria documental — nenhum arquivo do projeto foi alterado exceto este relatório.*
