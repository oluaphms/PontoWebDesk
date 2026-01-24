# Script para enviar alteracoes do SmartPonto para o GitHub
# O repositorio Git esta em D:/; o projeto esta em "APP Smartponto"

Write-Host "=== Enviando SmartPonto para GitHub ===" -ForegroundColor Cyan

# Ir para a raiz do repo (D:/)
$repoRoot = "D:\"
if (-not (Test-Path "$repoRoot.git")) {
    Write-Host "ERRO: Repositorio Git nao encontrado em D:\" -ForegroundColor Red
    exit 1
}

Push-Location $repoRoot
try {
    git config --global --add safe.directory "D:/" 2>$null
    git config --global --add safe.directory "D:/APP Smartponto" 2>$null

    Write-Host "`n1. Adicionando pasta APP Smartponto..." -ForegroundColor Yellow
    git add "APP Smartponto"

    Write-Host "`n2. Status:" -ForegroundColor Yellow
    git status --short "APP Smartponto"

    $status = git status --porcelain "APP Smartponto"
    if ($status) {
        Write-Host "`n3. Commit..." -ForegroundColor Yellow
        git commit -m "feat: atualizacoes SmartPonto - favicon, correcoes, Supabase"
    } else {
        Write-Host "`n3. Nenhuma alteracao para commitar" -ForegroundColor Gray
    }

    Write-Host "`n4. Sincronizando com origin/main..." -ForegroundColor Yellow
    git pull origin main --rebase 2>&1 | Out-Null

    Write-Host "`n5. Enviando para GitHub..." -ForegroundColor Yellow
    Write-Host "   (Use Personal Access Token se pedir senha)" -ForegroundColor Gray
    git push origin main

    if ($LASTEXITCODE -eq 0) {
        Write-Host "`nSUCESSO! Alteracoes enviadas." -ForegroundColor Green
        Write-Host "   https://github.com/oluaphms/APP-Smartponto" -ForegroundColor Cyan
    } else {
        Write-Host "`nErro no push. Verifique autenticacao (token) ou permissoes." -ForegroundColor Yellow
    }
} finally {
    Pop-Location
}
