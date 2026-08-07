; Inno Setup — PontoWebDesk Professional (RC2.4.3)
; Gera: dist-installer\Setup.exe
;
; Runtime exclusivamente de: npm run stage:rc2 → dist-installer\PontoWebDesk-Professional\
; Build: scripts\build-professional-installer.bat
;
; Silencioso / log (Inno Setup):
;   Setup.exe /SILENT /NORESTART /LOG="%TEMP%\pwd-professional-setup.log"
;   Setup.exe /VERYSILENT /NORESTART /LOG="..."
; Log da instalacao (Bootstrap + Setup): %ProgramData%\PontoWebDesk\Logs\installer.log

#define MyAppName "PontoWebDesk Professional"
#define MyAppPublisher "PontoWebDesk"
#define MyAppURL "https://pontowebdesk.vercel.app"
#define MyAppId "{{B3E8F2A1-9C4D-4E7B-8F21-A1B2C3D4E5F6}}"
#define DataRoot "{commonappdata}\PontoWebDesk"
#define StagingDir AddBackslash(SourcePath) + "..\dist-installer\PontoWebDesk-Professional"
#define StagingManifest StagingDir + "\layout.manifest.json"

#include "rc2-staging-version.inc"

#if !FileExists(StagingManifest)
  #error "Staging RC2 ausente. Execute: npm run stage:rc2 (e npm run verify:rc2) antes do ISCC."
#endif

#if !FileExists(AddBackslash(SourcePath) + "scripts\professional-install.ps1")
  #error "installer\scripts\professional-install.ps1 ausente."
#endif

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={commonpf}\PontoWebDesk
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=no
AllowNoIcons=yes
PrivilegesRequired=admin
OutputDir=..\dist-installer
OutputBaseFilename=Setup
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
LicenseFile=LICENSE-PRODUCT.txt
; SignTool=signtool $p /fd SHA256 /f "$env{PWD_CODESIGN_PFX}" /p "$env{PWD_CODESIGN_PASSWORD}" /tr http://timestamp.digicert.com /td SHA256
; SignedUninstaller=yes

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na Area de Trabalho"; GroupDescription: "Atalhos:"; Flags: unchecked
Name: "openbrowser"; Description: "Abrir o sistema no navegador ao concluir"; GroupDescription: "Pos-instalacao:"; Flags: checkedonce

[Dirs]
Name: "{app}"; Permissions: users-modify
Name: "{#DataRoot}"
Name: "{#DataRoot}\Config"
Name: "{#DataRoot}\Logs"
Name: "{#DataRoot}\Storage"
Name: "{#DataRoot}\Backups"
Name: "{#DataRoot}\Database\pgdata"

[Files]
Source: "{#StagingDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "scripts\professional-*.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "assets\codesign.placeholder.txt"; DestDir: "{app}\docs"; DestName: "codesign.placeholder.txt"; Flags: ignoreversion
Source: "LICENSE-PRODUCT.txt"; DestDir: "{app}"; DestName: "LICENSE.txt"; Flags: ignoreversion skipifsourcedoesntexist

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{code:GetAppUrl}"; IconFilename: "{sys}\shell32.dll"; IconIndex: 13
Name: "{group}\Abrir PontoWebDesk"; Filename: "{code:GetAppUrl}"
Name: "{group}\Logs (installer.log)"; Filename: "{#DataRoot}\Logs\installer.log"
Name: "{group}\Desinstalar {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{commondesktop}\{#MyAppName}"; Filename: "{code:GetAppUrl}"; Tasks: desktopicon

[Run]
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\scripts\professional-install.ps1"" -InstallDir ""{app}"" -ProgramDataDir ""{#DataRoot}"" -LogFile ""{#DataRoot}\Logs\installer.log"" {code:SilentFlags} {code:BrowserFlag}"; \
  StatusMsg: "Configurando PostgreSQL, API e Bootstrap..."; \
  Flags: runhidden waituntilterminated

[UninstallRun]
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\scripts\professional-uninstall.ps1"" -InstallDir ""{app}"" -ProgramDataDir ""{#DataRoot}"" -LogFile ""{#DataRoot}\Logs\installer.log"""; \
  Flags: runhidden waituntilterminated; RunOnceId: "Rc2ProUninstall"

[Code]
function GetAppUrl(Param: String): String;
begin
  Result := 'http://127.0.0.1:3010/';
end;

function SilentFlags(Param: String): String;
begin
  if WizardSilent then
    Result := '-Silent'
  else
    Result := '';
end;

function BrowserFlag(Param: String): String;
begin
  if WizardSilent then
    Result := ''
  else if WizardIsTaskSelected('openbrowser') then
    Result := '-OpenBrowser'
  else
    Result := '';
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssInstall) and (not DirExists(ExpandConstant('{#DataRoot}\Logs'))) then
  begin
    ForceDirectories(ExpandConstant('{#DataRoot}\Logs'));
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    if DirExists(ExpandConstant('{#DataRoot}')) then
      MsgBox(
        'ProgramData pode conter dados do banco e configuracao.' + #13#10 +
        'Se desejar remover manualmente: ' + ExpandConstant('{#DataRoot}'),
        mbInformation, MB_OK);
  end;
end;

[Messages]
SetupAppTitle=Instalar {#MyAppName}
SetupWindowTitle=Instalar {#MyAppName}
