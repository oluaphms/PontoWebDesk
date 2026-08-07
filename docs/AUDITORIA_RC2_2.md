# Auditoria RC2.2 — PostgreSQL embarcado (pré-implementação)

**Data:** 2026-08-06  
**Modo:** arquitetura somente — **sem código**, sem Setup, sem instalador  
**Artefato analisado:** proposta `docs/RC2_POSTGRESQL_EMBEDDED.md` (**RC2-PG-1.0.0**)  
**Referências:** RC2-ARCH-1.0.0, RC2-LAYOUT-1.0.0, RC2.1 Bootstrap (`installSteps.ts`)

---

## Resumo executivo

A incorporação de PostgreSQL ao instalador Professional deve usar **redistribuição curated (ZIP/bin)** em `Program Files\PontoWebDesk\Database\`, cluster em **`ProgramData\...\pgdata`**, serviço **`PontoWebDeskPostgreSQL`**, major **16** congelado (patch **16.8** inicial), roles **`pontoweb_app`** / **`pontoweb_migrate`**, e orquestração via steps Bootstrap já definidos na RC2.1.

**MSI oficial EDB** e **StackBuilder** são **inadequados** para runtime embarcado. A proposta está **alinhada** à arquitetura congelada e ao layout RC2-LAYOUT-1.0.0.

| Dimensão | Veredito |
|----------|----------|
| Versão e paridade monorepo (PG 16) | **PASS** |
| Modelo de distribuição | **PASS** |
| Cluster / locale / segurança | **PASS** |
| Paths PGDATA / backup / WAL | **PASS** |
| Bootstrap integration design | **PASS** |
| Compatibilidade Windows | **PASS** |
| ADRs / jurídico / NSSM | **WARNING** |
| Implementação RC2.2 (código) | **N/A** — não iniciada |

**Veredito global:** **WARNING** — arquitetura **aprovável** para implementação após fechamento de ADRs RC2-PG-001..003 e validação jurídica do redist.

---

## 1. Versão PostgreSQL congelada

| Pergunta | Resposta auditoria |
|----------|-------------------|
| Major para linha RC2 | **16** — consistente RC2-ARCH §6.1 e `postgres:16` no repo |
| Minor recomendado | **16.8** (pin explícito no manifest) |
| Upgrade major | Fora RC2; exige ADR + `pg_upgrade` |
| x64 only | OK para Professional |

**PASS**

---

## 2. Comparativo MSI / ZIP / EDB / StackBuilder / custom

| Opção | Veredito auditoria |
|-------|-------------------|
| MSI oficial | **FAIL** para embarcado (registry, paths, conflito desinstalação) |
| ZIP portable / curated | **PASS** — escolha oficial |
| EnterpriseDB GUI | **FAIL** |
| StackBuilder | **FAIL** — excluir |
| Instalador customizado Bootstrap | **PASS** |

Documento RC2-PG-1.0.0 reflete corretamente essa hierarquia.

**PASS** (decisão); **FAIL** evitado se MSI não for usado.

---

## 3. Instalação silenciosa — cluster

| Tópico | Avaliação |
|--------|-----------|
| UTF8 | OK |
| Locale pt_BR + fallback C | OK |
| timezone America/Sao_Paulo | OK (produto BR) |
| listen localhost | OK |
| scram-sha-256 | OK |
| data-checksums | OK |
| Porta 5432 / fallback 55432 | OK — alinha precheck arch |

**WARNING:** tamanho `shared_buffers` fixo 256MB — precheck por RAM pode ser RC2.3.

**PASS**

---

## 4. Roles e permissões

| Item | Avaliação |
|------|-----------|
| Separação app / migrate | OK |
| Superuser `postgres` local only | OK |
| Senhas em DPAPI | OK |
| Role backup dedicada | WARNING — sugerida RC2.3, não bloqueia RC2.2 |

**WARNING** — formalizar ADR RC2-PG-003 (rotação migrate).

---

## 5. PGDATA, backups, WAL

Conforme `RC2_INSTALL_LAYOUT.md`:

| Path | Conforme layout |
|------|-----------------|
| pgdata | OK |
| Backups\pg | OK |
| pg_wal inside pgdata | OK |
| wal_archive opcional | OK (future) |

**PASS**

---

## 6. Repair / rollback / upgrade

| Fluxo | Documentado | Lacuna |
|-------|-------------|--------|
| Repair preserva pgdata | Sim | — |
| Rollback install/update | Sim | Restore físico RC2.2 impl |
| Minor PG patch | Sim | — |
| Major PG | Excluído RC2 | OK |

**PASS**

---

## 7. Bootstrap ↔ PostgreSQL

| Critério | Avaliação |
|----------|-----------|
| Steps RC2.1 mapeados | OK (`install_postgresql` … `db_migrate_full`) |
| Módulo dedicado proposto | OK |
| DbMigrate separado de PG service | OK (SRP arch) |
| Recovery em falha | OK (RC2.1 `handleInstallStepFailure`) |

**PASS**

---

## 8. Compatibilidade Windows

Win10/11/Server 2019/2022 cobertos; 32-bit e Server 2016 excluídos — razoável.

**PASS**

---

## 9. Matriz de riscos

Matriz R1–R10 presente em RC2-PG-1.0.0 §9. Auditoria acrescenta:

| ID | Nota |
|----|------|
| R11 | **Licença redist EDB** — confirmar compliance antes do build pipeline |
| R12 | **Antivírus** bloqueando `postgres.exe` — assinatura Authenticode do pacote RC2 |

---

## 10. Critérios RC2.2

Lista §10 do RC2-PG-1.0.0 é **necessária e suficiente** para gate de codificação.

**WARNING:** homologação final ainda depende **ADR-001** (frontend) e **ADR-003** (health URLs) da RC2-ARCH — não bloqueiam PG isolado, bloqueiam Setup completo.

---

## 11. Conformidade RC2-ARCH

| Seção | Status |
|-------|--------|
| §6 Banco | OK |
| §7 Serviços PG | OK (resolver NSSM — ver abaixo) |
| §10 Rollback | OK |
| Layout §5 | OK via RC2-LAYOUT |

### Achado AUD-PG-01 (WARNING)

**Arquivo:** `docs/AUDITORIA_ARQUITETURA_RC2.md` — NSSM vs `pg_ctl`  
**Causa:** ambiguidade histórica no doc RC2-ARCH §13  
**Impacto:** implementação dupla de serviço  
**Gravidade:** Média  
**Sugestão:** ADR RC2-PG-002 — **apenas** `pg_ctl register` para PostgreSQL; NSSM reservado a Node/API se necessário.

---

## 12. Decisão de gate RC2.2 (código)

| Estado | Condição |
|--------|----------|
| **Liberado para implementar PG module** | Após ADR RC2-PG-001, 002, 003 + SBOM |
| **Bloqueado para Setup/Inno** | Até RC2.2 PG homologado isoladamente |

---

## Veredito final (PASS / WARNING / FAIL)

| Nível | Resultado |
|-------|-----------|
| Proposta arquitetural RC2-PG-1.0.0 | **PASS** |
| Prontidão imediata codificação | **WARNING** |
| Uso MSI/StackBuilder | **FAIL** se escolhidos — **não recomendados** |

**Emitido:**

**WARNING**
