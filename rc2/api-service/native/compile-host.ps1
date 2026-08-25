$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $here 'PontoWebDeskServiceHost.cs'
$out = Join-Path $here 'PontoWebDeskServiceHost.exe'
$cscCandidates = @(
  "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $cscCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) { throw 'CSC_MISSING: .NET Framework 4 csc.exe nao encontrado' }
& $csc /nologo /optimize+ /target:exe /out:$out /r:System.ServiceProcess.dll $src
if ($LASTEXITCODE -ne 0) { throw "CSC_FAILED: exit $LASTEXITCODE" }
if (-not (Test-Path $out)) { throw "CSC_OUTPUT_MISSING: $out" }
Write-Host "OK $out"
