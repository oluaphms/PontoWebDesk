param(
  [string]$ServiceName = "PontoWebDeskRepAgent",
  [string]$NssmPath = "",
  [string]$InstallDir = "C:\PontoWebDeskAgent",
  [switch]$RemoveFiles
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
  throw "NSSM não encontrado. Informe -NssmPath."
}

$nssm = Resolve-NssmPath -ProvidedPath $NssmPath

Write-Host "[rep-agent] Removendo serviço $ServiceName ..." -ForegroundColor Cyan
try {
  Stop-Service -Name $ServiceName -ErrorAction SilentlyContinue
} catch {}

& $nssm remove $ServiceName confirm | Out-Null
Write-Host "[rep-agent] Serviço removido." -ForegroundColor Green

if ($RemoveFiles) {
  if (Test-Path $InstallDir) {
    Write-Host "[rep-agent] Removendo arquivos em $InstallDir ..." -ForegroundColor Cyan
    Remove-Item -Path $InstallDir -Recurse -Force
    Write-Host "[rep-agent] Diretório removido." -ForegroundColor Green
  } else {
    Write-Host "[rep-agent] Diretório não encontrado: $InstallDir" -ForegroundColor Yellow
  }
}
