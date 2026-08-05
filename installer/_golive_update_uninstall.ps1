$ErrorActionPreference = 'Continue'
$log = 'D:\PontoWebDesk_Local\installer\golive-update-uninstall.log'
Start-Transcript -Path $log -Force

$install = 'C:\Program Files\PontoWebDesk\Local'
$zip = 'D:\PontoWebDesk_Local\installer\updates\PontoWebDesk-Local-Update-1.0.0-rc.1.zip'

Write-Host '=== ETAPA11 UPDATE ==='
$updatesDir = Join-Path $install 'updates'
New-Item -ItemType Directory -Force -Path $updatesDir | Out-Null
Copy-Item -Force $zip $updatesDir
$beforeTables = docker exec pontowebdesk-saas-demo-postgres-1 psql -U postgres -d pontowebdesk -tAc 'SELECT count(*) FROM information_schema.tables WHERE table_schema=''public'';'
$beforeUsers = docker exec pontowebdesk-saas-demo-postgres-1 psql -U postgres -d pontowebdesk -tAc 'SELECT count(*) FROM users;'
Write-Host "BEFORE tables=$beforeTables users=$beforeUsers"

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $install 'scripts\update-stack.ps1') -InstallDir $install -UpdatePackage (Join-Path $updatesDir (Split-Path $zip -Leaf))
Write-Host "UPDATE_EXIT=$LASTEXITCODE"

$afterTables = docker exec pontowebdesk-saas-demo-postgres-1 psql -U postgres -d pontowebdesk -tAc 'SELECT count(*) FROM information_schema.tables WHERE table_schema=''public'';' 2>$null
$afterUsers = docker exec pontowebdesk-saas-demo-postgres-1 psql -U postgres -d pontowebdesk -tAc 'SELECT count(*) FROM users;' 2>$null
Write-Host "AFTER tables=$afterTables users=$afterUsers"
Get-ChildItem "$env:ProgramData\PontoWebDesk\Local\backups" -EA SilentlyContinue | Select-Object Name,LastWriteTime
docker ps --format 'table {{.Names}}\t{{.Status}}'

Write-Host '=== ETAPA12 UNINSTALL ==='
$unins = Join-Path $install 'unins000.exe'
if (Test-Path $unins) {
  $p = Start-Process -FilePath $unins -ArgumentList '/VERYSILENT','/NORESTART','/SUPPRESSMSGBOXES' -Wait -PassThru
  Write-Host "UNINSTALL_EXIT=$($p.ExitCode)"
} else {
  Write-Host 'UNINS_MISSING'
}

Start-Sleep 3
Write-Host ("InstallDirExists=" + (Test-Path $install))
Write-Host ("Service=" + ((Get-Service PontoWebDeskLocal -EA SilentlyContinue | Select-Object -ExpandProperty Status) -join ','))
Write-Host ("StartMenu=" + (Test-Path "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\PontoWebDesk Local"))
docker ps -a --filter name=pontowebdesk-saas-demo --format '{{.Names}} {{.Status}}'
docker volume ls --format '{{.Name}}' | Select-String 'saas_demo|pontowebdesk'

Stop-Transcript
