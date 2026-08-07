# RC2.2 — Decisões pendentes e fechamento de auditoria (PostgreSQL embarcado)

**Data:** 2026-08-06  
**Escopo:** consolidar decisões **antes** da implementação RC2.2 — **sem código**, sem Setup  
**Fontes:** `RC2_POSTGRESQL_EMBEDDED.md` (RC2-PG-1.0.0), `AUDITORIA_RC2_2.md`, `RC2-ARCH-1.0.0`, `RC2-LAYOUT-1.0.0`

---

## 1. Resumo do fechamento

| Categoria | Quantidade | Bloqueiam módulo PG RC2.2? |
|-----------|------------|---------------------------|
| Decisões **fechadas** neste documento (recomendação final) | 18 | — |
| Decisões **abertas** (exigem aceite formal / jurídico) | 6 | 3 Sim, 3 Não |
| ADRs RC2-ARCH ainda **Pendente** (impacto indireto) | 5 | Não (PG isolado) |

**Objetivo:** eliminar ambiguidade técnica; registrar o que ainda exige **assinatura** de produto/jurídico.

---

## 2. Validação temática (políticas definitivas RC2.2)

| Tema | Status | Política definitiva |
|------|--------|---------------------|
| **Versão PostgreSQL congelada** | **Fechado** | Major **16** linha RC2; patch inicial **16.8** em `Database/VERSION` + manifest |
| **Distribuição** | **Fechado** | **ZIP/bin curado** em PF; **proibido** MSI/StackBuilder/EDB GUI |
| **Minor versions PG** | **Fechado** | Dentro de 16.x: swap `Database\bin` + restart serviço; **sem** `pg_upgrade`; registrar em release notes RC2.2.x |
| **Windows 10/11/Server** | **Fechado** | Win10 1809+, Win11, Server 2019/2022 x64; excluir 32-bit e Server 2016 |
| **Backup e rollback** | **Fechado** | `Backups\pg\` dump `-Fc` pareado com `Backups\app\`; rollback via `Rollback\last-good` |
| **PGDATA** | **Fechado** | `%ProgramData%\PontoWebDesk\Database\pgdata\` |
| **WAL** | **Fechado** | Padrão em `pgdata\pg_wal\`; `archive_mode=off` RC2.2; archive path reservado RC2.3+ |
| **Logs** | **Fechado** | `%ProgramData%\PontoWebDesk\Logs\postgresql.log` (stderr serviço); redaction backend nos demais |
| **Falha elétrica** | **Fechado** | PG crash recovery automático; após boot SCM inicia serviço; Repair se `pg_control` inválido → restore dump |
| **PostgreSQL já instalado** | **Fechado** | **Não** reutilizar cluster externo; precheck porta → **55432** se 5432 ocupada; **não** alterar instância terceira |
| **Antivírus / permissões** | **Parcial** | Authenticode no pacote; exclusão **não** documentada ao cliente; ACL conforme RC2-LAYOUT §5 |

---

## 3. Inventário de itens (WARNING / PENDING / ADR / OPEN)

Legenda **Bloqueia RC2.2?** = implementação do **módulo PostgreSQL embarcado** (steps Bootstrap PG), não Setup Inno completo.

---

### D-01 — ADR RC2-PG-001 (origem redist + pin 16.8)

| Campo | Conteúdo |
|-------|----------|
| **Classificação** | ADR · DECISION REQUIRED |
| **Descrição** | Fonte oficial dos binários PG (EDB ZIP vs build upstream) e registro SBOM no manifest |
| **Motivo** | WARNING licenciamento §2.2 RC2-PG; critério §10 item 1 |
| **Impacto** | Pipeline CI/release; compliance redistribuição |
| **Prioridade** | **Alta** |
| **Bloqueia RC2.2?** | **Sim** |
| **Decisão recomendada** | Binários **EDB Windows x64 ZIP** (mesma major/minor pinada), subset curado copiado no build; SBOM JSON em `layout.manifest.json` |
| **Alternativa A** | Build from source upstream (maior custo build) |
| **Alternativa B** | MSI EDB extraído por script (reprovado — risco registry) |
| **Recomendação final** | **EDB curated ZIP + SBOM**; jurídico valida termos EDB uma vez por release major |

**Estado após fechamento:** **ABERTA** até aceite jurídico; técnica **fechada**.

---

### D-02 — ADR RC2-PG-002 (registro serviço Windows)

| Campo | Conteúdo |
|-------|----------|
| **Classificação** | ADR · WARNING (AUD-PG-01) |
| **Descrição** | NSSM vs `pg_ctl register` para `PontoWebDeskPostgreSQL` |
| **Motivo** | Ambiguidade RC2-ARCH §7 vs §13 (NSSM citado para outros componentes) |
| **Impacto** | Duplo wrapper de serviço; recovery SCM |
| **Prioridade** | **Alta** |
| **Bloqueia RC2.2?** | **Sim** |
| **Decisão recomendada** | PostgreSQL: **somente** `pg_ctl register` / `pg_ctl start` como serviço nativo Windows |
| **Alternativa A** | NSSM envolvendo postgres.exe |
| **Alternativa B** | sc.exe create manual sem pg_ctl register |
| **Recomendação final** | **`pg_ctl register`** (RC2-PG-1.0.0 §3.1); NSSM **apenas** API/Node/REP se necessário (fora escopo PG) |

**Estado após fechamento:** **FECHADA** (recomendação vinculante para implementação; registrar ADR formal na RC2.2 kickoff).

---

### D-03 — ADR RC2-PG-003 (roles e rotação de senhas)

| Campo | Conteúdo |
|-------|----------|
| **Classificação** | ADR · WARNING |
| **Descrição** | Política pós-install para `pontoweb_migrate` (rotação, armazenamento, uso em update) |
| **Motivo** | RC2-ARCH cita roles; rotação não especificada |
| **Impacto** | Superfície de ataque; DbMigrate em updates |
| **Prioridade** | **Alta** |
| **Bloqueia RC2.2?** | **Sim** |
| **Decisão recomendada** | Senhas geradas no install; **`Config\secrets.json`** (baseline RC2.2.6); migração **`secrets.dat`** DPAPI reservada RC2.3+; migrate usa `pontoweb_migrate` só em install/repair/update orchestrado; **sem** rotação automática na RC2.2 (manual repair) |
| **Alternativa A** | Rotacionar migrate após first install |
| **Alternativa B** | DbMigrate como postgres local socket (reprovado — viola mínimo privilégio) |
| **Recomendação final** | **Modelo dual role fixo RC2.2**; rotação automática → RC2.3 |

**Estado após fechamento:** **FECHADA** para RC2.2; ADR formal documenta “sem rotação auto v1”.

---

### D-04 — Licenciamento redist (WARNING §2.2)

| Campo | Conteúdo |
|-------|----------|
| **Classificação** | WARNING · OPEN |
| **Descrição** | Validação jurídica termos EDB |
| **Motivo** | R11 auditoria |
| **Impacto** | Distribuição comercial ilegal se incorreto |
| **Prioridade** | **Alta** |
| **Bloqueia RC2.2?** | **Sim** (release); **Não** (dev interno em VM) |
| **Decisão recomendada** | Checklist jurídico + arquivo `ThirdParty/PostgreSQL-LICENSE.txt` no pacote |
| **Alternativa A** | upstream only |
| **Alternativa B** | EDB sem revisão |
| **Recomendação final** | **Checklist antes do primeiro RC2.2 build público** |

**Estado:** **ABERTA** (jurídico).

---

### D-05 — SBOM binários PG (critério §10.7)

| Campo | Conteúdo |
|-------|----------|
| **Classificação** | TODO · OPEN |
| **Descrição** | Artefato SBOM no pipeline de build |
| **Motivo** | Critério RC2-PG §10 |
| **Impacto** | Rastreabilidade supply chain |
| **Prioridade** | **Média** |
| **Bloqueia RC2.2?** | **Não** (primeira sprint); **Sim** antes de RC2.2 GA |
| **Decisão recomendada** | JSON listando cada exe/dll PG + versão 16.8 + hash SHA-256 |
| **Alternativa A** | SBOM CycloneDX completo |
| **Alternativa B** | Sem SBOM |
| **Recomendação final** | **JSON mínimo RC2.2**; CycloneDX RC2.3 |

**Estado:** **ABERTA** até pipeline; não bloqueia spike técnico.

---

### D-06 — `shared_buffers` fixo 256MB (WARNING auditoria §3)

| Campo | Conteúdo |
|-------|----------|
| **Classificação** | WARNING · PENDING |
| **Descrição** | Tuning memória por RAM do host |
| **Motivo** | RC2-PG §3.3 “precheck futuro” |
| **Impacto** | Performance em servidores 32GB+ ou 4GB |
| **Prioridade** | **Baixa** |
| **Bloqueia RC2.2?** | **Não** |
| **Decisão recomendada** | Manter **256MB** fixo RC2.2; tabela tuning RC2.3 |
| **Alternativa A** | 25% RAM auto |
| **Alternativa B** | 128MB mínimo |
| **Recomendação final** | **256MB fixo** |

**Estado:** **FECHADA**.

---

### D-07 — Role `pontoweb_backup` (WARNING §4.3)

| Campo | Conteúdo |
|-------|----------|
| **Classificação** | PENDING · RC2.3 |
| **Descrição** | Role dedicada para pg_dump no Updater |
| **Motivo** | Evitar postgres superuser em backup |
| **Impacto** | Segurança updates |
| **Prioridade** | **Média** |
| **Bloqueia RC2.2?** | **Não** |
| **Decisão recomendada** | RC2.2: backup install via `postgres` localhost + ferramentas em `Database\tools` |
| **Alternativa A** | Criar `pontoweb_backup` já na RC2.2 |
| **Alternativa B** | pg_dump como pontoweb_migrate |
| **Recomendação final** | **`postgres` local RC2.2**; role dedicada **RC2.3** |

**Estado:** **FECHADA**.

---

### D-08 — Collation / ICU (ADR futuro §3.2)

| Campo | Conteúdo |
|-------|----------|
| **Classificação** | PENDING · QUESTION |
| **Descrição** | Usar ICU locale provider vs libc |
| **Motivo** | Nota “ADR futuro ICU” RC2-PG |
| **Impacto** | Ordenação PT-BR consistente |
| **Prioridade** | **Baixa** |
| **Bloqueia RC2.2?** | **Não** |
| **Decisão recomendada** | **libc** + `Portuguese_Brazil.1252` / fallback `C` |
| **Alternativa A** | ICU pt-BR |
| **Alternativa B** | C.UTF-8 (indisponível Windows nativo) |
| **Recomendação final** | **libc conforme RC2-PG-1.0.0** |

**Estado:** **FECHADA**.

---

### D-09 — MSVC / VC++ runtime (R3)

| Campo | Conteúdo |
|-------|----------|
| **Classificação** | OPEN · RISK |
| **Descrição** | Dependência Visual C++ Redistributable |
| **Motivo** | Binários EDB requerem MSVC |
| **Impacto** | Install falha silenciosa DLL load |
| **Prioridade** | **Alta** |
| **Bloqueia RC2.2?** | **Sim** (homologação) |
| **Decisão recomendada** | Prerequisite silencioso **ou** bundle `vc_redist.x64.exe` no Bootstrap precheck |
| **Alternativa A** | Documentar prerequisite manual (reprovado campo) |
| **Alternativa B** | Static link (inviable PG) |
| **Recomendação final** | **Instalar VC++ redist no step precheck** se DLL check falhar |

**Estado:** **FECHADA** (política); implementação no precheck RC2.2.

---

### D-10 — Antivírus / Authenticode (R12)

| Campo | Conteúdo |
|-------|----------|
| **Classificação** | WARNING · OPEN |
| **Descrição** | Falsos positivos em postgres.exe / initdb |
| **Motivo** | Auditoria R12 |
| **Impacto** | Install bloqueado em TI corporativa |
| **Prioridade** | **Média** |
| **Bloqueia RC2.2?** | **Não** (dev); **Sim** (GA enterprise) |
| **Decisão recomendada** | Assinar **Setup/binários PontoWebDesk**; documentação TI: exclusão path PF/PD **opcional** |
| **Alternativa A** | WHQL |
| **Alternativa B** | Unsigned |
| **Recomendação final** | **Authenticode pacote RC2** + guia TI |

**Estado:** **ABERTA** até certificado de assinatura; spike RC2.2 pode usar unsigned VM.

---

### D-11 — Coexistência PostgreSQL externo (RC2-ARCH + R1)

| Campo | Conteúdo |
|-------|----------|
| **Classificação** | DECISION REQUIRED · ADR-007 relacionado |
| **Descrição** | Instância PG corporativa na mesma porta/host |
| **Motivo** | Precheck arch §6.1 |
| **Impacto** | Conflito porta; confusão suporte |
| **Prioridade** | **Alta** |
| **Bloqueia RC2.2?** | **Não** (se fallback porta) |
| **Decisão recomendada** | **Instância dedicada PontoWebDesk** sempre; porta 5432 ou **55432**; **nunca** apontar API para PG externo |
| **Alternativa A** | ADR-007 B — RC1+RC2 portas distintas apenas |
| **Alternativa B** | Reutilizar cluster corporativo |
| **Recomendação final** | **Cluster embarcado exclusivo** + detecção porta (alinhado RC2-PG §3.5) |

**Estado:** **FECHADA** para PG; ADR-007 RC1+RC2 permanece **Pendente** (produto).

---

### D-12 — ADR-007 Coexistência RC1 Local + RC2 Professional

| Campo | Conteúdo |
|-------|----------|
| **Classificação** | ADR · Pendente |
| **Descrição** | Mesma máquina RC1 Docker + RC2 nativo |
| **Motivo** | RC2-ARCH ADR-007 |
| **Impacto** | Portas 5432/3000/3010 |
| **Prioridade** | **Média** |
| **Bloqueia RC2.2?** | **Não** |
| **Decisão recomendada** | **A)** Precheck **bloqueia** RC2 se RC1 detectado (recomendação arch) |
| **Alternativa A** | B) Permitir com portas distintas |
| **Alternativa B** | Side-by-side sem precheck |
| **Recomendação final** | **Precheck bloqueia RC1** para GA; lab pode forçar flag dev |

**Estado:** **ABERTA** (formal ADR-007).

---

### D-13 — ADR-001 Frontend

| Campo | Conteúdo |
|-------|----------|
| **Classificação** | ADR · Pendente |
| **Descrição** | Hosting UI estática |
| **Motivo** | RC2-LAYOUT §9 WARNING |
| **Impacto** | Serviço Web, firewall, logs web.log |
| **Prioridade** | **Média** |
| **Bloqueia RC2.2?** | **Não** |
| **Decisão recomendada** | **A)** API serve static :3000 (menos serviços) |
| **Alternativa A** | B) PontoWebDeskWeb :3010 |
| **Alternativa B** | C) Static ProgramData |
| **Recomendação final** | **ADR-001 = A** para RC2.2 homologação PG+API mínima |

**Estado:** **ABERTA** (formal).

---

### D-14 — ADR-003 Health endpoints

| Campo | Conteúdo |
|-------|----------|
| **Classificação** | ADR · Pendente |
| **Descrição** | URLs health Bootstrap/Updater/Monitor |
| **Motivo** | RC2-ARCH |
| **Impacto** | Gate pós-install PG+API |
| **Prioridade** | **Média** |
| **Bloqueia RC2.2?** | **Não** (PG usa pg_isready) |
| **Decisão recomendada** | PG: **pg_isready**; API RC2.2: **`GET /health`** existente + documentar **`/api/health/live`** RC2.3 |
| **Alternativa A** | Só /api/health/live já na RC2.2 |
| **Alternativa B** | Só /health |
| **Recomendação final** | **pg_isready + /health** RC2.2 |

**Estado:** **FECHADA** para escopo PG; ADR-003 formal **ABERTA**.

---

### D-15 — ADR-008 verify-installer-runtime-rc2

| Campo | Conteúdo |
|-------|----------|
| **Classificação** | ADR · Pendente · TODO |
| **Descrição** | Script verify PG redist no CI |
| **Motivo** | RC2-ARCH ADR-008 |
| **Impacto** | Release quality |
| **Prioridade** | **Média** |
| **Bloqueia RC2.2?** | **Não** (início); **Sim** GA |
| **Decisão recomendada** | `verify-installer-runtime-rc2.mjs` checa `Database/bin/postgres.exe`, VERSION 16.8 |
| **Alternativa A** | Manual QA only |
| **Alternativa B** | Reutilizar verify RC1 |
| **Recomendação final** | **Novo script RC2.2 sprint 2** |

**Estado:** **ABERTA** (implementação futura script — não bloqueia desenho).

---

### D-16 — WAL archive RC2.3+ (PENDING)

| Campo | Conteúdo |
|-------|----------|
| **Classificação** | PENDING |
| **Descrição** | `Database\wal_archive\` |
| **Motivo** | RC2-PG §5 |
| **Impacto** | PITR enterprise |
| **Prioridade** | **Baixa** |
| **Bloqueia RC2.2?** | **Não** |
| **Recomendação final** | **archive_mode=off** RC2.2 |

**Estado:** **FECHADA**.

---

### D-17 — Falha elétrica / crash recovery

| Campo | Conteúdo |
|-------|----------|
| **Classificação** | QUESTION (validação solicitada) |
| **Descrição** | Comportamento pós queda de energia |
| **Motivo** | Não estava explícito RC2-PG |
| **Impacto** | Corrupção pgdata |
| **Prioridade** | **Alta** |
| **Bloqueia RC2.2?** | **Não** |
| **Decisão recomendada** | PG **WAL replay** automático; serviço **Automatic (Delayed Start)**; se não subir → Repair → último dump |
| **Alternativa A** | fsync=off (reprovado) |
| **Alternativa B** | Backup contínuo WAL |
| **Recomendação final** | **Recovery nativo PG + SCM** |

**Estado:** **FECHADA** (documentado §1 deste arquivo).

---

### D-18 — Política logs PostgreSQL vs NSSM (§7.2 arch)

| Campo | Conteúdo |
|-------|----------|
| **Classificação** | WARNING · ambiguidade |
| **Descrição** | Rotação “NSSM ou equivalente” para PG |
| **Motivo** | PG não usa NSSM (D-02) |
| **Impacto** | Rotação logs |
| **Prioridade** | **Média** |
| **Bloqueia RC2.2?** | **Não** |
| **Decisão recomendada** | Wrapper serviço redireciona stderr → `postgresql.log`; rotação por **tarefa agendada** ou serviço logrotate RC2.3 |
| **Alternativa A** | logging_collector on inside pgdata |
| **Alternativa B** | NSSM só para redirect |
| **Recomendação final** | **stderr redirect + rotação instalador RC2.3** |

**Estado:** **FECHADA** RC2.2 mínimo.

---

### D-19 — Nome módulo `PostgreSqlEmbeddedService` (provisório)

| Campo | Conteúdo |
|-------|----------|
| **Classificação** | TODO |
| **Descrição** | Nomenclatura código RC2.2 |
| **Motivo** | RC2-PG §7.1 “provisório” |
| **Impacto** | Baixo |
| **Prioridade** | **Baixa** |
| **Bloqueia RC2.2?** | **Não** |
| **Recomendação final** | Aceitar nome ou **`EmbeddedPostgreSql`** na implementação |

**Estado:** **FECHADA** (cosmético).

---

### D-20 — pgdata OneDrive / roaming (R5)

| Campo | Conteúdo |
|-------|----------|
| **Classificação** | RISK · OPEN |
| **Descrição** | ProgramData redirecionado |
| **Motivo** | R5 matriz |
| **Impacto** | Corrupção cluster |
| **Prioridade** | **Alta** |
| **Bloqueia RC2.2?** | **Não** |
| **Decisão recomendada** | Precheck: recusar se `%ProgramData%` em path synced/reparse point |
| **Alternativa A** | Ignorar |
| **Alternativa B** | Mover pgdata para PF (reprovado) |
| **Recomendação final** | **Precheck fail-closed** |

**Estado:** **FECHADA** (requisito precheck).

---

## 4. ADRs RC2-ARCH — impacto RC2.2 PG (resumo)

| ADR | Status arch | Bloqueia PG RC2.2? | Recomendação neste fechamento |
|-----|-------------|--------------------|--------------------------------|
| ADR-001 Frontend | Pendente | Não | Preferir **A** |
| ADR-002 REP | A fechado REP only | Não | — |
| ADR-003 Health | Pendente | Não | pg_isready + /health |
| ADR-004 Update pkg | Pendente | Não | — |
| ADR-005 Monitor | A fechado RC2.4 | Não | — |
| ADR-006 Migrador RC1 | Pendente | Não | — |
| ADR-007 RC1+RC2 | Pendente | Não | Bloquear RC1 no precheck GA |
| ADR-008 verify RC2 | Pendente | Não (GA sim) | Script sprint 2 |

---

## 5. Checklist “pode codificar RC2.2 PG”

| # | Requisito | Status |
|---|-----------|--------|
| 1 | Versão 16.8 congelada | **OK** |
| 2 | Distribuição ZIP/bin curado | **OK** |
| 3 | PGDATA / WAL / backup paths | **OK** |
| 4 | D-02 serviço pg_ctl | **OK** (fechado) |
| 5 | D-03 roles | **OK** (fechado RC2.2) |
| 6 | D-01 + D-04 jurídico/SBOM | **Pendente aceite** |
| 7 | D-09 VC++ precheck | **OK** (política) |
| 8 | Coexistência PG externo | **OK** (porta dedicada) |
| 9 | ADR RC2-PG-001..003 assinados | **3 formalizações** pendentes |

---

## 6. Atualização recomendada dos documentos (editorial — pós-aceite)

Sem alterar código, após aceite do time:

1. `RC2_POSTGRESQL_EMBEDDED.md` → bump **RC2-PG-1.0.1** registrando D-02, D-03, D-17, D-20 como **decisões fechadas**.
2. `AUDITORIA_RC2_2.md` → addendum “Fechamento 2026-08-06” apontando para este arquivo.
3. Registrar ADR RC2-PG-001..003 na tabela ADR do RC2-ARCH (patch 1.0.1 editorial).

*(Não executado automaticamente nesta tarefa — apenas recomendado.)*

---

## 7. Veredito de fechamento da auditoria RC2.2

| Critério | Resultado |
|----------|-----------|
| Ambiguidades técnicas PG | **Eliminadas** via §2 e decisões fechadas |
| Itens bloqueantes release | **6 abertos** (jurídico, SBOM GA, ADRs formais, assinatura) |
| Prontidão spike implementação PG em VM | **Sim** após aceite D-01/D-03 em kickoff |
| Uso MSI/StackBuilder | **Reprovado** |

### Emitido (instrução do pedido)

**PASS COM DECISÕES ABERTAS**

*(Decisões abertas: D-01, D-04, D-05 GA, D-10 GA, D-12, D-13, D-15 GA, formalização ADR RC2-PG-001..003 — **não** reprova arquitetura; bloqueiam **release comercial** e **build público**, não necessariamente desenvolvimento interno controlado.)*
