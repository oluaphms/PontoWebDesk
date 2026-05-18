#define MyAppName "PontoWebDesk REP Agent"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "PontoWebDesk"
#define MyAppURL "https://pontowebdesk.vercel.app"
#define MyAppExeName "node.exe"

[Setup]
AppId={{B9E4EC97-3E64-4B47-A4FB-C5A54A9BA109}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName=C:\PontoWebDeskAgent
DisableProgramGroupPage=yes
PrivilegesRequired=admin
OutputDir=dist-installer
OutputBaseFilename=pontowebdesk-rep-agent-setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
UninstallDisplayIcon={app}\scripts\rep-agent.mjs

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
Source: "..\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\package-lock.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\scripts\rep-agent.mjs"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\scripts\rep-agent.env.example"; DestDir: "{app}\scripts"; Flags: ignoreversion onlyifdoesntexist
Source: "..\scripts\install-rep-agent-service.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\scripts\uninstall-rep-agent-service.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion

[Run]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\scripts\install-rep-agent-service.ps1"" -InstallDir ""{app}"" -ServiceName ""PontoWebDeskRepAgent"" -EnvFilePath ""{app}\scripts\rep-agent.env"""; Flags: runhidden waituntilterminated postinstall

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\scripts\uninstall-rep-agent-service.ps1"" -ServiceName ""PontoWebDeskRepAgent"""; Flags: runhidden

[Code]
var
  ConfigPage: TWizardPage;
  ImportModePage: TWizardPage;
  SummaryPage: TWizardPage;
  RadioImportToday: TRadioButton;
  RadioImportFromDate: TRadioButton;
  RadioImportFull: TRadioButton;
  InputImportFromDate: TNewEdit;
  RadioKeepCurrent: TRadioButton;
  RadioReconfigure: TRadioButton;
  ExistingEnvAtModePage: Boolean;
  InputBrand: TNewEdit;
  InputModel: TNewEdit;
  InputDeviceIp: TNewEdit;
  InputDeviceScheme: TNewComboBox;
  InputDevicePort: TNewEdit;
  InputCompanyId: TNewEdit;
  InputApiKey: TNewEdit;
  InputSaasUrl: TNewEdit;
  InputDeviceLogin: TNewEdit;
  InputDevicePassword: TNewEdit;
  CheckShowApiKey: TNewCheckBox;
  CheckShowDevicePassword: TNewCheckBox;
  InputTlsInsecure: TNewCheckBox;
  InputIntervalMs: TNewEdit;
  InputTimezone: TNewEdit;
  SummaryMemo: TNewMemo;

function GetSelectedEnvPath(): String;
begin
  Result := AddBackslash(WizardDirValue) + 'scripts\rep-agent.env';
end;

function EnvFileExistsInSelectedDir(): Boolean;
begin
  Result := FileExists(GetSelectedEnvPath());
end;

function ShouldReconfigure(): Boolean;
begin
  Result := (not ExistingEnvAtModePage) or RadioReconfigure.Checked;
end;

function MaskSecret(const Value: String): String;
var
  L: Integer;
begin
  L := Length(Trim(Value));
  if L = 0 then
  begin
    Result := '(vazio)';
    exit;
  end;
  if L <= 6 then
  begin
    Result := '******';
    exit;
  end;
  Result := Copy(Value, 1, 3) + '***' + Copy(Value, L - 2, 3);
end;

function YesNo(const B: Boolean): String;
begin
  if B then Result := 'Sim' else Result := 'Não';
end;

function BuildSummaryText(): String;
var
  ModeText: String;
  EnvExistsText: String;
begin
  if ShouldReconfigure() then
    ModeText := 'Reconfigurar equipamento'
  else
    ModeText := 'Manter configuração atual';

  EnvExistsText := YesNo(EnvFileExistsInSelectedDir());

  Result :=
    'Resumo da instalação:' + #13#10 + #13#10 +
    'Diretório: ' + WizardDirValue + #13#10 +
    'Arquivo atual rep-agent.env existe: ' + EnvExistsText + #13#10 +
    'Modo selecionado: ' + ModeText + #13#10 + #13#10;

  if ShouldReconfigure() then
  begin
    Result := Result +
      'Marca: ' + Trim(InputBrand.Text) + #13#10 +
      'Modelo: ' + Trim(InputModel.Text) + #13#10 +
      'IP do relógio: ' + Trim(InputDeviceIp.Text) + #13#10 +
      'Protocolo/porta: ' + Lowercase(InputDeviceScheme.Text) + ':' + Trim(InputDevicePort.Text) + #13#10 +
      'SaaS URL: ' + Trim(InputSaasUrl.Text) + #13#10 +
      'Company ID: ' + Trim(InputCompanyId.Text) + #13#10 +
      'API Key: ' + MaskSecret(Trim(InputApiKey.Text)) + #13#10 +
      'Login relógio: ' + Trim(InputDeviceLogin.Text) + #13#10 +
      'Senha relógio: ' + MaskSecret(Trim(InputDevicePassword.Text)) + #13#10 +
      'TLS self-signed: ' + YesNo(InputTlsInsecure.Checked) + #13#10 +
      'Intervalo de coleta (ms): ' + Trim(InputIntervalMs.Text) + #13#10 +
      'Timezone offset: ' + Trim(InputTimezone.Text) + #13#10 + #13#10 +
      'Ao clicar em Instalar, o setup salvará rep-agent.env e instalará o serviço PontoWebDeskRepAgent.'
  end
  else
  begin
    Result := Result +
      'A configuração existente será preservada.' + #13#10 +
      'O setup atualizará arquivos do agente e reinstalará/iniciará o serviço PontoWebDeskRepAgent.';
  end;
end;

function IsNodeInstalled(): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec('where', 'node', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;

procedure AddLabeledEdit(const ACaption: String; var AEdit: TNewEdit; const ADefault: String; var TopPos: Integer; const IsPassword: Boolean);
var
  LabelCtrl: TNewStaticText;
begin
  LabelCtrl := TNewStaticText.Create(ConfigPage.Surface);
  LabelCtrl.Parent := ConfigPage.Surface;
  LabelCtrl.Left := ScaleX(0);
  LabelCtrl.Top := TopPos;
  LabelCtrl.Width := ScaleX(540);
  LabelCtrl.Caption := ACaption;

  AEdit := TNewEdit.Create(ConfigPage.Surface);
  AEdit.Parent := ConfigPage.Surface;
  AEdit.Left := ScaleX(0);
  AEdit.Top := TopPos + ScaleY(18);
  AEdit.Width := ScaleX(540);
  AEdit.Text := ADefault;
  if IsPassword then
    AEdit.PasswordChar := '*';

  TopPos := TopPos + ScaleY(48);
end;

procedure ToggleSecretsVisibility(Sender: TObject);
begin
  if CheckShowApiKey.Checked then
    InputApiKey.PasswordChar := #0
  else
    InputApiKey.PasswordChar := '*';

  if CheckShowDevicePassword.Checked then
    InputDevicePassword.PasswordChar := #0
  else
    InputDevicePassword.PasswordChar := '*';
end;

procedure InitializeWizard();
var
  TopPos: Integer;
  LabelCtrl: TNewStaticText;
  ModeLabel: TNewStaticText;
begin
  ModePage := CreateCustomPage(
    wpSelectDir,
    'Configuração da instalação',
    'Escolha se deseja manter a configuração atual do relógio ou reconfigurar os dados.'
  );

  ModeLabel := TNewStaticText.Create(ModePage.Surface);
  ModeLabel.Parent := ModePage.Surface;
  ModeLabel.Left := ScaleX(0);
  ModeLabel.Top := ScaleY(0);
  ModeLabel.Width := ScaleX(540);
  ModeLabel.Caption :=
    'Se já existir o arquivo rep-agent.env, você pode manter a configuração atual e evitar retrabalho do técnico.';

  RadioKeepCurrent := TRadioButton.Create(ModePage.Surface);
  RadioKeepCurrent.Parent := ModePage.Surface;
  RadioKeepCurrent.Left := ScaleX(0);
  RadioKeepCurrent.Top := ScaleY(44);
  RadioKeepCurrent.Width := ScaleX(540);
  RadioKeepCurrent.Caption := 'Manter configuração atual (recomendado em atualização)';
  RadioKeepCurrent.Checked := True;

  RadioReconfigure := TRadioButton.Create(ModePage.Surface);
  RadioReconfigure.Parent := ModePage.Surface;
  RadioReconfigure.Left := ScaleX(0);
  RadioReconfigure.Top := ScaleY(70);
  RadioReconfigure.Width := ScaleX(540);
  RadioReconfigure.Caption := 'Reconfigurar equipamento (IP, modelo, chave, etc.)';

  ConfigPage := CreateCustomPage(
    ModePage.ID,
    'Configuração do relógio REP',
    'Preencha os dados do cliente. O instalador criará e aplicará a configuração automaticamente.'
  );

  TopPos := ScaleY(0);
  AddLabeledEdit('Marca do relógio (ex.: Control iD)', InputBrand, 'Control iD', TopPos, False);
  AddLabeledEdit('Modelo do relógio (ex.: iDClass)', InputModel, 'iDClass', TopPos, False);
  AddLabeledEdit('IP do relógio', InputDeviceIp, '192.168.1.19', TopPos, False);

  LabelCtrl := TNewStaticText.Create(ConfigPage.Surface);
  LabelCtrl.Parent := ConfigPage.Surface;
  LabelCtrl.Left := ScaleX(0);
  LabelCtrl.Top := TopPos;
  LabelCtrl.Width := ScaleX(240);
  LabelCtrl.Caption := 'Protocolo do relógio';

  InputDeviceScheme := TNewComboBox.Create(ConfigPage.Surface);
  InputDeviceScheme.Parent := ConfigPage.Surface;
  InputDeviceScheme.Left := ScaleX(0);
  InputDeviceScheme.Top := TopPos + ScaleY(18);
  InputDeviceScheme.Width := ScaleX(180);
  InputDeviceScheme.Style := csDropDownList;
  InputDeviceScheme.Items.Add('http');
  InputDeviceScheme.Items.Add('https');
  InputDeviceScheme.ItemIndex := 1;

  LabelCtrl := TNewStaticText.Create(ConfigPage.Surface);
  LabelCtrl.Parent := ConfigPage.Surface;
  LabelCtrl.Left := ScaleX(220);
  LabelCtrl.Top := TopPos;
  LabelCtrl.Width := ScaleX(120);
  LabelCtrl.Caption := 'Porta';

  InputDevicePort := TNewEdit.Create(ConfigPage.Surface);
  InputDevicePort.Parent := ConfigPage.Surface;
  InputDevicePort.Left := ScaleX(220);
  InputDevicePort.Top := TopPos + ScaleY(18);
  InputDevicePort.Width := ScaleX(120);
  InputDevicePort.Text := '443';
  TopPos := TopPos + ScaleY(48);

  AddLabeledEdit('URL do SaaS (sem barra final)', InputSaasUrl, 'https://pontowebdesk.vercel.app', TopPos, False);
  AddLabeledEdit('Company ID (UUID)', InputCompanyId, '', TopPos, False);
  AddLabeledEdit('API Key do backend', InputApiKey, '', TopPos, True);
  CheckShowApiKey := TNewCheckBox.Create(ConfigPage.Surface);
  CheckShowApiKey.Parent := ConfigPage.Surface;
  CheckShowApiKey.Left := ScaleX(0);
  CheckShowApiKey.Top := TopPos - ScaleY(10);
  CheckShowApiKey.Width := ScaleX(280);
  CheckShowApiKey.Caption := 'Mostrar API Key';
  CheckShowApiKey.Checked := False;
  CheckShowApiKey.OnClick := @ToggleSecretsVisibility;
  TopPos := TopPos + ScaleY(18);

  AddLabeledEdit('Login do relógio', InputDeviceLogin, 'admin', TopPos, False);
  AddLabeledEdit('Senha do relógio', InputDevicePassword, '', TopPos, True);
  CheckShowDevicePassword := TNewCheckBox.Create(ConfigPage.Surface);
  CheckShowDevicePassword.Parent := ConfigPage.Surface;
  CheckShowDevicePassword.Left := ScaleX(0);
  CheckShowDevicePassword.Top := TopPos - ScaleY(10);
  CheckShowDevicePassword.Width := ScaleX(320);
  CheckShowDevicePassword.Caption := 'Mostrar senha do relógio';
  CheckShowDevicePassword.Checked := False;
  CheckShowDevicePassword.OnClick := @ToggleSecretsVisibility;
  TopPos := TopPos + ScaleY(18);

  AddLabeledEdit('Intervalo de coleta (ms)', InputIntervalMs, '60000', TopPos, False);
  AddLabeledEdit('Timezone offset (ex.: -03:00)', InputTimezone, '-03:00', TopPos, False);

  InputTlsInsecure := TNewCheckBox.Create(ConfigPage.Surface);
  InputTlsInsecure.Parent := ConfigPage.Surface;
  InputTlsInsecure.Left := ScaleX(0);
  InputTlsInsecure.Top := TopPos + ScaleY(2);
  InputTlsInsecure.Width := ScaleX(540);
  InputTlsInsecure.Checked := True;
  InputTlsInsecure.Caption := 'Aceitar certificado TLS self-signed do relógio (uso em rede interna)';
  ToggleSecretsVisibility(nil);

  ImportModePage := CreateCustomPage(
    ConfigPage.ID,
    'Modo de importação inicial',
    'Na primeira execução o agente usa modo seguro automaticamente. Esta escolha vale se você forçar importação manual (REP_FORCE_MODE).'
  );

  LabelCtrl := TNewStaticText.Create(ImportModePage.Surface);
  LabelCtrl.Parent := ImportModePage.Surface;
  LabelCtrl.Left := ScaleX(0);
  LabelCtrl.Top := ScaleY(0);
  LabelCtrl.Width := ScaleX(540);
  LabelCtrl.Caption := 'Recomendado para go-live: deixar o agente auto-configurar (apenas hoje na 1ª sync).';

  RadioImportToday := TRadioButton.Create(ImportModePage.Surface);
  RadioImportToday.Parent := ImportModePage.Surface;
  RadioImportToday.Left := ScaleX(0);
  RadioImportToday.Top := ScaleY(40);
  RadioImportToday.Width := ScaleX(540);
  RadioImportToday.Caption := 'Apenas registros de hoje na 1ª execução (recomendado — automático)';
  RadioImportToday.Checked := True;

  RadioImportFromDate := TRadioButton.Create(ImportModePage.Surface);
  RadioImportFromDate.Parent := ImportModePage.Surface;
  RadioImportFromDate.Left := ScaleX(0);
  RadioImportFromDate.Top := ScaleY(66);
  RadioImportFromDate.Width := ScaleX(540);
  RadioImportFromDate.Caption := 'A partir de uma data específica (avançado — REP_FORCE_MODE)';

  InputImportFromDate := TNewEdit.Create(ImportModePage.Surface);
  InputImportFromDate.Parent := ImportModePage.Surface;
  InputImportFromDate.Left := ScaleX(24);
  InputImportFromDate.Top := ScaleY(92);
  InputImportFromDate.Width := ScaleX(160);
  InputImportFromDate.Text := '2026-05-18';

  RadioImportFull := TRadioButton.Create(ImportModePage.Surface);
  RadioImportFull.Parent := ImportModePage.Surface;
  RadioImportFull.Left := ScaleX(0);
  RadioImportFull.Top := ScaleY(124);
  RadioImportFull.Width := ScaleX(540);
  RadioImportFull.Caption := 'Completo / incremental sem corte (não recomendado — pode importar histórico)';

  SummaryPage := CreateCustomPage(
    ImportModePage.ID,
    'Resumo final',
    'Confira os dados antes de instalar.'
  );

  SummaryMemo := TNewMemo.Create(SummaryPage.Surface);
  SummaryMemo.Parent := SummaryPage.Surface;
  SummaryMemo.Left := ScaleX(0);
  SummaryMemo.Top := ScaleY(0);
  SummaryMemo.Width := ScaleX(540);
  SummaryMemo.Height := ScaleY(260);
  SummaryMemo.ReadOnly := True;
  SummaryMemo.WantReturns := True;
  SummaryMemo.WantTabs := False;
  SummaryMemo.ScrollBars := ssVertical;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;

  if CurPageID = ModePage.ID then
  begin
    ExistingEnvAtModePage := EnvFileExistsInSelectedDir();
    if ExistingEnvAtModePage then
    begin
      RadioKeepCurrent.Enabled := True;
      if (not RadioKeepCurrent.Checked) and (not RadioReconfigure.Checked) then
        RadioKeepCurrent.Checked := True;
    end
    else
    begin
      RadioKeepCurrent.Checked := False;
      RadioKeepCurrent.Enabled := False;
      RadioKeepCurrent.Caption := 'Manter configuração atual (indisponível: rep-agent.env não encontrado)';
      RadioReconfigure.Checked := True;
    end;

  end;

  if CurPageID = ConfigPage.ID then
  begin
    if not ShouldReconfigure() then
      exit;

    if Trim(InputDeviceIp.Text) = '' then
    begin
      MsgBox('Informe o IP do relógio.', mbError, MB_OK);
      Result := False;
      exit;
    end;
    if Trim(InputCompanyId.Text) = '' then
    begin
      MsgBox('Informe o Company ID (UUID).', mbError, MB_OK);
      Result := False;
      exit;
    end;
    if Trim(InputApiKey.Text) = '' then
    begin
      MsgBox('Informe a API Key.', mbError, MB_OK);
      Result := False;
      exit;
    end;
    if Trim(InputSaasUrl.Text) = '' then
    begin
      MsgBox('Informe a URL do SaaS.', mbError, MB_OK);
      Result := False;
      exit;
    end;
  end;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if (PageID = ConfigPage.ID) or (PageID = ImportModePage.ID) then
    Result := not ShouldReconfigure();
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = SummaryPage.ID then
  begin
    SummaryMemo.Text := BuildSummaryText();
  end;
end;

procedure SaveAgentEnv();
var
  EnvPath: String;
  TlsFlag: String;
  SchemeValue: String;
begin
  EnvPath := GetSelectedEnvPath();
  if (not ShouldReconfigure()) and FileExists(EnvPath) then
    exit;

  if InputTlsInsecure.Checked then TlsFlag := '1' else TlsFlag := '0';
  SchemeValue := InputDeviceScheme.Text;
  if Trim(SchemeValue) = '' then SchemeValue := 'https';

  SaveStringToFile(EnvPath, 'REP_AGENT_SKIP_DOTENV=1' + #13#10, False);
  SaveStringToFile(EnvPath, 'REP_SAAS_URL=' + Trim(InputSaasUrl.Text) + #13#10, True);
  SaveStringToFile(EnvPath, 'API_KEY=' + Trim(InputApiKey.Text) + #13#10, True);
  SaveStringToFile(EnvPath, 'REP_DEVICE_IP=' + Trim(InputDeviceIp.Text) + #13#10, True);
  SaveStringToFile(EnvPath, 'REP_DEVICE_SCHEME=' + Lowercase(SchemeValue) + #13#10, True);
  SaveStringToFile(EnvPath, 'REP_DEVICE_PORT=' + Trim(InputDevicePort.Text) + #13#10, True);
  SaveStringToFile(EnvPath, 'REP_INSECURE_TLS=' + TlsFlag + #13#10, True);
  SaveStringToFile(EnvPath, 'REP_COMPANY_ID=' + Trim(InputCompanyId.Text) + #13#10, True);
  SaveStringToFile(EnvPath, 'REP_DEVICE_LOGIN=' + Trim(InputDeviceLogin.Text) + #13#10, True);
  SaveStringToFile(EnvPath, 'REP_DEVICE_PASSWORD=' + Trim(InputDevicePassword.Text) + #13#10, True);
  SaveStringToFile(EnvPath, 'REP_AGENT_LOOP=1' + #13#10, True);
  SaveStringToFile(EnvPath, 'REP_AGENT_INTERVAL_MS=' + Trim(InputIntervalMs.Text) + #13#10, True);
  SaveStringToFile(EnvPath, 'REP_DEVICE_TIMEZONE_OFFSET=' + Trim(InputTimezone.Text) + #13#10, True);
  SaveStringToFile(EnvPath, '# Campos de inventário (não usados na lógica de coleta):' + #13#10, True);
  SaveStringToFile(EnvPath, 'REP_DEVICE_BRAND=' + Trim(InputBrand.Text) + #13#10, True);
  SaveStringToFile(EnvPath, 'REP_DEVICE_MODEL=' + Trim(InputModel.Text) + #13#10, True);

  if RadioImportFromDate.Checked then
  begin
    SaveStringToFile(EnvPath, 'REP_FORCE_MODE=1' + #13#10, True);
    SaveStringToFile(EnvPath, 'REP_RECEIVE_SCOPE=incremental' + #13#10, True);
    SaveStringToFile(EnvPath, 'REP_INGEST_FROM_DATE=' + Trim(InputImportFromDate.Text) + #13#10, True);
  end
  else if RadioImportFull.Checked then
  begin
    SaveStringToFile(EnvPath, 'REP_FORCE_MODE=1' + #13#10, True);
    SaveStringToFile(EnvPath, 'REP_RECEIVE_SCOPE=incremental' + #13#10, True);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    SaveAgentEnv();
  end;
end;

function InitializeSetup(): Boolean;
begin
  if not IsNodeInstalled() then
  begin
    MsgBox(
      'Node.js não encontrado no PATH. Instale Node 20+ antes de continuar.',
      mbCriticalError,
      MB_OK
    );
    Result := False;
    exit;
  end;
  Result := True;
end;
