# Auditoria de Implantação Final — PontoWebDesk

**Data:** 2026-08-04  
**Modo:** Somente leitura (sem alteração de código/UI/regras)  
**Escopo:** VPS produção + instalador Windows (.exe)

---

## Vereditos

### VPS

# ❌ VPS NÃO APROVADA

Existem pendências **críticas** que impedem declarar a VPS pronta para produção sem risco material (migrations RC fora do git, impossível auditar paridade live só com o repo, Redis obrigatório não amarrado no compose de exemplo, drill de restore não comprovado).

**Nota VPS: 6,5 / 10**

### Instalador Windows (produto SaaS completo / Demo)

# ❌ INSTALADOR NÃO APROVADO

Não existe instalador `.exe` do SaaS completo capaz de deixar um Windows limpo 100% funcional. O que existe é:

- Instalador **Agente REP** (Inno Setup) — aprovável como *componente*, não como produto SaaS.
- Pacote **Demo** = ZIP + BAT + Docker Compose — exige Docker Desktop pré-instalado.

**Nota Instalador SaaS: 3,5 / 10**  
**Nota Instalador Agente REP (separado): 7,5 / 10**

---

## 1. Pendências da VPS

| ID | Sev | Pendência |
|----|-----|-----------|
| VPS-C1 | CRÍTICA | Migrations `041`, `042`, `043` **não estão no git** — deploy a partir do remote não aplica RLS completa |
| VPS-C2 | CRÍTICA | Sem evidência automática código × banco **live da VPS** (sem `DATABASE_URL` de prod nesta auditoria) |
| VPS-C3 | CRÍTICA | Produção exige Redis (rate-limit fail-closed); compose exemplo não provisiona Redis |
| VPS-A1 | ALTA | `db:migrate` mínimo sem ledger (risco de reaplicar SQL); preferir `db:migrate:full` |
| VPS-A2 | ALTA | Drill de restore não executado/registrado |
| VPS-A3 | ALTA | Compose API exemplo incompleto (`VPS_RLS_ENFORCED`, `MASTER_JWT_SECRET`, device key, Redis) |
| VPS-A4 | ALTA | CI não aplica nem valida `backend/db/migrations` |
| VPS-M1 | MÉDIA | Health não checa Redis/RLS |
| VPS-M2 | MÉDIA | `MASTER_JWT_SECRET` não aborta boot |
| VPS-M3 | MÉDIA | Numeração migrations: sem `001`; duplicatas `005` e `011` |

---

## 2. Pendências do banco

| ID | Sev | Pendência |
|----|-----|-----------|
| DB-C1 | CRÍTICA | Commitar e aplicar `041`–`043` em **todos** os ambientes (local já tem 043; VPS desconhecida) |
| DB-A1 | ALTA | Confirmar na VPS: `_schema_migrations` / lista de policies `vps_%` = 109 tabelas ops |
| DB-A2 | ALTA | Confirmar extensões: `pgcrypto`, `uuid-ossp`, `plpgsql` |
| DB-M1 | MÉDIA | Inventários de docs desatualizados vs 44 SQL |
| DB-I1 | INFO | Local `pg16-restore`: 109 policies RLS; FKs órfãs amostradas = 0; extensões OK |

**Comparação automática código × VPS live:** **não possível** nesta sessão (sem credencial VPS).  
**Comparação código × banco local validado:** migrations 016/017/043 aplicadas; 109/109 policies.

---

## 3. Pendências do instalador

| ID | Sev | Pendência |
|----|-----|-----------|
| INS-C1 | CRÍTICA | Não existe `.exe` Inno/NSIS/WiX do **SaaS completo** (API+UI+DB) |
| INS-C2 | CRÍTICA | Demo/SaaS local **não** instala em Windows limpo sem Docker Desktop manual |
| INS-C3 | CRÍTICA | Pasta `Instaladores/` inexistente; pacote Demo não embute Docker/imagens |
| INS-A1 | ALTA | Sem atalhos/uninstall Add-Remove para Demo; só BATs |
| INS-A2 | ALTA | Sem regras de firewall automáticas |
| INS-A3 | ALTA | Licença do Inno do agente = GPL NSSM, não licença do produto |
| INS-M1 | MÉDIA | `build:agent` gera só `rep-agent.exe`, não o SaaS |
| INS-OK | INFO | `installer/setup.iss` + `dist-installer/*-exe-setup.exe` OK para **Agente REP** |

---

## 4. Arquivos que precisam ser alterados (recomendação — não alterados nesta auditoria)

1. Versionar `backend/db/migrations/041_*.sql`, `042_*.sql`, `043_*.sql`
2. `deploy/docker-compose.api.example.yml` — Redis, `VPS_RLS_ENFORCED`, secrets Master/device
3. Template `backend/.env.production.example` versionado (sem segredos)
4. Novo `installer/saas-local.iss` (ou equivalente) **ou** documentar oficialmente que SaaS = VPS + Demo via Docker
5. CI: validar/aplicar `backend/db/migrations` + checagem de ledger
6. (Opcional) Health: probe Redis

---

## 5. Ordem recomendada de execução

1. Commitar migrations 041–043  
2. Na VPS: backup → `db:migrate:full` (ou apply controlado) → confirmar 043/RLS  
3. Provisionar Redis; setar envs de produção; restart API  
4. Smoke: health, login, Master, finance, ponto  
5. Drill restore em staging  
6. Decidir produto instalador:  
   - **Caminho A:** SaaS só na VPS (sem .exe full) — documentar  
   - **Caminho B:** construir instalador Demo com Docker Desktop embutido/pré-req oficial + imagens offline  
7. Manter instalador Agente REP como artefato separado do cliente com relógio  

---

## 6. Estimativa de esforço

| Trabalho | Esforço |
|----------|---------|
| Commit + apply 041–043 + checklist VPS | 0,5–1 dia |
| Completar compose/env prod + Redis | 0,5 dia |
| Drill restore + registro | 0,5 dia |
| CI migrations backend | 1 dia |
| Instalador SaaS “Windows limpo” (Docker bundle ou runtime embutido) | **5–15 dias** |
| Apenas documentar SaaS=VPS + Demo=Docker (sem .exe full) | 0,5 dia |

---

## 7. Riscos de implantação

| Risco | Impacto |
|-------|---------|
| Deploy VPS sem 043 | Isolamento RLS incompleto |
| Deploy sem Redis | Login/API 503 |
| Usar `db:migrate` cego | Reexecução destrutiva / drift |
| Cliente receber “instalador” Demo sem Docker | Instalação falha; suporte sobrecarregado |
| Confundir `rep-agent-setup.exe` com instalador do sistema | Expectativa errada do cliente |

---

## 8. Checklist final

### VPS
- [ ] 041–043 no repositório remoto
- [ ] Migrations aplicadas na VPS (evidência)
- [ ] `VPS_RLS_ENFORCED=true`
- [ ] Redis operacional
- [ ] JWT/MASTER_JWT fortes
- [ ] CORS sem localhost
- [ ] Health 200 + smoke auth/Master
- [ ] Backup agendado + restore drill

### Instalador SaaS
- [ ] Definir escopo (.exe full vs VPS-only)
- [ ] Se .exe: Inno/NSIS + runtime (Docker ou embutido)
- [ ] Atalhos, uninstall, firewall, VERSION, LICENSE produto
- [ ] Teste em Windows limpo documentado

### Já OK (parcial)
- [x] Instalador Agente REP (Inno)
- [x] Pacote Demo ZIP (com Docker)
- [x] Health/live/ready no Express
- [x] Scripts DR documentados
- [x] RLS 043 validada no Postgres **local**

---

## 9–10. Notas

| Dimensão | Nota |
|----------|------|
| Implantação VPS | **6,5 / 10** |
| Instalador SaaS / Demo Windows limpo | **3,5 / 10** |
| Instalador Agente REP (componente) | **7,5 / 10** |

---

## Resposta obrigatória

**❌ VPS NÃO APROVADA**

**❌ INSTALADOR NÃO APROVADO**  
*(entendendo “instalador” como o produto SaaS completo em Windows limpo; o instalador do Agente REP existe e é utilizável como artefato separado.)*
