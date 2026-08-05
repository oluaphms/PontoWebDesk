param(
  [int[]]$Ports = @(3010, 3000, 5432),
  [string]$LogDir = "$env:ProgramData\PontoWebDesk\Local\logs"
)
$ErrorActionPreference = 'Continue'
. "$PSScriptRoot\write-log.ps1" -Message "validate-ports: $($Ports -join ', ')" -LogDir $LogDir

$blocked = @()
foreach ($port in $Ports) {
  try {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($listeners) {
      $procs = $listeners | ForEach-Object {
        try { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName } catch { '?' }
      } | Select-Object -Unique
      $msg = "Porta $port em uso por: $($procs -join ', ')"
      . "$PSScriptRoot\write-log.ps1" -Message $msg -Level WARN -LogDir $LogDir
      # Docker/com.docker pode ocupar após reinstalação — não bloquear se for docker-proxy
      $onlyDocker = ($procs | Where-Object { $_ -match 'docker|com\.docker' }).Count -eq $procs.Count -and $procs.Count -gt 0
      if (-not $onlyDocker) { $blocked += $port }
    } else {
      . "$PSScriptRoot\write-log.ps1" -Message "Porta $port livre." -LogDir $LogDir
    }
  } catch {
    . "$PSScriptRoot\write-log.ps1" -Message "Não foi possível consultar porta $port: $_" -Level WARN -LogDir $LogDir
  }
}

if ($blocked.Count -gt 0) {
  . "$PSScriptRoot\write-log.ps1" -Message "Portas bloqueadas (não-Docker): $($blocked -join ', '). Ajuste o conflito antes de subir o stack." -Level ERROR -LogDir $LogDir
  exit 3
}
exit 0
