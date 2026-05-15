param(
  [string]$ServiceName = "PontoWebDeskRepAgent",
  [string]$InstallDir = "C:\PontoWebDeskAgent",
  [string]$NssmPath = "",
  [string]$EnvFilePath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-NssmPath {
  param([string]$ProvidedPath)
  if ($ProvidedPath -and (Test-Path $ProvidedPath)) {
    return (Resolve-Path $ProvidedPath).Path
  }
  $candidates = @(
    "C:\tools\nssm\nssm.exe",
    "C:\Program Files\nssm\nssm.exe",
    "C:\Program Files (x86)\nssm\nssm.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return $candidate }
  }
  $cmd = Get-Command nssm -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw "NSSM não encontrado. Informe -NssmPath ou instale nssm.exe."
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

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not (Test-Path $InstallDir)) {
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

Write-Host "[rep-agent] Copiando arquivos para $InstallDir ..." -ForegroundColor Cyan
$copyList = @(
  "package.json",
  "package-lock.json",
  "scripts\rep-agent.mjs",
  "scripts\rep-agent.env.example"
)
foreach ($item in $copyList) {
  $src = Join-Path $repoRoot $item
  if (-not (Test-Path $src)) {
    throw "Arquivo obrigatório ausente: $src"
  }
  $dst = Join-Path $InstallDir $item
  $dstDir = Split-Path -Parent $dst
  if (-not (Test-Path $dstDir)) {
    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
  }
  Copy-Item -Path $src -Destination $dst -Force
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
  throw "Arquivo de ambiente não encontrado: $EnvFilePath"
}

$nssm = Resolve-NssmPath -ProvidedPath $NssmPath
$node = Resolve-NodePath
$agentScript = Join-Path $InstallDir "scripts\rep-agent.mjs"

Write-Host "[rep-agent] Validando dependências npm no destino..." -ForegroundColor Cyan
Push-Location $InstallDir
try {
  npm ci --omit=dev | Out-Host
}
finally {
  Pop-Location
}

$envMap = Parse-EnvFile -Path $EnvFilePath
$envBlock = Build-EnvBlock -EnvMap $envMap

Write-Host "[rep-agent] Registrando serviço $ServiceName via NSSM..." -ForegroundColor Cyan
& $nssm remove $ServiceName confirm | Out-Null
& $nssm install $ServiceName $node $agentScript | Out-Null
& $nssm set $ServiceName AppDirectory $InstallDir | Out-Null
& $nssm set $ServiceName Start SERVICE_AUTO_START | Out-Null
& $nssm set $ServiceName AppExit Default Restart | Out-Null
& $nssm set $ServiceName AppEnvironmentExtra $envBlock | Out-Null
& $nssm set $ServiceName AppStdout (Join-Path $InstallDir "logs\rep-agent.log") | Out-Null
& $nssm set $ServiceName AppStderr (Join-Path $InstallDir "logs\rep-agent.err.log") | Out-Null
& $nssm set $ServiceName AppRotateFiles 1 | Out-Null
& $nssm set $ServiceName AppRotateOnline 1 | Out-Null
& $nssm set $ServiceName AppRotateSeconds 86400 | Out-Null
& $nssm set $ServiceName AppRotateBytes 10485760 | Out-Null

Write-Host "[rep-agent] Iniciando serviço..." -ForegroundColor Cyan
Start-Service -Name $ServiceName
Start-Sleep -Seconds 1
$svc = Get-Service -Name $ServiceName
Write-Host "[rep-agent] Serviço instalado com status: $($svc.Status)" -ForegroundColor Green
Write-Host "[rep-agent] Logs: $(Join-Path $InstallDir "logs")" -ForegroundColor Green
