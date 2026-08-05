; Inno Setup — PontoWebDesk Local (SaaS instalável via Docker Compose)
; Gera: dist-installer\PontoWebDesk-Local-Setup.exe
;
; Pré-requisitos de build (build-installer.bat):
;   1) staging\ populado (compose + app + banco inicial)
;   2) nssm.exe em installer\
;   3) Inno Setup 6 (ISCC.exe)
;
; Docker Desktop Installer.exe é opcional em prereqs\ (recomendado para Windows limpo).

#define MyAppName "PontoWebDesk Local"
#define MyAppVersion "1.0.0-rc.1"
#define MyAppPublisher "PontoWebDesk"
#define MyAppURL "https://pontowebdesk.vercel.app"
#define ServiceName "PontoWebDeskLocal"
#define DataRoot "{commonappdata}\PontoWebDesk\Local"

#if !FileExists(AddBackslash(SourcePath) + "nssm.exe")
  #error "installer\nssm.exe ausente. Execute: powershell -File installer\download-nssm.ps1"
#endif
#if !FileExists(AddBackslash(SourcePath) + "staging\docker-compose.yml")
  #error "installer\staging\ incompleto. Execute: installer\build-installer.bat (etapa de staging)"
#endif
#if !FileExists(AddBackslash(SourcePath) + "scripts\install-runtime.ps1")
  #error "installer\scripts\install-runtime.ps1 ausente."
#endif

[Setup]
AppId={{A7C2E91F-4B8D-4E2A-9F31-6D0C8B5A1E44}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={commonpf}\PontoWebDesk\Local
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=no
AllowNoIcons=yes
PrivilegesRequired=admin
OutputDir=dist-installer
OutputBaseFilename=PontoWebDesk-Local-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupLogging=yes
UninstallDisplayName={#MyAppName}
VersionInfoVersion=1.0.0.0
VersionInfoCompany={#MyAppPublisher}
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion=1.0.0.0
CloseApplications=force
RestartIfNeededByRun=no
; Silencioso: PontoWebDesk-Local-Setup.exe /VERYSILENT /NORESTART /LOG="%TEMP%\pwd-setup.log"

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na Área de Trabalho"; GroupDescription: "Atalhos:"; Flags: unchecked
Name: "autostart"; Description: "Iniciar PontoWebDesk automaticamente com o Windows"; GroupDescription: "Inicialização:"; Flags: checkedonce
Name: "openbrowser"; Description: "Abrir o sistema no navegador ao concluir"; GroupDescription: "Pós-instalação:"; Flags: checkedonce
Name: "installdocker"; Description: "Instalar Docker Desktop se estiver ausente (requer prereqs\DockerDesktopInstaller.exe no pacote)"; GroupDescription: "Dependências:"; Flags: checkedonce

[Dirs]
Name: "{app}"
Name: "{app}\bin"
Name: "{app}\scripts"
Name: "{app}\runtime"
Name: "{app}\logs"
Name: "{app}\updates"
Name: "{app}\prereqs"
Name: "{#DataRoot}"
Name: "{#DataRoot}\logs"
Name: "{#DataRoot}\database"
Name: "{#DataRoot}\backups"

[Files]
Source: "staging\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "nssm.exe"; DestDir: "{app}\bin"; Flags: ignoreversion
Source: "scripts\*.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "VERSION"; DestDir: "{app}"; Flags: ignoreversion
Source: "LICENSE-PRODUCT.txt"; DestDir: "{app}"; DestName: "LICENSE.txt"; Flags: ignoreversion
Source: "prereqs\DockerDesktopInstaller.exe"; DestDir: "{app}\prereqs"; Flags: ignoreversion skipifsourcedoesntexist

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\PontoWebDesk Local.url"
Name: "{group}\Iniciar PontoWebDesk"; Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\scripts\start-stack.ps1"" -InstallDir ""{app}"" -OpenBrowser"; WorkingDir: "{app}"
Name: "{group}\Parar PontoWebDesk"; Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\scripts\stop-stack.ps1"" -InstallDir ""{app}"""; WorkingDir: "{app}"
Name: "{group}\Atualizar PontoWebDesk"; Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\scripts\update-stack.ps1"" -InstallDir ""{app}"""; WorkingDir: "{app}"
Name: "{group}\Desinstalar {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{commondesktop}\{#MyAppName}"; Filename: "{app}\PontoWebDesk Local.url"; Tasks: desktopicon

[Run]
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\scripts\ensure-docker.ps1"" -InstallDir ""{app}"" -AllowInstall {code:DockerInstallFlag} -LogDir ""{#DataRoot}\logs"""; \
  StatusMsg: "Verificando Docker Desktop..."; Flags: runhidden waituntilterminated

Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\scripts\validate-ports.ps1"" -LogDir ""{#DataRoot}\logs"""; \
  StatusMsg: "Validando portas 3010 / 3000 / 5432..."; Flags: runhidden waituntilterminated

Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\scripts\install-runtime.ps1"" -InstallDir ""{app}"" -DataDir ""{#DataRoot}"" -LogDir ""{#DataRoot}\logs"""; \
  StatusMsg: "Preparando runtime e banco inicial..."; Flags: runhidden waituntilterminated

; Serviço aponta para bin\run-service.cmd gerado por install-runtime.ps1
Filename: "{app}\bin\nssm.exe"; Parameters: "install {#ServiceName} ""{app}\bin\run-service.cmd"""; Flags: runhidden waituntilterminated; StatusMsg: "Registrando serviço Windows..."
Filename: "{app}\bin\nssm.exe"; Parameters: "set {#ServiceName} AppDirectory ""{app}"""; Flags: runhidden waituntilterminated
Filename: "{app}\bin\nssm.exe"; Parameters: "set {#ServiceName} DisplayName ""PontoWebDesk Local"""; Flags: runhidden waituntilterminated
Filename: "{app}\bin\nssm.exe"; Parameters: "set {#ServiceName} Description ""Stack local PontoWebDesk (Docker Compose: frontend, API, PostgreSQL)"""; Flags: runhidden waituntilterminated
Filename: "{app}\bin\nssm.exe"; Parameters: "set {#ServiceName} Start SERVICE_AUTO_START"; Flags: runhidden waituntilterminated; Tasks: autostart
Filename: "{app}\bin\nssm.exe"; Parameters: "set {#ServiceName} Start SERVICE_DEMAND_START"; Flags: runhidden waituntilterminated; Tasks: not autostart
Filename: "{app}\bin\nssm.exe"; Parameters: "set {#ServiceName} AppStdout ""{#DataRoot}\logs\service-stdout.log"""; Flags: runhidden waituntilterminated
Filename: "{app}\bin\nssm.exe"; Parameters: "set {#ServiceName} AppStderr ""{#DataRoot}\logs\service-stderr.log"""; Flags: runhidden waituntilterminated
Filename: "{app}\bin\nssm.exe"; Parameters: "set {#ServiceName} AppRotateFiles 1"; Flags: runhidden waituntilterminated

Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\scripts\start-stack.ps1"" -InstallDir ""{app}"" -LogDir ""{#DataRoot}\logs"""; \
  StatusMsg: "Iniciando containers Docker..."; Flags: runhidden waituntilterminated

Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\scripts\open-browser.ps1"""; \
  StatusMsg: "Abrindo navegador..."; Flags: skipifsilent; Tasks: openbrowser

[UninstallRun]
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\scripts\uninstall-stack.ps1"" -InstallDir ""{app}"" -RemoveVolumes"; \
  Flags: runhidden waituntilterminated; RunOnceId: "StopStack"
Filename: "{app}\bin\nssm.exe"; Parameters: "stop {#ServiceName}"; Flags: runhidden waituntilterminated; RunOnceId: "StopSvc"
Filename: "{app}\bin\nssm.exe"; Parameters: "remove {#ServiceName} confirm"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveSvc"

[Code]
function DockerInstallFlag(Param: String): String;
begin
  if WizardIsTaskSelected('installdocker') then
    Result := '1'
  else
    Result := '0';
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and (not WizardSilent) then
  begin
    MsgBox(
      'Instalação concluída.' + #13#10 + #13#10 +
      'Aplicação: http://localhost:3010' + #13#10 +
      'API:        http://localhost:3000' + #13#10 + #13#10 +
      'Serviço Windows: PontoWebDeskLocal' + #13#10 +
      'Logs: %ProgramData%\PontoWebDesk\Local\logs' + #13#10 + #13#10 +
      'Se o Docker Desktop acabou de ser instalado, reinicie o Windows' + #13#10 +
      'e use o atalho "Iniciar PontoWebDesk".',
      mbInformation, MB_OK);
  end;
end;
