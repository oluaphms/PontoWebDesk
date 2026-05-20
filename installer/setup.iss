; Inno Setup — Agente REP PontoWebDesk (produção)
; Instala rep-agent.exe + NSSM como serviço Windows PontoWebDeskAgent

#define MyAppName "PontoWebDesk REP Agent"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "PontoWebDesk"
#define MyAppURL "https://pontowebdesk.vercel.app"
#define ProgramDataPontoWeb "C:\ProgramData\PontoWebDesk"

#if !FileExists(AddBackslash(SourcePath) + "nssm.exe")
  #error "installer\nssm.exe ausente. Execute: powershell -File installer\download-nssm.ps1"
#endif
#if !FileExists(AddBackslash(SourcePath) + "..\dist\rep-agent.exe")
  #error "dist\rep-agent.exe ausente. Execute na raiz: npm run build:agent"
#endif

[Setup]
AppId={{F3A8D2E1-9C4B-4F6A-A1E2-8B7C5D4E3F21}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={pf}\PontoWebDesk
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=admin
OutputDir=dist-installer
OutputBaseFilename=pontowebdesk-rep-agent-exe-setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Dirs]
Name: "{commonappdata}\PontoWebDesk"; Permissions: users-modify
Name: "{commonappdata}\PontoWebDesk\logs"; Permissions: users-modify
Name: "{commonappdata}\PontoWebDesk\state"; Permissions: users-modify
Name: "{commonappdata}\PontoWebDesk\data"; Permissions: users-modify
Name: "{commonappdata}\PontoWebDesk\data\rep-agent"; Permissions: users-modify

[Files]
Source: "..\dist\rep-agent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "nssm.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "config.template.json"; DestDir: "{commonappdata}\PontoWebDesk"; DestName: "config.json"; Flags: onlyifdoesntexist uninsneveruninstall

[Run]
; Instalar serviço Windows via NSSM
Filename: "{app}\nssm.exe"; Parameters: "install PontoWebDeskAgent ""{app}\rep-agent.exe"""; Flags: runhidden waituntilterminated; StatusMsg: "Registrando serviço PontoWebDeskAgent..."
Filename: "{app}\nssm.exe"; Parameters: "set PontoWebDeskAgent Application ""{app}\rep-agent.exe"""; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set PontoWebDeskAgent AppDirectory ""{app}"""; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set PontoWebDeskAgent DisplayName ""PontoWebDesk REP Agent"""; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set PontoWebDeskAgent Description ""Agente local de coleta REP (relógio Control iD → SaaS PontoWebDesk)"""; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set PontoWebDeskAgent Start SERVICE_AUTO_START"; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set PontoWebDeskAgent AppStdout ""{commonappdata}\PontoWebDesk\logs\nssm-stdout.log"""; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set PontoWebDeskAgent AppStderr ""{commonappdata}\PontoWebDesk\logs\nssm-stderr.log"""; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "start PontoWebDeskAgent"; Flags: runhidden waituntilterminated; StatusMsg: "Iniciando serviço..."

[UninstallRun]
Filename: "{app}\nssm.exe"; Parameters: "stop PontoWebDeskAgent"; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "remove PontoWebDeskAgent confirm"; Flags: runhidden waituntilterminated

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    MsgBox(
      'Instalação concluída.' + #13#10 + #13#10 +
      '1. Edite o arquivo:' + #13#10 +
      '   C:\\ProgramData\\PontoWebDesk\\config.json' + #13#10 + #13#10 +
      '2. Preencha saas_url, api_key, device_id, company_id e device_ip.' + #13#10 + #13#10 +
      '3. Reinicie o serviço após salvar a configuração válida:' + #13#10 +
      '   nssm restart PontoWebDeskAgent' + #13#10 + #13#10 +
      'Logs: C:\\ProgramData\\PontoWebDesk\\logs\\agent.log',
      mbInformation,
      MB_OK
    );
  end;
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
end;
