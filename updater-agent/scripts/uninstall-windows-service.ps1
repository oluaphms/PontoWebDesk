param(
  [string]$ServiceName = "PontoWebDeskUpdater"
)

$ErrorActionPreference = "Stop"
$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if ($nssm) {
  & nssm stop $ServiceName 2>$null
  & nssm remove $ServiceName confirm
} else {
  sc.exe stop $ServiceName 2>$null | Out-Null
  sc.exe delete $ServiceName
}
Write-Host "Serviço $ServiceName removido."
