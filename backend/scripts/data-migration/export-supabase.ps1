# Exporta APENAS DADOS do Supabase (sem schema). Requer pg_dump no PATH.
param(
  [string]$OutFile = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $Root

if (Test-Path ".env") {
  Get-Content ".env" | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim().Trim('"'), "Process")
    }
  }
}

$src = $env:SUPABASE_DATABASE_URL
if (-not $src) {
  Write-Error "Defina SUPABASE_DATABASE_URL em backend/.env (Connection string Direct, porta 5432)"
}

if (-not $OutFile) {
  $dataDir = Join-Path $Root "data"
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  $OutFile = Join-Path $dataDir "supabase-data.dump"
}

$excludes = @(
  "--exclude-table-data=storage.migrations",
  "--exclude-table-data=auth.schema_migrations",
  "--exclude-table-data=auth.sessions",
  "--exclude-table-data=auth.refresh_tokens",
  "--exclude-table-data=auth.identities",
  "--exclude-table-data=auth.mfa_factors"
)

Write-Host "[export] Supabase -> $OutFile"
& pg_dump $src `
  --format=custom `
  --data-only `
  --no-owner `
  --no-privileges `
  --schema=public `
  --schema=auth `
  --schema=storage `
  @excludes `
  --file=$OutFile

Write-Host "[export] OK"
