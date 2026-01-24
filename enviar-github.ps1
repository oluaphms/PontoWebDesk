# Envia o SmartPonto para GitHub (projeto na raiz do repo = Vercel sem Root Directory)
# Execute no PowerShell como Administrador: .\enviar-github.ps1

$ErrorActionPreference = "Stop"
Set-Location "D:\APP Smartponto"

Write-Host "=== Enviar SmartPonto para GitHub ===" -ForegroundColor Cyan

# Remove locks residuais
Remove-Item -Path ".git\index.lock" -Force -ErrorAction SilentlyContinue
Remove-Item -Path ".git\config.lock" -Force -ErrorAction SilentlyContinue

Write-Host "`n1. git add -A" -ForegroundColor Yellow
git add -A

Write-Host "`n2. git status" -ForegroundColor Yellow
git status --short

$st = git status --porcelain
if (-not $st) {
    Write-Host "`nNada para commitar." -ForegroundColor Gray
    exit 0
}

Write-Host "`n3. git commit" -ForegroundColor Yellow
git commit -m "feat: SmartPonto - projeto na raiz, Vercel 404 fix, docs"

Write-Host "`n4. git push (projeto na raiz; force para substituir estrutura antiga)" -ForegroundColor Yellow
git push -u origin main --force

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nOK! Enviado para https://github.com/oluaphms/APP-Smartponto" -ForegroundColor Green
    Write-Host "Vercel: deixe Root Directory VAZIO (projeto ja esta na raiz)." -ForegroundColor Cyan
} else {
    Write-Host "`nErro no push. Use Personal Access Token como senha se pedir." -ForegroundColor Red
    exit 1
}
