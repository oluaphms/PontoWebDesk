# PontoWebDesk — SaaS Demo (portátil)

Pacote **independente** para demonstração em qualquer PC com **Docker Desktop**.

## Como utilizar a demonstração

### Primeira utilização

1. Extraia/copie a pasta `SaaS-Demo` para o PC.
2. Instale e abra o [Docker Desktop](https://www.docker.com/products/docker-desktop/) (se ainda não tiver).
3. Execute:
   ```
   Setup-Demo.bat
   ```
4. Confira o relatório (OK / Atenção / Erro) e o arquivo `setup_log.txt`.
5. Se tudo estiver certo, escolha **S** para iniciar a demonstração automaticamente (`Apresentacao.bat`).

### Modo Apresentação (recomendado em demos presenciais)

1. Dê dois cliques em:
   ```
   Apresentacao.bat
   ```
2. Aguarde a preparação automática (Docker, banco, API, frontend).
3. Se houver `database\backup_demo.sql`, confirme se deseja restaurar.
4. O navegador abre em http://localhost:3110 (e o PDF, se existir).
5. Use as credenciais Master exibidas na tela.

Não é necessário conhecer Docker.

### Menu interativo

1. Execute na raiz desta pasta:
   ```
   PontoWebDesk Demo.bat
   ```
2. No menu, escolha **1 - Iniciar demonstracao**.
3. Aguarde a inicialização (Docker, banco, API e frontend).
4. Faça login com as credenciais Master da tela final (ou veja abaixo).
5. Ao terminar a apresentação, abra de novo `PontoWebDesk Demo.bat` e escolha **4 - Parar sistema**.

## Pré-requisitos

1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado e em execução (Linux engine).
2. Portas livres no host: **3110** (frontend), **3100** (API), **5433** (PostgreSQL).
   (Reservadas para a demo Docker — o SaaS-Local na raiz usa **3010 / 3000 / 5432**.)
3. ~4 GB livres (imagens Node + Postgres + build).

## Menu principal

| Opção | Ação |
|-------|------|
| 1 - Iniciar demonstracao | Sobe o sistema e abre o navegador |
| 2 - Restaurar ambiente | Reset + restore do `backup_demo.sql` |
| 3 - Diagnostico | Relatório do ambiente |
| 4 - Parar sistema | Encerra containers (com confirmações) |
| 5 - Abrir documentacao | Abre este `README.md` |
| 6 - Sair | Fecha o menu |

### Modo Apresentação

| Arquivo | Função |
|---------|--------|
| `Setup-Demo.bat` | **Instalador / primeira utilização** — valida o PC e pode iniciar a demo |
| `Apresentacao.bat` | **Modo automático** — um clique prepara tudo para a demo presencial |

Fluxo: checa Docker/portas → `compose up --build` → espera Postgres healthy → espera API → restore opcional → espera frontend → abre browser (+ PDF se houver) → mostra credenciais.

Coloque o PDF em `Apresentacao.pdf` ou `docs\Apresentacao.pdf` (veja `docs\LEIA-ME_APRESENTACAO.txt`).

### Scripts (uso avançado)

| Script | Função |
|--------|--------|
| `Setup-Demo.bat` | **Instalador inteligente (primeira utilização)** |
| `Apresentacao.bat` | **Modo apresentação (dois cliques)** |
| `PontoWebDesk Demo.bat` | Menu principal interativo |
| `scripts\iniciar.bat` | Sobe a demo com checagens e waits |
| `scripts\parar.bat` | Para containers; pergunta antes de remover volumes |
| `scripts\reset_demo.bat` | Recria stack + restaura backup |
| `scripts\diagnostico.bat` | Relatório → `diagnostico_ultimo.txt` |
| `scripts\restaurar_banco.bat` | Só restaura o SQL |
| `scripts\exportar_backup.bat` | Gera dump a partir do Postgres de origem |
| `scripts\gerar_pacote_demo.bat` | Gera ZIP em `releases\` para o HD externo |

### URLs

| Serviço | URL |
|---------|-----|
| Frontend | http://localhost:3110 |
| API health | http://localhost:3100/api/health |

### Credenciais Master (demo)

- Email: `owner1@demo.local`
- Senha: `DemoOwner1!`
- Alternativa: `owner2@demo.local` / `DemoOwner2!`

## Como restaurar o banco

Pelo menu: opção **2 - Restaurar ambiente**.

Ou manualmente:

```bat
scripts\reset_demo.bat
```

Detalhes: `database/README.md`.

## Como parar

Pelo menu: opção **4 - Parar sistema**.

O banco **nunca** é apagado sem confirmação dupla.

## Gerar pacote ZIP para distribuição

```bat
scripts\gerar_pacote_demo.bat
```

Cria `releases\PontoWebDesk-Demo-v{VERSAO}-{DATA}.zip` (sem `node_modules`, `dist`, logs, etc.).

Versão lida de `VERSION` (ou `frontend/package.json`, fallback `1.0.0`).

## Estrutura

```
SaaS-Demo/
  Setup-Demo.bat          # INSTALADOR (primeira utilizacao)
  Apresentacao.bat        # MODO APRESENTACAO (dois cliques)
  PontoWebDesk Demo.bat   # Menu interativo
  setup_log.txt           # gerado pelo Setup-Demo.bat
  VERSION
  backend/
  frontend/
  shared/
  database/
  docs/                   # PDF / guia da apresentacao
  scripts/
  releases/               # ZIPs gerados
  docker-compose.yml
  .env
  README.md
```

## Notas

- Este pacote **não depende** da pasta original do repositório.
- `node_modules`, `dist`, `.git` e caches **não** precisam ser copiados — o Compose instala deps no build.
- Uso exclusivo para **demonstração**; não é hardening de produção.

### Dependências frontend (jspdf)

Nesta demo: `jspdf-autotable@^5.0.8` alinhado com `jspdf@4`, lock sem `--force` / sem `--legacy-peer-deps`.
