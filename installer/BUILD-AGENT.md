# Build e instalação — Agente REP Windows (produção)

## Pré-requisitos (máquina de build)

- Node.js 20+ e npm 10+
- Windows x64 (para gerar o `.exe` e o instalador)
- [Inno Setup 6](https://jrsoftware.org/isinfo.php)
- NSSM — execute `installer/download-nssm.ps1` (espelho GitHub; fallback nssm.cc) ou copie manualmente `win64\nssm.exe` → `installer/nssm.exe`

## 1. Compilar o executável

Na raiz do repositório:

```powershell
npm install
npm run build:agent
```

Saída esperada: `dist/rep-agent.exe` (Node embutido via `pkg`, alvo `node18-win-x64`).

O script `scripts/build-rep-agent-exe.mjs` faz **esbuild** do agente (bundle CJS isolado) e depois **pkg** — necessário porque `pkg .` no monorepo React tentaria empacotar Vite/React inteiro. A configuração `pkg` em `package.json` permanece para metadados (`targets`, `outputPath`).

## 2. Configuração em produção (cliente)

Arquivo obrigatório:

`C:\ProgramData\PontoWebDesk\config.json`

Campos obrigatórios para o agente iniciar o loop:

| Campo | Descrição |
|-------|-----------|
| `saas_url` | `https://pontowebdesk.vercel.app` |
| `api_key` | Chave `API_KEY` do backend Vercel |
| `device_id` | UUID do dispositivo em `rep_devices` |
| `company_id` | UUID da empresa |
| `device_ip` | IP do relógio na LAN |
| `device_port` | Porta (ex.: `443`) |
| `device_login` | Login Control iD (ex.: `admin`) |
| `device_password` | Senha do relógio |
| `timezone` | Offset (ex.: `-03:00`) |

Logs: `C:\ProgramData\PontoWebDesk\logs\agent.log`  
Estado (NSR, meta): `C:\ProgramData\PontoWebDesk\state` e `...\data\rep-agent`

## 3. Gerar instalador

1. Confirme `dist/rep-agent.exe` e `installer/nssm.exe`
2. Abra `installer/setup.iss` no Inno Setup Compiler
3. Compile (Build → Compile)

Saída: `installer/dist-installer/pontowebdesk-rep-agent-exe-setup.exe`

**Importante:** compile `installer/setup.iss` (produção `.exe`). **Não** use `rep-agent.iss` — ele gera o mesmo nome antigo e instala Node em `C:\PontoWebDeskAgent`.

## 4. Instalação no PC da empresa

1. Execute o setup como administrador
2. Arquivos em `C:\Program Files\PontoWebDesk\`
3. Serviço Windows: **PontoWebDeskAgent** (início automático)
4. Edite `C:\ProgramData\PontoWebDesk\config.json` com os dados reais
5. Reinicie o serviço: `nssm restart PontoWebDeskAgent` ou Services.msc

## 5. Verificação

- Event Viewer / `agent.log`: mensagens `[rep-agent]` e heartbeat
- Painel SaaS: dispositivo com status de agente online
- Coleta AFD / incremental conforme política go-live existente

## Desenvolvimento local (sem .exe)

Com `config.json` em `C:\ProgramData\PontoWebDesk\` **ou** `.env.local` na raiz:

```powershell
npm run rep:agent
```

Sem `config.json`, o agente usa `.env` / `.env.local` (somente desenvolvimento).

## Notas técnicas

- O executável **não** lê `.env`; apenas `config.json` em ProgramData.
- `localhost` em `saas_url` é bloqueado no binário empacotado.
- NSSM não é versionado no git — use `installer/download-nssm.ps1` ou [release GitHub](https://github.com/fawno/nssm.cc/releases/tag/v2.24.1) se nssm.cc estiver fora.
