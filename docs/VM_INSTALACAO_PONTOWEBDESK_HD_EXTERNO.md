# Instalação do PontoWebDesk em VM Windows (HD externo)

**Documento:** `VM-INSTALL-HD-1.0.0`  
**Público:** homologação, demonstração e validação do instalador **RC2 Professional** (`Setup.exe`)  
**Última revisão:** 2026-08-07  

Este guia descreve como preparar uma **máquina virtual Windows** gravada em **HD externo**, gerar (ou copiar) o instalador e **instalar o PontoWebDesk Professional** de ponta a ponta.

---

## 1. O que você vai obter

| Item | Caminho / artefato |
|------|-------------------|
| Instalador | `Setup.exe` (Inno Setup RC2.4.3) |
| Aplicação (Program Files) | `C:\Program Files\PontoWebDesk\` |
| Dados (ProgramData) | `C:\ProgramData\PontoWebDesk\` |
| App web (após install) | http://127.0.0.1:3010/ |
| API (serviço Windows) | http://127.0.0.1:3000/ (health via api-runtime) |
| Log do Setup + Bootstrap | `%ProgramData%\PontoWebDesk\Logs\installer.log` |

**Importante:** o instalador Professional **não usa Docker**. Runtime = PostgreSQL embarcado + API + front estático + Bootstrap.

Para o produto legado **Local (Docker)**, veja `installer/README-INSTALLER.md` e `PontoWebDesk-Local-Setup.exe`.

---

## 2. Requisitos da VM

### 2.1 Hardware (mínimo recomendado)

| Recurso | Mínimo | Recomendado |
|---------|--------|-------------|
| SO | Windows 10/11 **64 bits** (PT-BR) | Windows 11 23H2+ |
| vCPU | 2 | 4 |
| RAM | 8 GB | 16 GB |
| Disco virtual | 80 GB | 120 GB+ |
| Rede | NAT ou Bridge (para updates) | Bridge se precisar acessar de outro PC |

### 2.2 HD externo (host físico)

- Use **USB 3.0+** ou **SATA/NVMe** em enclosure estável; evite desconectar com a VM ligada.
- Aloque o arquivo `.vhdx` / `.vmdk` da VM **no HD externo** (Hyper-V, VMware ou VirtualBox).
- Mantenha **≥ 50 GB livres** no HD externo além do tamanho do disco da VM (snapshots + cópia do `Setup.exe`).

### 2.3 Software na VM

- Conta **Administrador** (UAC ativo — o Setup exige elevação).
- **.NET / VC++** — normalmente já presentes no Windows 11; se faltar runtime, instale os redistributables Microsoft x64.
- **Não** é obrigatório Node.js/Git na VM **só para instalar** (somente para **gerar** o `Setup.exe` — seção 4).

### 2.4 Portas (firewall local)

Libere ou confirme que nada ocupa:

| Porta | Uso |
|-------|-----|
| **3010** | Frontend (navegador) |
| **3000** | API HTTP |
| **5432** | PostgreSQL embarcado (localhost) |

PowerShell (Admin):

```powershell
Test-NetConnection -ComputerName 127.0.0.1 -Port 3010
Test-NetConnection -ComputerName 127.0.0.1 -Port 3000
Test-NetConnection -ComputerName 127.0.0.1 -Port 5432
```

---

## 3. Preparar a VM (checklist)

Execute **dentro da VM** antes de instalar:

1. **Windows Update** até estar estável; reinicie.
2. **Fuso horário** e idioma corretos (Brasil).
3. **Desativar hibernação/suspensão** durante install de longa duração (Painel de energia → Nunca suspender).
4. **Antivírus:** se bloquear `Setup.exe`, use pasta de exclusão temporária ou homologação offline.
5. **Snapshot** (opcional mas recomendado): *Checkpoint* “antes do PontoWebDesk” no hypervisor.
6. Criar pasta de recepção, por exemplo:
   - `D:\PontoWebDesk-Release\` (disco da VM)
   - ou unidade compartilhada `\\Host\Release\` mapeada a partir do HD externo

---

## 4. Obter o instalador `Setup.exe`

Há **dois caminhos**. Em produção de release, prefira **A**.

### 4.1 Caminho A — Gerar no PC de desenvolvimento (recomendado)

No **repositório** `PontoWebDesk`, em um Windows com ferramentas de build:

**Pré-requisitos no PC de build**

| Ferramenta | Observação |
|------------|------------|
| Node.js **20–24** + npm ≥ 10 | `node -v`, `npm -v` |
| Inno Setup 6 | [https://jrsoftware.org/isdl.php](https://jrsoftware.org/isdl.php) — `ISCC.exe` |
| PostgreSQL embarcado no staging | Pasta `Database\` com `bin\postgres.exe` (Runtime Builder) |

**Variável para runtime PostgreSQL (obrigatório para `verify:rc2` completo)**

Monte a pasta `Database\` (postgres redist) e aponte:

```bat
set RC2_DATABASE_RUNTIME_DIR=D:\caminho\para\Database
```

Se ainda não tiver o PG empacotado, o stage parcial (sem verify estrito):

```bat
npm run stage:rc2:partial
```

Para release final, use runtime completo +:

```bat
npm run stage:rc2
npm run verify:rc2
```

**Pipeline oficial (gera `dist-installer\Setup.exe`)**

```bat
cd D:\PontoWebDesk
scripts\build-professional-installer.bat
```

Saída:

```text
D:\PontoWebDesk\dist-installer\Setup.exe
```

Log de build:

```text
D:\PontoWebDesk\dist-installer\build-professional-installer.log
```

**Copiar para a VM**

- USB / HD externo: copie `Setup.exe` para `D:\PontoWebDesk-Release\Setup.exe` na VM.
- Ou compartilhamento de rede host ↔ VM.

### 4.2 Caminho B — Gerar dentro da VM (só se clonar o repo na VM)

1. Clone `https://github.com/oluaphms/PontoWebDesk` na VM (branch com RC2.4.3+).
2. Instale Node 20+, Inno Setup 6.
3. Configure `RC2_DATABASE_RUNTIME_DIR` e rode `scripts\build-professional-installer.bat` como na seção 4.1.

Tempo estimado: **30–60 min** (stage + compilação), dependendo de CPU e se `--build` recompila backend/front.

---

## 5. Instalar na VM (assistente gráfico)

1. Copie `Setup.exe` para disco local da VM (ex.: `D:\PontoWebDesk-Release\Setup.exe`).
2. **Clique direito → Executar como administrador**.
3. Aceite o UAC e o assistente **PontoWebDesk Professional**.
4. Pasta padrão: `C:\Program Files\PontoWebDesk` (não altere sem motivo).
5. Tarefas opcionais:
   - Atalho na área de trabalho
   - Abrir navegador ao concluir
6. Aguarde a fase **“Configurando PostgreSQL, API e Bootstrap…”** — pode levar **vários minutos**.
7. Conclusão: abra http://127.0.0.1:3010/

---

## 6. Instalação silenciosa (homologação / repetível)

PowerShell ou CMD **como Administrador**:

```bat
D:\PontoWebDesk-Release\Setup.exe /VERYSILENT /NORESTART /LOG="%TEMP%\pwd-professional-inno.log"
```

Variantes úteis:

| Flag | Efeito |
|------|--------|
| `/SILENT` | Sem perguntas; barra de progresso |
| `/VERYSILENT` | Sem UI |
| `/LOG=caminho` | Log do Inno Setup |
| `/NORESTART` | Não reiniciar Windows automaticamente |

Logs:

| Arquivo | Conteúdo |
|---------|----------|
| `%TEMP%\pwd-professional-inno.log` | Inno Setup |
| `%ProgramData%\PontoWebDesk\Logs\installer.log` | Script `professional-install.ps1` |
| `%ProgramData%\PontoWebDesk\Logs\bootstrap-stdout.log` | Saída do Bootstrap |
| `%ProgramData%\PontoWebDesk\Logs\bootstrap-stderr.log` | Erros do Bootstrap |

---

## 7. Layout após instalação

### 7.1 Program Files

```text
C:\Program Files\PontoWebDesk\
  Backend\          (Node embarcado + server)
  Frontend\www\     (SPA build)
  Database\         (PostgreSQL redist)
  Agent\            (rep-agent.exe)
  Bin\              (api-service-host, migrate runner)
  Bootstrap\        (pipeline RC2)
  Config\templates\
  Migrations\
  layout.manifest.json
  VERSION
  scripts\          (professional-*.ps1)
```

### 7.2 ProgramData

```text
C:\ProgramData\PontoWebDesk\
  Config\           (backend.env, secrets, install-state.json)
  Logs\
  Storage\
  Backups\
  Database\pgdata\  (cluster PostgreSQL)
```

---

## 8. Validação pós-instalação

### 8.1 Serviços Windows

```powershell
Get-Service PontoWebDeskApi, PontoWebDeskPostgreSQL -ErrorAction SilentlyContinue
```

Nomes esperados (podem variar conforme versão do Bootstrap):

- `PontoWebDeskApi`
- `PontoWebDeskPostgreSQL`
- `PontoWebDeskAgent` (se agent registrado)

### 8.2 URLs

| Teste | Comando / ação |
|-------|----------------|
| Front | Navegador → http://127.0.0.1:3010/ (servidor estático `Bin\serve-frontend.mjs`; RC2.4.3+ inicia no pós-install) |
| API live | `curl http://127.0.0.1:3000/api/health/live` |
| API ready | `curl http://127.0.0.1:3000/api/health/ready` |

### 8.3 Bootstrap doctor (opcional)

```powershell
cd "C:\Program Files\PontoWebDesk"
$env:RC2_PROGRAM_FILES_ROOT = "C:\Program Files\PontoWebDesk"
$env:RC2_PROGRAM_DATA_ROOT = "$env:ProgramData\PontoWebDesk"
& ".\Backend\node\node.exe" ".\Bootstrap\dist\index.js" doctor
```

Esperado: JSON com `"ok": true`.

### 8.4 Checklist rápido

- [ ] `C:\Program Files\PontoWebDesk\layout.manifest.json` existe  
- [ ] `%ProgramData%\PontoWebDesk\Logs\installer.log` termina sem `ERROR`  
- [ ] `%ProgramData%\PontoWebDesk\Config\install-state.json` estado `INSTALLED` (ou equivalente)  
- [ ] Front abre no navegador  
- [ ] API responde health  

---

## 9. Solução de problemas

### 9.1 Setup falha na fase Bootstrap

1. Abra `%ProgramData%\PontoWebDesk\Logs\bootstrap-stderr.log`.
2. Confira `%ProgramData%\PontoWebDesk\Config\install-state.json` (`errors`, `lastError`).
3. Portas ocupadas → libere 3000/3010/5432 ou pare serviços conflitantes.
4. Reinstale após desinstalar (seção 10) ou restaure snapshot da VM.

Rollback automático (parcial): serviços SCM são parados/removidos; arquivos em Program Files podem permanecer para diagnóstico.

### 9.2 `verify:rc2` falhou no PC de build

- `Database\bin\postgres.exe` ausente → defina `RC2_DATABASE_RUNTIME_DIR` antes do `stage:rc2`.
- `Bootstrap\dist\index.js` ausente → rode stage com rede/npm ok (`stage-rc2` executa build do bootstrap).

### 9.3 VM lenta no HD externo

- Preferir VHDX fixo em SSD externo; evitar HDD mecânico para disco da VM.
- Desative indexação do Windows no `.vhdx` no **host** se necessário.

### 9.4 Antivírus bloqueia postgres.exe ou node.exe

Exclusões temporárias:

- `C:\Program Files\PontoWebDesk\`
- `C:\ProgramData\PontoWebDesk\`

---

## 10. Desinstalar

**Painel de Controle → Programas → PontoWebDesk Professional → Desinstalar**

Ou execute o desinstalador gerado pelo Inno (atalho no menu Iniciar).

Script manual (Admin), se a pasta ainda existir:

```powershell
& "C:\Program Files\PontoWebDesk\scripts\professional-uninstall.ps1" `
  -InstallDir "C:\Program Files\PontoWebDesk" `
  -ProgramDataDir "$env:ProgramData\PontoWebDesk" `
  -LogFile "$env:ProgramData\PontoWebDesk\Logs\installer.log"
```

**ProgramData** pode ser removido pelo script; confirme backup de `Database\pgdata` se houver dados de teste importantes.

---

## 11. Referências no repositório

| Tema | Arquivo |
|------|---------|
| Plano RC2 + status 4.3 | `docs/RC2_INSTALLER_PROFESSIONAL_PLAN.md` |
| Instalador Local (Docker RC1) | `installer/README-INSTALLER.md` |
| Script Inno Professional | `installer/PontoWebDeskProfessional.iss` |
| Build Professional | `scripts/build-professional-installer.bat` |
| Stage / verify | `npm run stage:rc2`, `npm run verify:rc2` |
| Assinatura (futuro) | `installer/assets/codesign.placeholder.txt` |

---

## 12. Fluxo resumido (diagrama)

```text
[PC Dev]  RC2_DATABASE_RUNTIME_DIR + repo
    │
    ├─► npm run stage:rc2
    ├─► npm run verify:rc2
    ├─► ISCC → dist-installer\Setup.exe
    │
    ▼ (copia via HD externo / USB)
[VM Windows no HD externo]
    │
    ├─► Setup.exe (Admin)
    ├─► Copia → Program Files\PontoWebDesk
    ├─► professional-install.ps1 → Bootstrap embedded
    ├─► Serviços PG + API
    │
    ▼
http://127.0.0.1:3010/  (homologação OK)
```

---

## 13. Próximos passos sugeridos (homologação)

1. Snapshot **pós-install OK**.  
2. Documentar versão em `C:\Program Files\PontoWebDesk\VERSION`.  
3. Teste de login operacional / Master (se apontar para VPS, configurar `.env` em `ProgramData\...\Config` conforme release).  
4. Repetir install **silencioso** em VM limpa (segundo snapshot) para validar repetibilidade.

---

*Dúvidas de arquitetura do instalador: `docs/ARQUITETURA_INSTALADOR_PROFISSIONAL_RC2.md` e `docs/RC2_INSTALL_LAYOUT.md`.*
