# GUIA COMPLETO - REP AGENT (INSTALADOR + OPERACAO)

Este documento centraliza todas as instrucoes para:

- gerar o instalador `.exe`;
- instalar no cliente;
- operar o agente como servico Windows;
- atualizar sem perder configuracao;
- validar se ficou tudo correto;
- resolver problemas comuns.

---

## 1) Conceitos rapidos (quem e quem)

- `installer/rep-agent.iss`
  - arquivo de projeto do Inno Setup (receita de build).
  - usado apenas por quem compila o instalador.

- `installer/dist-installer/pontowebdesk-rep-agent-setup.exe`
  - instalador final para distribuir ao tecnico/cliente.

- `C:\PontoWebDeskAgent`
  - pasta criada no cliente apos executar o setup.
  - contem scripts, configuracao, logs e runtime do agente.
  - o agente roda como servico Windows (via NSSM + Node), nao como exe proprio.

---

## 2) Pre-requisitos

### Maquina de build (quem gera o instalador)

- Inno Setup 6+
- codigo fonte atualizado

### Maquina cliente (onde sera instalado)

- Windows com permissao de administrador
- Node.js 20+ no PATH
- NSSM disponivel (no PATH ou em caminho conhecido)
- acesso de rede ao relogio REP
- acesso HTTPS ao SaaS (`/api/rep/punch`)

---

## 3) Como gerar o instalador (.exe)

1. Abrir o Inno Setup Compiler.
2. Abrir `installer/rep-agent.iss`.
3. Clicar em `Build/Compile`.
4. Coletar o artefato em:
   - `installer/dist-installer/pontowebdesk-rep-agent-setup.exe`
   - (em alguns ambientes pode sair em `dist-installer` na raiz)

---

## 4) Instalacao no cliente (passo a passo tecnico)

1. Executar `pontowebdesk-rep-agent-setup.exe` como administrador.
2. Escolher o modo:
   - **Manter configuracao atual** (quando ja existe `rep-agent.env`);
   - **Reconfigurar equipamento** (primeira instalacao ou troca de dados).
3. Se reconfigurar, preencher:
   - Marca
   - Modelo
   - IP do relogio
   - Protocolo (`http` ou `https`)
   - Porta
   - URL SaaS
   - Company ID
   - API Key
   - Login/senha do relogio
   - Intervalo de coleta
   - Timezone offset
4. Revisar a tela **Resumo final**.
5. Concluir instalacao.

Ao concluir, o setup:

- salva `rep-agent.env`;
- instala/atualiza o servico `PontoWebDeskRepAgent`;
- inicia o servico.

---

## 5) Campos de configuracao (referencia)

- `REP_SAAS_URL`
  - URL do sistema web (ex.: `https://pontowebdesk.vercel.app`)
- `API_KEY`
  - chave usada no header Bearer para `/api/rep/punch`
- `REP_DEVICE_IP`
  - IP do relogio na rede local
- `REP_DEVICE_SCHEME`
  - `http` ou `https`
- `REP_DEVICE_PORT`
  - porta do relogio (geralmente `80` ou `443`)
- `REP_COMPANY_ID`
  - UUID da empresa
- `REP_DEVICE_LOGIN` / `REP_DEVICE_PASSWORD`
  - credenciais do relogio
- `REP_INSECURE_TLS=1`
  - use apenas em rede interna quando certificado do relogio for self-signed
- `REP_AGENT_INTERVAL_MS`
  - intervalo entre ciclos (ex.: `60000`)
- `REP_DEVICE_TIMEZONE_OFFSET`
  - ex.: `-03:00`
- `REP_FORCE_MODE` (opcional)
  - `1` — desliga go-live automatico; obedece o `.env` literalmente.
- `REP_RECEIVE_SCOPE` (opcional; so com `REP_FORCE_MODE=1`)
  - `incremental` — envia apenas batidas com NSR maior que o ultimo ja processado (`last-nsr.json` em `data/rep-agent/`). Recomendado apos o go-live.
  - `today_only` — envia somente batidas do **dia civil local** do computador onde o agente roda (mesma ideia do painel web em Relogios REP).
- `REP_INGEST_FROM_DATE` (opcional)
  - data minima de envio, formato `YYYY-MM-DD` (ex.: `2026-05-18`). Batidas anteriores sao ignoradas mesmo que existam no AFD.
  - util na **primeira instalacao** para nao importar anos anteriores do relogio.

Campos de inventario:

- `REP_DEVICE_BRAND`
- `REP_DEVICE_MODEL`

---

## 5.1) Go-live automatico (sem configurar escopo na mao)

O agente **auto-configura** na primeira execucao. Nao e obrigatorio definir `REP_RECEIVE_SCOPE` nem `REP_INGEST_FROM_DATE` no `.env`.

| Arquivo | Funcao |
|---------|--------|
| `state/agent-meta.json` | `firstRunCompleted: false` na 1ª vez; vira `true` apos 1ª sync OK |
| `data/rep-agent/last-nsr.json` | Controle incremental por NSR (apos go-live) |
| `data/rep-agent/processed-nsr.json` | Cache local de NSRs ja enviados |

**Fluxo automatico:**

1. **1ª execucao** — logs `[BOOT] Primeira execucao detectada` e `[BOOT] Aplicando modo seguro: today_only`. Ignora escopo do `.env`. So envia batidas de **hoje**.
2. **Airbag** — se o AFD tiver mais de 5000 linhas na 1ª vez, corta para hoje automaticamente.
3. **Apos 1ª sync sem erro de envio** — grava `agent-meta.json` e passa a `incremental` (`[MODE] Mudando para incremental apos inicializacao`).
4. Se a 1ª sync falhar (rede/API), **permanece** em modo seguro ate funcionar.

**Override para tecnicos** (`REP_FORCE_MODE=1` no `.env`):

- Usa exatamente `REP_RECEIVE_SCOPE` e `REP_INGEST_FROM_DATE` do arquivo.
- Desliga a logica automatica.
- Data futura em `REP_INGEST_FROM_DATE` → erro ao iniciar.
- Data com mais de 1 ano → aviso no log.

**API do servidor (opcional):** `GET /api/rep/agent-config?company_id=UUID` (Bearer `API_KEY`) devolve `recommendedScope` e `goLiveDate`.

No **instalador**, a tela **Modo de importacao inicial** so afeta quem escolhe importacao forcada (data especifica ou completo). O padrao recomendado e **automatico** (sem `REP_FORCE_MODE`).

No **painel web** (sync pelo navegador), a opcao **apenas hoje** continua disponivel na tela Relogios REP.

## 5.2) Idempotencia (reenvio sem duplicar)

Cada batida leva um `punch_hash` (SHA-256 de relogio + PIS + data/hora UTC + NSR).

- Pode reenviar o mesmo lote apos falha de rede — o servidor ignora duplicatas.
- `last-nsr.json` e `processed-nsr.json` sao **otimizacao local**, nao garantia de consistencia.
- Aplicar migracao `20260520200000_rep_punch_idempotency_hash.sql` no Supabase antes do go-live.

Resposta tipica do `POST /api/rep/punch`:

```json
{ "success": true, "received": 1, "inserted": 1, "duplicates": 0 }
```

Duplicata:

```json
{ "success": true, "received": 1, "inserted": 0, "duplicates": 1, "duplicate": true }
```

---

## 6) Validacao pos-instalacao (checklist 5 pontos)

1. Servico criado e rodando:
   - `Get-Service PontoWebDeskRepAgent`
2. Pasta criada:
   - `C:\PontoWebDeskAgent`
3. Arquivo de configuracao existe:
   - `C:\PontoWebDeskAgent\scripts\rep-agent.env`
4. Logs existem:
   - `C:\PontoWebDeskAgent\logs\rep-agent.log`
   - `C:\PontoWebDeskAgent\logs\rep-agent.err.log`
5. Backend recebendo:
   - verificar no sistema se batidas estao entrando e sendo reconciliadas.

---

## 7) Atualizacao sem retrabalho

Quando atualizar versao no cliente:

1. executar o novo `pontowebdesk-rep-agent-setup.exe`;
2. selecionar **Manter configuracao atual**;
3. concluir.

Assim, o setup atualiza binarios/scripts e preserva `rep-agent.env`.

---

## 8) Desinstalacao

### Pelo desinstalador

- usar o desinstalador do Windows (Programs and Features / Apps).

### Manual (PowerShell admin)

- `C:\PontoWebDeskAgent\scripts\uninstall-rep-agent-service.ps1`
- para remover tambem arquivos:
  - `C:\PontoWebDeskAgent\scripts\uninstall-rep-agent-service.ps1 -RemoveFiles`

---

## 9) Troubleshooting (problemas comuns)

### A) Servico nao inicia

- validar Node:
  - `node -v`
- validar NSSM:
  - `nssm status PontoWebDeskRepAgent`
- abrir logs:
  - `C:\PontoWebDeskAgent\logs\rep-agent.err.log`

### B) Nao coleta do relogio

- testar conectividade:
  - ping ao IP do relogio
- conferir protocolo/porta (`http/https` e `80/443`)
- conferir login/senha
- para TLS self-signed, usar `REP_INSECURE_TLS=1` (somente rede interna)

### C) Coleta mas nao envia para SaaS

- validar `REP_SAAS_URL`
- validar `API_KEY`
- testar endpoint com curl/postman
- conferir firewall/proxy de saida

### D) Instalador pede dados de novo

- em atualizacao, escolher **Manter configuracao atual**
- conferir existencia de:
  - `C:\PontoWebDeskAgent\scripts\rep-agent.env`

---

## 10) Boas praticas operacionais

- nao compartilhar `API_KEY` em canais inseguros;
- restringir acesso ao servidor cliente;
- manter backup de `rep-agent.env`;
- monitorar logs semanalmente;
- testar setup em ambiente piloto antes de rollout em massa.

---

## 11) Resumo final

- `.iss` = projeto de build
- `.exe` = instalador distribuido ao cliente
- `C:\PontoWebDeskAgent` = runtime instalado no cliente
- servico `PontoWebDeskRepAgent` = processo que roda continuamente a coleta/envio

