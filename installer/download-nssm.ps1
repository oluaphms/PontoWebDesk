# Baixa NSSM win64 e coloca em installer/nssm.exe (execute na pasta installer)
$ErrorActionPreference = 'Stop'
$destDir = $PSScriptRoot
$zipPath = Join-Path $destDir 'nssm.zip'
$outExe = Join-Path $destDir 'nssm.exe'

$sources = @(
  @{
    Name = 'GitHub (fawno/nssm.cc v2.24.1 Win64)'
    Url  = 'https://github.com/fawno/nssm.cc/releases/download/v2.24.1/nssm-v2.24.1-Win64.zip'
  },
  @{
    Name = 'nssm.cc oficial (2.24)'
    Url  = 'https://nssm.cc/release/nssm-2.24.zip'
  },
  @{
    Name = 'nssm.cc CI (2.24-101, recomendado Windows 10+)'
    Url  = 'https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip'
  }
)

function Find-NssmWin64 {
  param([string]$Root)
  $candidates = Get-ChildItem -Path $Root -Recurse -Filter 'nssm.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match 'win64' -or $_.DirectoryName -match 'win64' }
  if ($candidates) {
    return ($candidates | Select-Object -First 1)
  }
  $any = Get-ChildItem -Path $Root -Recurse -Filter 'nssm.exe' -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($any) { return $any }
  return $null
}

$downloaded = $false
$lastError = $null

foreach ($src in $sources) {
  Write-Host "Tentando: $($src.Name) ..."
  try {
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    $extractDir = Join-Path $destDir 'nssm-extract'
    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }

    Invoke-WebRequest -Uri $src.Url -OutFile $zipPath -UseBasicParsing -TimeoutSec 120
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

    $exe = Find-NssmWin64 -Root $extractDir
    if (-not $exe) {
      throw 'nssm.exe não encontrado dentro do zip'
    }

    Copy-Item $exe.FullName $outExe -Force
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue

    Write-Host "OK: $outExe (fonte: $($src.Name))"
    $downloaded = $true
    break
  } catch {
    $lastError = $_
    Write-Warning "Falhou ($($src.Name)): $($_.Exception.Message)"
  }
}

if (-not $downloaded) {
  Write-Host ""
  Write-Host "Nenhuma fonte respondeu. Instale manualmente:" -ForegroundColor Yellow
  Write-Host "  1. Baixe: https://github.com/fawno/nssm.cc/releases/download/v2.24.1/nssm-v2.24.1-Win64.zip"
  Write-Host "  2. Extraia win64\nssm.exe para installer\nssm.exe"
  Write-Host ""
  throw "Download NSSM falhou. Último erro: $($lastError.Exception.Message)"
}
