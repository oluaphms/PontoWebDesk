## Instalador do REP Agent (Windows)

Arquivos:

- `rep-agent.iss`: script Inno Setup para gerar o `setup.exe`

### Pré-requisitos

- Node.js 20+ instalado na máquina de destino
- NSSM disponível na máquina de destino (ou no PATH)
- Inno Setup 6+ na máquina de build

### Como gerar o instalador

1. Abra o Inno Setup Compiler.
2. Carregue `installer/rep-agent.iss`.
3. Compile (`Build`).
4. O artefato será gerado em `dist-installer/pontowebdesk-rep-agent-setup.exe`.

### Fluxo do técnico (com wizard)

1. Executar `pontowebdesk-rep-agent-setup.exe` como administrador.
2. Preencher no wizard:
   - primeiro escolha:
     - **Manter configuração atual** (quando já existe `rep-agent.env`), ou
     - **Reconfigurar equipamento**.
   - em reconfiguração, preencher:
     - marca/modelo,
     - IP/protocolo/porta,
     - URL SaaS,
     - company id,
     - API key,
     - login/senha do relógio.
3. Revisar a tela **Resumo final** antes de concluir.
4. Finalizar instalação (o setup gera `rep-agent.env` e instala o serviço automaticamente).
5. Verificar:
   - `Get-Service PontoWebDeskRepAgent`
   - logs em `C:\PontoWebDeskAgent\logs`

### Desinstalação

- O próprio desinstalador chama `uninstall-rep-agent-service.ps1`.
- Se necessário manual:
  - `C:\PontoWebDeskAgent\scripts\uninstall-rep-agent-service.ps1 -RemoveFiles`
