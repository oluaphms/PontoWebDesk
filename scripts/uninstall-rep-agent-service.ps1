param(
  [string]$ServiceName = "PontoWebDeskRepAgent",
  [string]$NssmPath = "",
  [string]$InstallDir = "C:\PontoWebDeskAgent",
  [switch]$RemoveFiles
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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
  throw "NSSM não encontrado. Informe -NssmPath ou reinstale o agente."
}

$nssm = Resolve-NssmPath -ProvidedPath $NssmPath -InstallDir $InstallDir

Write-RepAgentLog "Removendo servico $ServiceName ..."
try {
  Stop-Service -Name $ServiceName -ErrorAction SilentlyContinue
} catch {}

& $nssm remove $ServiceName confirm | Out-Null
Write-RepAgentLog 'Servico removido.' -Color Green

if ($RemoveFiles) {
  if (Test-Path $InstallDir) {
    Write-RepAgentLog "Removendo arquivos em $InstallDir ..."
    Remove-Item -Path $InstallDir -Recurse -Force
    Write-RepAgentLog 'Diretorio removido.' -Color Green
  } else {
    Write-RepAgentLog "Diretorio nao encontrado: $InstallDir" -Color Yellow
  }
}
