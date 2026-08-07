# Relatório — Correção FAIL #1 (`docker-compose.yml` inválido)

**Data:** 2026-08-06  
**Escopo:** Apenas empacotamento do instalador (sem alteração de backend, frontend, banco ou regras de negócio).

---

## Causa

O `docker-compose.yml` do runtime demo é **gerado** pelo script de pack, não versionado manualmente no repo principal.

No healthcheck do serviço `backend`, o valor de `test` usava **sequência YAML flow** com aspas duplas aninhadas:

```yaml
test: ["CMD-SHELL", "node -e "fetch('...')...""]
```

Ao gravar o arquivo, as `\"` do template JavaScript viraram `"` literais **dentro** da string YAML, fechando a string antes de `fetch`. O parser do Docker Compose falha em **linha 38, coluna 37** com: `did not find expected ',' or ']'`.

---

## Quem gera o compose

| Papel | Arquivo |
|-------|---------|
| **Gerador** | `scripts/_pack_saas_demo.mjs` — chamada `writeFile('docker-compose.yml', \`...\`)` |
| **Orquestrador** | `scripts/sync-installer-runtime.mjs` — executa `_pack_saas_demo.mjs` e espelha para `PontoWebDesk-Demo/SaaS-Demo/` |
| **Instalador** | `installer/build-installer.bat` — robocopy de `PontoWebDesk-Demo/SaaS-Demo` (ou `SaaS-Demo`) → `installer/staging/` |

**Arquivo fonte lógico:** template em `scripts/_pack_saas_demo.mjs` (não há `docker-compose.yml` estático no RC1 usado pelo instalador).

**Linha que gerava o healthcheck incorreto:** ~432 (bloco `healthcheck` do serviço `backend`), conteúdo anterior:

```javascript
test: ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:3000/api/health/live')...\""]
```

---

## Correção aplicada

**Arquivo alterado:** `scripts/_pack_saas_demo.mjs`  
**Linhas:** 431–436 (healthcheck `backend`)

Substituição da sequência flow por **lista YAML multilinha**, evitando aspas duplas conflitantes:

```yaml
    healthcheck:
      test:
        - CMD-SHELL
        - node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

Nenhum outro arquivo de aplicação foi modificado.

---

## Pipeline executado

| Etapa | Resultado | Evidência |
|-------|-----------|-----------|
| `node scripts/sync-installer-runtime.mjs` | **WARNING** | `_pack_saas_demo.mjs` concluiu (`SaaS-Demo` recriado). Espelho `PontoWebDesk-Demo/SaaS-Demo` falhou com `EPERM` enquanto containers Docker usavam o diretório. **Mitigação:** `docker-compose.yml` copiado de `SaaS-Demo` → `PontoWebDesk-Demo/SaaS-Demo`. |
| `npm run installer:verify-runtime` | **PASS** | `"pass": true` |
| `installer/build-installer.bat` | **PASS** | `installer/dist-installer/PontoWebDesk-Local-Setup.exe` gerado |
| `docker compose config` | **PASS** | `SaaS-Demo`, `PontoWebDesk-Demo/SaaS-Demo`, `installer/staging` — exit 0 (`config -q`) |
| `docker compose up` | **PASS** | Três serviços **Up**; postgres **healthy**; backend **healthy**; HTTP 200 em `:3000/health` e `:3010/` |

### `docker compose up --build`

**FAIL** (fora do FAIL #1): rebuild do **frontend** falhou em `npm install` (`ERESOLVE` jspdf / jspdf-autotable). Não corrigido neste escopo (empacotamento compose apenas). Subida com **imagens já existentes** (`docker compose up -d`) validou o compose corrigido.

---

## Evidências — containers (2026-08-06)

```text
pontowebdesk-saas-demo-postgres-1   Up (healthy)   5432
pontowebdesk-saas-demo-backend-1    Up (healthy)   3000
pontowebdesk-saas-demo-frontend-1   Up             3010
```

- `GET http://localhost:3000/health` → **200**
- `GET http://localhost:3010/` → **200**

Staging empacotado no `.exe` contém o mesmo healthcheck (linhas 38–41 de `installer/staging/docker-compose.yml`).

---

## Resumo PASS / FAIL

| Item | Status |
|------|--------|
| FAIL #1 — YAML inválido | **PASS** (corrigido na geração) |
| `docker compose config` | **PASS** |
| `verify-installer-runtime` | **PASS** |
| Novo `PontoWebDesk-Local-Setup.exe` | **PASS** |
| `docker compose up` (postgres + backend + frontend) | **PASS** |
| `sync-installer-runtime` espelho completo | **WARNING** (EPERM com stack ativa; compose alinhado manualmente) |
| `docker compose up --build` (rebuild limpo) | **FAIL** (npm frontend; escopo não alterado) |

---

## Veredito

**FAIL #1 resolvido** no empacotamento. Instalador RC1 recompilado com `docker-compose.yml` válido. Recomenda-se repetir `sync-installer-runtime` com stack parada (ou sem locks em `PontoWebDesk-Demo/SaaS-Demo`) antes do próximo release build.
