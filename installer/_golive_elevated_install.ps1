$ErrorActionPreference = 'Continue'
$log = 'D:\PontoWebDesk_Local\installer\golive-run.log'
$setup = 'D:\PontoWebDesk_Local\installer\dist-installer\PontoWebDesk-Local-Setup.exe'
$setupLog = Join-Path $env:TEMP 'PontoWebDesk-Local-golive-setup.log'

Start-Transcript -Path $log -Force
Write-Host ('Elevated=' + ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))

Stop-Service postgresql-x64-18 -Force -ErrorAction SilentlyContinue
Start-Sleep 2
foreach ($port in 3010, 3000, 5432) {
  $x = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($x) { Write-Host "BUSY $port" } else { Write-Host "FREE $port" }
}

Write-Host "Starting Setup: $setup"
$args = "/VERYSILENT /NORESTART /SUPPRESSMSGBOXES /LOG=`"$setupLog`" /TASKS=autostart"
Write-Host "Args: $args"
$p = Start-Process -FilePath $setup -ArgumentList $args -Wait -PassThru
Write-Host "SetupExit=$($p.ExitCode)"

Write-Host '--- Post install ---'
Write-Host ('InstallDir=' + (Test-Path 'C:\Program Files\PontoWebDesk\Local'))
Write-Host ('Compose=' + (Test-Path 'C:\Program Files\PontoWebDesk\Local\runtime\docker-compose.yml'))
Write-Host ('Scripts=' + (Test-Path 'C:\Program Files\PontoWebDesk\Local\scripts\start-stack.ps1'))
Get-Service PontoWebDeskLocal -ErrorAction SilentlyContinue | Format-List Name, Status, StartType
Get-ChildItem 'C:\Program Files\PontoWebDesk\Local' -ErrorAction SilentlyContinue | Select-Object Name | Format-Table
$sm = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\PontoWebDesk Local"
Write-Host "StartMenu=$sm exists=$(Test-Path $sm)"
if (Test-Path $sm) { Get-ChildItem $sm | Select-Object Name | Format-Table }
Write-Host "SetupLogExists=$(Test-Path $setupLog)"
if (Test-Path $setupLog) { Get-Content $setupLog -Tail 50 }
$instLog = "$env:ProgramData\PontoWebDesk\Local\logs\installer.log"
Write-Host "InstallerLogExists=$(Test-Path $instLog)"
if (Test-Path $instLog) { Get-Content $instLog -Tail 80 }
Stop-Transcript
