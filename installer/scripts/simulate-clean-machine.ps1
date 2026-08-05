# Simulação documental — máquina Windows limpa (FASE 5)
# Não executa instalação real; valida pré-condições do pacote.

$ErrorActionPreference = 'Continue'
$installer = Split-Path $PSScriptRoot -Parent
$root = Split-Path $installer -Parent
$report = Join-Path $installer 'CLEAN-MACHINE-SIMULATION.md'

$checks = @()

function Add-Check($name, $ok, $detail) {
  $script:checks += [pscustomobject]@{ Name = $name; OK = [bool]$ok; Detail = $detail }
}

Add-Check 'setup.iss' (Test-Path "$installer\setup.iss") 'Script Inno do produto Local'
Add-Check 'build-installer.bat' (Test-Path "$installer\build-installer.bat") 'Build do .exe'
Add-Check 'install-silent.bat' (Test-Path "$installer\install-silent.bat") 'Instalador silencioso'
Add-Check 'build-updater.bat' (Test-Path "$installer\build-updater.bat") 'Gerador de update ZIP'
Add-Check 'scripts\start-stack.ps1' (Test-Path "$installer\scripts\start-stack.ps1") 'Sobe containers'
Add-Check 'scripts\uninstall-stack.ps1' (Test-Path "$installer\scripts\uninstall-stack.ps1") 'Desinstalação stack'
Add-Check 'nssm.exe' (Test-Path "$installer\nssm.exe") 'Serviço Windows'
Add-Check 'DockerDesktopInstaller.exe' (Test-Path "$installer\prereqs\DockerDesktopInstaller.exe") 'OBRIGATÓRIO para Windows limpo sem Docker'
Add-Check 'staging\docker-compose.yml' (Test-Path "$installer\staging\docker-compose.yml") 'Payload (rode build-installer.bat)'
Add-Check 'Setup.exe gerado' (Test-Path "$installer\dist-installer\PontoWebDesk-Local-Setup.exe") 'Artefato final'
Add-Check 'ISCC instalado' (
  (Test-Path "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe") -or
  (Test-Path "$env:ProgramFiles\Inno Setup 6\ISCC.exe") -or
  (Test-Path "$env:LocalAppData\Programs\Inno Setup 6\ISCC.exe")
) 'Compilador Inno Setup 6 no host de build'

$demo = Join-Path $root 'PontoWebDesk-Demo\SaaS-Demo\docker-compose.yml'
$alt = Join-Path $root 'SaaS-Demo\docker-compose.yml'
Add-Check 'Fonte runtime Demo' ((Test-Path $demo) -or (Test-Path $alt)) 'PontoWebDesk-Demo/SaaS-Demo ou SaaS-Demo'

$hostHasNode = [bool](Get-Command node -ErrorAction SilentlyContinue)
$hostHasDocker = [bool](Get-Command docker -ErrorAction SilentlyContinue)
$hostHasGit = [bool](Get-Command git -ErrorAction SilentlyContinue)

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('# Simulação — Windows limpo')
[void]$sb.AppendLine('')
[void]$sb.AppendLine("Gerado: $(Get-Date -Format o)")
[void]$sb.AppendLine('')
[void]$sb.AppendLine('## Premissa do produto instalável')
[void]$sb.AppendLine('O .exe **não** embute Node/Git/VS. Em máquina limpa o runtime é **Docker Compose** (API + frontend + PostgreSQL).')
[void]$sb.AppendLine('Portanto Docker Desktop (ou Engine) é dependência de runtime — instalável pelo setup **somente se** `prereqs\DockerDesktopInstaller.exe` estiver no pacote.')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('## Checks do pacote')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('| Item | OK | Detalhe |')
[void]$sb.AppendLine('|------|----|---------|')
foreach ($c in $checks) {
  $mark = if ($c.OK) { 'YES' } else { 'NO' }
  [void]$sb.AppendLine("| $($c.Name) | $mark | $($c.Detail) |")
}
[void]$sb.AppendLine('')
[void]$sb.AppendLine('## Host atual (ambiente de build — não é a VM limpa)')
[void]$sb.AppendLine("- Node no PATH: $hostHasNode")
[void]$sb.AppendLine("- Docker no PATH: $hostHasDocker")
[void]$sb.AppendLine("- Git no PATH: $hostHasGit")
[void]$sb.AppendLine('')
[void]$sb.AppendLine('## Veredito simulado (Windows limpo sem Docker pré-instalado)')
$criticalMissing = @($checks | Where-Object { -not $_.OK -and $_.Name -match 'DockerDesktopInstaller|Setup\.exe|ISCC|staging|nssm|setup\.iss' })
if ($criticalMissing.Count -eq 0) {
  [void]$sb.AppendLine('**PASS conceitual** — pacote completo; o .exe pode deixar o SO operacional após instalar Docker (embutido) + compose up.')
} else {
  [void]$sb.AppendLine('**FAIL** — faltam itens críticos:')
  foreach ($m in $criticalMissing) { [void]$sb.AppendLine("- $($m.Name): $($m.Detail)") }
}

Set-Content -Path $report -Value $sb.ToString() -Encoding UTF8
Write-Host $sb.ToString()
Write-Host "Relatório: $report"
