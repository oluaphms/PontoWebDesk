




























































# Script para fazer push no novo repositório appteste
# Execute este script DEPOIS de fechar o Cursor/VS Code

Write-Host "🚀 Enviando para appteste.git..." -ForegroundColor Cyan

# Mudar para o diretório do projeto
Set-Location "D:\APP Smartponto"

# Desabilitar proxy
$env:HTTP_PROXY = $null
$env:HTTPS_PROXY = $null
$env:http_proxy = $null
$env:https_proxy = $null

# Remover locks
Write-Host "`n🔓 Removendo locks..." -ForegroundColor Yellow
if (Test-Path ".git\index.lock") {
    Remove-Item ".git\index.lock" -Force -ErrorAction SilentlyContinue
}
if (Test-Path ".git\config.lock") {
    Remove-Item ".git\config.lock" -Force -ErrorAction SilentlyContinue
}

# Verificar remote
Write-Host "`n📋 Verificando remote..." -ForegroundColor Yellow
git remote -v

# Garantir que o remote está correto
$currentRemote = git remote get-url origin 2>$null
if ($currentRemote -ne "https://github.com/oluaphms/appteste.git") {
    Write-Host "`n🔧 Configurando remote..." -ForegroundColor Yellow
    git remote remove origin 2>$null
    git remote add origin https://github.com/oluaphms/appteste.git
}

# Garantir que o branch é main
Write-Host "`n🌿 Verificando branch..." -ForegroundColor Yellow
$currentBranch = git branch --show-current
if ($currentBranch -ne "main") {
    Write-Host "Renomeando branch para main..." -ForegroundColor Yellow
    git branch -M main
}

# Adicionar todos os arquivos
Write-Host "`n📦 Adicionando arquivos..." -ForegroundColor Yellow
git add -A

# Verificar status
Write-Host "`n📊 Status:" -ForegroundColor Yellow
git status --short

# Fazer commit se houver alterações
$status = git status --porcelain
if ($status) {
    Write-Host "`n💾 Fazendo commit..." -ForegroundColor Yellow
    git commit -m "feat: inicializar repositório appteste"
} else {
    Write-Host "`n✅ Nenhuma alteração para commitar" -ForegroundColor Green
}

# Push
Write-Host "`n📤 Enviando para GitHub (appteste)..." -ForegroundColor Yellow
Write-Host "   Quando pedir credenciais:" -ForegroundColor Gray
Write-Host "   - Username: seu-usuario-github" -ForegroundColor Gray
Write-Host "   - Password: seu-personal-access-token" -ForegroundColor Gray
Write-Host ""

git push -u origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ Sucesso! Código enviado para appteste.git" -ForegroundColor Green
    Write-Host "🔗 https://github.com/oluaphms/appteste" -ForegroundColor Cyan
} else {
    Write-Host "`n❌ Erro ao enviar. Verifique:" -ForegroundColor Red
    Write-Host "   1. Se o repositório appteste existe no GitHub" -ForegroundColor Yellow
    Write-Host "   2. Se você tem permissão para fazer push" -ForegroundColor Yellow
    Write-Host "   3. Se suas credenciais estão corretas" -ForegroundColor Yellow
}
