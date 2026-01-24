# Execute no PowerShell (como Administrador se der erro de permissao)
# O repo Git esta em D:\, o projeto em "APP Smartponto"
# NUNCA use "git add -A" na raiz D:\ - isso adiciona .pnpm-store e outras pastas.

Set-Location "D:\"

# Reduz avisos LF/CRLF (opcional)
git config core.autocrlf input 2>$null

# Se .pnpm-store foi commitado antes, remove do indice (nao apaga da pasta)
$pnpmTracked = git ls-files .pnpm-store 2>$null
if ($pnpmTracked) {
    Write-Host "0. Removendo .pnpm-store do Git (manter na pasta)..." -ForegroundColor Yellow
    git rm -r --cached .pnpm-store 2>$null
}

Write-Host "1. git add APP Smartponto (nao usar add -A!)" -ForegroundColor Yellow
git add "APP Smartponto"

Write-Host "`n2. git status" -ForegroundColor Yellow
git status

Write-Host "`n3. git commit" -ForegroundColor Yellow
git commit -m "feat: ajustes Vercel (rewrites, cleanUrls), vite base, DEPLOY_VERCEL"

Write-Host "`n4. git pull origin main --rebase" -ForegroundColor Yellow
git pull origin main --rebase

Write-Host "`n5. git push origin main" -ForegroundColor Yellow
git push origin main

Write-Host "`nConcluido." -ForegroundColor Green
