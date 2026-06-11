param(
  [string]$ServiceName = "PontoWebDeskRepAgent",
  [string]$InstallDir = "C:\PontoWebDeskAgent",
  [string]$NssmPath = "",
  [string]$EnvFilePath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
  throw "Execute o instalador ou este script como Administrador (necessario para registrar o servico Windows)."
}

function Write-RepAgentLog {
  param(
    [string]$Message,
    [ConsoleColor]$Color = [ConsoleColor]::Cyan
  )
  Write-Host ('[rep-agent] ' + $Message) -ForegroundColor $Color
}

function Resolve-NssmPath {
  param(
    [string]$ProvidedPath,
    [string]$InstallDir
  )
  if ($ProvidedPath -and (Test-Path $ProvidedPath)) {
    return (Resolve-Path $ProvidedPath).Path
  }
  $candidates = @(
    $(if ($InstallDir) { Join-Path $InstallDir "nssm.exe" } else { $null }),
    "C:\tools\nssm\nssm.exe",
    "C:\Program Files\nssm\nssm.exe",
    "C:\Program Files (x86)\nssm\nssm.exe"
  ) | Where-Object { $_ -and (Test-Path $_) }
  foreach ($candidate in $candidates) {
    return (Resolve-Path $candidate).Path
  }
  $cmd = Get-Command nssm -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw "NSSM não encontrado. Informe -NssmPath, copie nssm.exe para $InstallDir ou instale NSSM no PATH."
}

function Resolve-NodePath {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "Node.js não encontrado no PATH. Instale Node 20+ antes de continuar."
  }
  return $cmd.Source
}

function Parse-EnvFile {
  param([string]$Path)
  $map = New-Object 'System.Collections.Generic.Dictionary[string,string]'
  foreach ($line in (Get-Content -Path $Path)) {
    $trim = $line.Trim()
    if (-not $trim) { continue }
    if ($trim.StartsWith("#")) { continue }
    $eq = $trim.IndexOf("=")
    if ($eq -lt 1) { continue }
    $k = $trim.Substring(0, $eq).Trim()
    $v = $trim.Substring($eq + 1).Trim()
    $map[$k] = $v
  }
  return $map
}

function Build-EnvBlock {
  param([System.Collections.Generic.Dictionary[string,string]]$EnvMap)
  $pairs = @()
  foreach ($key in $EnvMap.Keys | Sort-Object) {
    $pairs += "$key=$($EnvMap[$key])"
  }
  return ($pairs -join "`n")
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Split-Path -Parent $scriptDir)).Path
if (-not (Test-Path -LiteralPath $InstallDir)) {
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}
$InstallDir = (Resolve-Path -LiteralPath $InstallDir).Path

$copyList = @(
  "package.json",
  "scripts\rep-agent.mjs",
  "scripts\rep-agent-bootstrap.mjs",
  "scripts\rep-agent-config.mjs",
  "scripts\rep-agent-paths.mjs",
  "scripts\rep-agent-logger.mjs",
  "scripts\rep-agent-go-live.mjs",
  "scripts\rep-agent-startup.mjs",
  "scripts\rep-agent-queue.mjs",
  "scripts\rep-agent-db.mjs",
  "scripts\rep-agent-commands-state.mjs",
  "scripts\rep-agent-structured-log.mjs",
  "scripts\rep-punch-hash.mjs",
  "scripts\configure-rep-agent-nssm.ps1",
  "scripts\rep-agent.env.example"
)

if ($repoRoot.TrimEnd('\') -ieq $InstallDir.TrimEnd('\')) {
  Write-RepAgentLog 'Instalacao in-place: arquivos ja estao em ' + $InstallDir + ' (pulando copia).' -Color DarkGray
} else {
  Write-RepAgentLog "Copiando arquivos de $repoRoot para $InstallDir ..."
  foreach ($item in $copyList) {
    $src = (Resolve-Path -LiteralPath (Join-Path $repoRoot $item)).Path
    $dst = Join-Path $InstallDir $item
    $dstDir = Split-Path -Parent $dst
    if (-not (Test-Path $dstDir)) {
      New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
    }
    $dstResolved = $null
    if (Test-Path -LiteralPath $dst) {
      $dstResolved = (Resolve-Path -LiteralPath $dst).Path
    }
    if ($dstResolved -and ($dstResolved -ieq $src)) {
      continue
    }
    Copy-Item -Path $src -Destination $dst -Force
  }
  $agentPackageTemplate = Join-Path $repoRoot "installer\agent-package.json"
  if (Test-Path $agentPackageTemplate) {
    Copy-Item -Path $agentPackageTemplate -Destination (Join-Path $InstallDir "package.json") -Force
  }
}

if (-not $EnvFilePath) {
  $localEnv = Join-Path $repoRoot "scripts\rep-agent.env"
  if (Test-Path $localEnv) {
    $EnvFilePath = $localEnv
  } else {
    $EnvFilePath = Join-Path $InstallDir "scripts\rep-agent.env.example"
  }
}
if (-not (Test-Path $EnvFilePath)) {
  throw @"
Arquivo de ambiente não encontrado: $EnvFilePath
Reexecute o instalador e escolha 'Reconfigurar equipamento', ou copie scripts\rep-agent.env.example para scripts\rep-agent.env e preencha os valores.
"@
}

$logsDir = Join-Path $InstallDir "logs"
if (-not (Test-Path $logsDir)) {
  New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}

$nssm = Resolve-NssmPath -ProvidedPath $NssmPath -InstallDir $InstallDir
$node = Resolve-NodePath
$agentScript = Join-Path $InstallDir "scripts\rep-agent.mjs"

if (-not (Test-Path (Join-Path $InstallDir "node_modules\dotenv"))) {
  Write-RepAgentLog 'Instalando dependencia dotenv (primeira vez)...'
  Push-Location $InstallDir
  try {
    if (Test-Path (Join-Path $InstallDir "package-lock.json")) {
      Remove-Item (Join-Path $InstallDir "package-lock.json") -Force -ErrorAction SilentlyContinue
    }
    npm install --omit=dev --no-audit --no-fund 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) {
      throw "npm install falhou com codigo $LASTEXITCODE. Verifique rede e Node.js 20+."
    }
  }
  finally {
    Pop-Location
  }
} else {
  Write-RepAgentLog 'node_modules ja presente - pulando npm install.' -Color DarkGray
}

$envMap = Parse-EnvFile -Path $EnvFilePath
$envBlock = Build-EnvBlock -EnvMap $envMap

Write-RepAgentLog "Registrando servico $ServiceName via NSSM..."
& $nssm stop $ServiceName 2>$null | Out-Null
& $nssm remove $ServiceName confirm 2>$null | Out-Null
$installOut = & $nssm install $ServiceName $node $agentScript 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "nssm install falhou: $($installOut -join ' ')"
}
& $nssm set $ServiceName AppDirectory $InstallDir | Out-Null
& $nssm set $ServiceName AppEnvironmentExtra $envBlock | Out-Null
& $nssm set $ServiceName AppStdout (Join-Path $InstallDir "logs\rep-agent.log") | Out-Null
& $nssm set $ServiceName AppStderr (Join-Path $InstallDir "logs\rep-agent.err.log") | Out-Null

$configureNssm = Join-Path $scriptDir "configure-rep-agent-nssm.ps1"
if (-not (Test-Path $configureNssm)) {
  $configureNssm = Join-Path $InstallDir "scripts\configure-rep-agent-nssm.ps1"
}
if (Test-Path $configureNssm) {
  & powershell.exe -ExecutionPolicy Bypass -NoProfile -File $configureNssm `
    -ServiceName $ServiceName `
    -NssmPath $nssm `
    -LogDir (Join-Path $InstallDir "logs")
} else {
  Write-RepAgentLog 'AVISO: configure-rep-agent-nssm.ps1 ausente — recovery/rede não aplicados.' -Color Yellow
  & $nssm set $ServiceName Start SERVICE_AUTO_START | Out-Null
  & $nssm set $ServiceName AppExit Default Restart | Out-Null
}

Write-RepAgentLog 'Iniciando servico...'
try {
  Start-Service -Name $ServiceName -ErrorAction Stop
  Start-Sleep -Seconds 1
  $svc = Get-Service -Name $ServiceName
  Write-RepAgentLog "Servico instalado com status: $($svc.Status)" -Color Green
} catch {
  throw "Servico registrado, mas nao iniciou: $($_.Exception.Message). Verifique rep-agent.env e logs em $(Join-Path $InstallDir 'logs')."
}
Write-RepAgentLog ('Logs: ' + (Join-Path $InstallDir 'logs')) -Color Green
