# Instalação do Agente REP no PC do Cliente

Guia passo a passo para instalar o **PontoWebDesk REP Agent** em um computador Windows na rede do cliente (junto ao relógio Control iD).

O agente roda como **serviço Windows**, inicia automaticamente após o boot, envia heartbeat ao SaaS e coleta batidas do relógio sem precisar abrir nenhum programa manualmente.

---

## 1. O que o PC do cliente precisa ter

### Requisitos obrigatórios

| Item | Detalhe |
|------|---------|
| **Sistema operacional** | Windows 10 ou 11 (64 bits) |
| **Privilégios** | Conta de **Administrador** (para instalar o serviço) |
| **Rede — internet** | Saída HTTPS (porta 443) para a API do PontoWebDesk |
| **Rede — LAN** | Mesma rede local do relógio Control iD (ex.: `192.168.1.x`) |
| **Relógio REP** | Control iD ligado, com IP fixo ou reservado no roteador |
| **Cadastro no SaaS** | Empresa, relógio e `device_id` já cadastrados no painel PontoWebDesk |

### O que **não** precisa instalar no PC do cliente

O instalador oficial já inclui tudo necessário para produção:

- **Node.js** — não é necessário (o agente é um `rep-agent.exe` empacotado)
- **NSSM** — incluído no instalador
- **Git, npm ou código-fonte** — só na máquina de desenvolvimento/distribuição

### Recomendações de hardware e rede

- PC que fique ligado durante o horário comercial (ou 24h, se desejado)
- Conexão estável (cabo de rede preferível ao Wi‑Fi)
- Firewall do Windows permitindo o agente acessar:
  - **Internet** (API SaaS)
  - **Relógio** na porta configurada (geralmente `80` ou `443`)
- `curl.exe` já vem no Windows 10/11 e é usado pelo agente para falar com o relógio

---

## 2. O que será instalado automaticamente

Após rodar o instalador `pontowebdesk-rep-agent-exe-setup.exe`:

| Componente | Local |
|------------|-------|
| Executável do agente | `C:\Program Files\PontoWebDesk\rep-agent.exe` |
| NSSM (gerenciador de serviço) | `C:\Program Files\PontoWebDesk\nssm.exe` |
| Script de configuração NSSM | `C:\Program Files\PontoWebDesk\scripts\configure-rep-agent-nssm.ps1` |
| Configuração do agente | `C:\ProgramData\PontoWebDesk\config.json` |
| Logs | `C:\ProgramData\PontoWebDesk\logs\` |
| Estado / fila local | `C:\ProgramData\PontoWebDesk\state\` e `data\` |
| **Serviço Windows** | Nome: `PontoWebDeskAgent` — início **Automático** |

Configurações aplicadas ao serviço:

- Dependência de rede: **Tcpip** (só inicia depois da stack TCP/IP)
- Recovery: reinício automático em falha (60 s, até 3 vezes; reset do contador em 24 h)
- NSSM: reinício do processo em crash (`AppExit Restart`, delay 15 s)
- Variável de ambiente: `REP_ENABLE_COMMANDS=1` (comandos do painel web)

---

## 3. Antes de ir ao cliente — preparar o instalador

Na máquina de **desenvolvimento/distribuição** (não no cliente):

```powershell
cd D:\PontoWebDesk
npm run build:agent
```

Compile o instalador Inno Setup (se ainda não tiver o `.exe`):

- Arquivo: `installer\setup.iss`
- Saída: `installer\dist-installer\pontowebdesk-rep-agent-exe-setup.exe`

Copie para pendrive ou envie ao cliente apenas:

- `pontowebdesk-rep-agent-exe-setup.exe`

---

## 4. Dados necessários do painel SaaS

Antes ou durante a instalação, anote no painel **PontoWebDesk → Relógios REP**:

| Campo | Onde obter | Exemplo |
|-------|------------|---------|
| `saas_url` | URL da API | `https://api.phmsdev.com.br` |
| `api_key` | Chave da empresa / integração REP | `0137…` |
| `company_id` | UUID da empresa | `a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b` |
| `device_id` | UUID do relógio cadastrado | `b325be3b-9338-44aa-a0a5-36c2d1fe0a81` |
| `device_ip` | IP do Control iD na LAN | `192.168.1.20` |
| `device_port` | Porta HTTP/HTTPS do relógio | `80` ou `443` |
| `device_login` | Usuário admin do relógio | `admin` |
| `device_password` | Senha do relógio | *(senha real)* |

Confirme no PC do cliente que o relógio responde, por exemplo no navegador:

`http://192.168.1.20` (ou a IP/porta corretos)

---

## 5. Instalação no PC do cliente (passo a passo)

### Passo 1 — Executar o instalador como Administrador

1. Copie `pontowebdesk-rep-agent-exe-setup.exe` para o PC do cliente.
2. Clique com o botão direito → **Executar como administrador**.
3. Siga o assistente até concluir.
4. O instalador irá:
   - Criar pastas em `Program Files` e `ProgramData`
   - Registrar o serviço `PontoWebDeskAgent`
   - Configurar Tcpip, recovery e logs
   - Iniciar o serviço

### Passo 2 — Configurar o `config.json`

Abra o arquivo (como Administrador, se necessário):

```
C:\ProgramData\PontoWebDesk\config.json
```

Preencha os campos principais (modelo):

```json
{
  "saas_url": "https://api.phmsdev.com.br",
  "api_key": "SUA_API_KEY",
  "device_id": "UUID_DO_RELOGIO",
  "company_id": "UUID_DA_EMPRESA",
  "device_ip": "192.168.1.20",
  "device_port": 80,
  "device_login": "admin",
  "device_password": "SENHA_DO_RELOGIO",
  "device_scheme": "http",
  "timezone": "-03:00",
  "insecure_tls": true,
  "agent_interval_ms": 60000,
  "heartbeat_interval_ms": 60000,
  "enable_commands": true
}
```

**Importante:**

- Salve o arquivo em **UTF-8 sem BOM** (use Notepad++ ou VS Code; evite salvar com “UTF-8 com BOM”).
- Não deixe vírgulas sobrando nem comentários — deve ser JSON válido.
- Se o arquivo foi criado vazio pelo instalador, substitua todo o conteúdo pelo JSON acima preenchido.

### Passo 3 — Reiniciar o serviço após salvar a config

Abra **PowerShell como Administrador**:

```powershell
& "C:\Program Files\PontoWebDesk\nssm.exe" restart PontoWebDeskAgent
```

Ou pelo Gerenciador de Serviços (`services.msc`):

- Serviço: **PontoWebDesk REP Agent** (`PontoWebDeskAgent`)
- Botão **Reiniciar**

### Passo 4 — Verificar se subiu corretamente

```powershell
Get-Service PontoWebDeskAgent
```

Esperado: `Status: Running`, `StartType: Automatic`

Ver últimas linhas do log:

```powershell
Get-Content C:\ProgramData\PontoWebDesk\logs\agent.log -Tail 30
```

Marcadores que devem aparecer após o boot:

```
[AGENT STARTUP]
[CONFIG LOADED]
[NETWORK READY]
[SERVICE START COMPLETE]
[HEARTBEAT SENT]
```

### Passo 5 — Confirmar no painel SaaS

1. Acesse o painel PontoWebDesk.
2. Vá em **Relógios REP** (ou equivalente).
3. O dispositivo deve aparecer como **Online** (heartbeat recebido).
4. Opcional: use **Testar conexão** no painel — o agente precisa estar com `enable_commands: true`.

### Passo 6 — Teste de reboot (validação final)

1. Reinicie o Windows **sem** abrir manualmente o agente.
2. Aguarde 2–3 minutos após o login.
3. Confira novamente o log e o painel SaaS.

Se após o reboot o agente estiver **Online** e o log mostrar `[HEARTBEAT SENT]`, a instalação está concluída.

---

## 6. Validação completa (script de auditoria)

Se o repositório estiver no PC (máquina de suporte) ou você copiar o script:

```powershell
# PowerShell como Administrador — use caminho ABSOLUTO
powershell -ExecutionPolicy Bypass -File "D:\PontoWebDesk\scripts\validate-rep-agent-service.ps1"
```

O script verifica:

- Serviço registrado e **Automatic**
- Dependência **Tcpip**
- Recovery restart/60s
- NSSM AppExit / AppRestartDelay
- Marcadores no `agent.log`

**Erro comum:** rodar o script de outra pasta (ex.: `C:\Windows\System32`) sem o caminho completo — o PowerShell não encontra o arquivo.

---

## 7. Atualizar o agente (nova versão)

### No PC do cliente (se tiver o repositório ou scripts copiados)

```powershell
# 1. Na máquina de build (desenvolvimento)
cd D:\PontoWebDesk
npm run build:agent

# 2. Copiar dist\rep-agent.exe para o cliente OU rodar deploy no cliente:
powershell -ExecutionPolicy Bypass -File "D:\PontoWebDesk\scripts\deploy-rep-agent.ps1"
```

O `deploy-rep-agent.ps1`:

- Para o serviço
- Copia o novo `rep-agent.exe` para `C:\Program Files\PontoWebDesk\`
- Garante `REP_ENABLE_COMMANDS=1`
- Reinicia o serviço

### Sem repositório no cliente

1. Gere o novo `rep-agent.exe` na máquina de desenvolvimento.
2. Pare o serviço no cliente (Admin):

   ```powershell
   & "C:\Program Files\PontoWebDesk\nssm.exe" stop PontoWebDeskAgent
   ```

3. Substitua `C:\Program Files\PontoWebDesk\rep-agent.exe` pelo arquivo novo.
4. Inicie o serviço:

   ```powershell
   & "C:\Program Files\PontoWebDesk\nssm.exe" start PontoWebDeskAgent
   ```

---

## 8. Comandos úteis no dia a dia

| Ação | Comando (PowerShell Admin) |
|------|----------------------------|
| Status do serviço | `Get-Service PontoWebDeskAgent` |
| Reiniciar agente | `& "C:\Program Files\PontoWebDesk\nssm.exe" restart PontoWebDeskAgent` |
| Ver log em tempo real | `Get-Content C:\ProgramData\PontoWebDesk\logs\agent.log -Wait -Tail 20` |
| Ver dependências SCM | `sc.exe qc PontoWebDeskAgent` |
| Ver recovery | `sc.exe qfailure PontoWebDeskAgent` |
| Processo rodando? | `Get-Process rep-agent -ErrorAction SilentlyContinue` |

---

## 9. Solução de problemas

### Agente Offline no SaaS, mas serviço Running

1. Confira `config.json`: `saas_url`, `api_key`, `device_id`, `company_id`.
2. Teste internet no PC: abrir `https://api.phmsdev.com.br/api/health` no navegador.
3. Veja o log: `C:\ProgramData\PontoWebDesk\logs\agent.log`.
4. Reinicie: `nssm restart PontoWebDeskAgent`.

### Erro `config.json inválido (JSON)`

- Arquivo corrompido, BOM UTF-8 ou conteúdo que não é JSON.
- Regrave o arquivo em UTF-8 **sem BOM**.
- Se tiver o repositório: `powershell -ExecutionPolicy Bypass -File scripts\fix-config-json-bom.ps1`

### Heartbeat OK, mas coleta / login no relógio falha

- Relógio desligado ou IP errado.
- PC do agente não alcança `device_ip` (teste `ping 192.168.1.20`).
- Porta errada (`80` vs `443`) ou `device_scheme` incorreto.
- No log, procure: `[REP LOGIN ERROR]`, `[REP LOGIN CURL ERROR]`.

### Serviço não inicia após reboot

```powershell
sc.exe qc PontoWebDeskAgent
```

Confirme:

- `AUTO_START`
- `DEPENDÊNCIAS: Tcpip`

Se faltar, como Admin:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Program Files\PontoWebDesk\scripts\configure-rep-agent-nssm.ps1" `
  -ServiceName PontoWebDeskAgent `
  -NssmPath "C:\Program Files\PontoWebDesk\nssm.exe" `
  -LogDir "C:\ProgramData\PontoWebDesk\logs"
```

### Reinstalar serviço (último recurso)

Com o repositório na máquina de suporte:

```powershell
powershell -ExecutionPolicy Bypass -File "D:\PontoWebDesk\scripts\reinstall-rep-agent-service.ps1"
```

---

## 10. Desinstalação

1. **Painel de Programas** → desinstalar **PontoWebDesk REP Agent**,  
   **ou**
2. PowerShell Admin:

   ```powershell
   & "C:\Program Files\PontoWebDesk\nssm.exe" stop PontoWebDeskAgent
   & "C:\Program Files\PontoWebDesk\nssm.exe" remove PontoWebDeskAgent confirm
   ```

Os dados em `C:\ProgramData\PontoWebDesk\` (config, logs, estado) **podem ser mantidos** para reinstalação — o instalador não apaga `config.json` por padrão.

---

## 11. Checklist rápido para o técnico

- [ ] Windows 10/11 64 bits, usuário Admin
- [ ] PC na mesma rede do relógio Control iD
- [ ] Internet HTTPS funcionando
- [ ] Relógio cadastrado no SaaS (`device_id`, `company_id`)
- [ ] `pontowebdesk-rep-agent-exe-setup.exe` executado como Admin
- [ ] `config.json` preenchido e salvo sem BOM
- [ ] Serviço `PontoWebDeskAgent` = Running / Automatic
- [ ] Log com `[HEARTBEAT SENT]`
- [ ] Painel SaaS = **Online**
- [ ] Reboot testado — Online sem intervenção manual

---

## 12. Referência de arquivos (suporte interno)

| Arquivo | Uso |
|---------|-----|
| `installer\dist-installer\pontowebdesk-rep-agent-exe-setup.exe` | Instalador para o cliente |
| `installer\config.template.json` | Modelo do `config.json` |
| `scripts\deploy-rep-agent.ps1` | Atualizar exe em produção |
| `scripts\validate-rep-agent-service.ps1` | Auditoria pós-instalação |
| `scripts\configure-rep-agent-nssm.ps1` | Tcpip, recovery, NSSM |
| `scripts\reinstall-rep-agent-service.ps1` | Reinstalar serviço |
| `docs\runbooks\rep-agent-producao-checklist.md` | Checklist operacional avançado |

---

## Fluxo resumido

```
Instalador (Admin)
       ↓
Serviço PontoWebDeskAgent criado (Automatic + Tcpip)
       ↓
Editar config.json (credenciais SaaS + IP do relógio)
       ↓
nssm restart PontoWebDeskAgent
       ↓
[NETWORK READY] → [HEARTBEAT SENT] → SaaS Online
       ↓
Reboot Windows → agente sobe sozinho → coletas automáticas
```
