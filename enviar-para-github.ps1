# Script para enviar o projeto para o GitHub
# Execute este script no PowerShell como Administrador se necessário

Write-Host "=== Enviando SmartaPonto para GitHub ===" -ForegroundColor Cyan

# Verificar se está no diretório correto
if (-not (Test-Path "package.json")) {
    Write-Host "ERRO: Execute este script na raiz do projeto!" -ForegroundColor Red
    exit 1
}

# Configurar Git (se necessário)
Write-Host "`n1. Configurando Git..." -ForegroundColor Yellow
git config --global --add safe.directory "D:/APP Smartponto" 2>$null

# Remover .git existente se houver problemas
if (Test-Path ".git") {
    Write-Host "   Removendo .git existente..." -ForegroundColor Gray
    Remove-Item ".git" -Recurse -Force -ErrorAction SilentlyContinue
}

# Inicializar repositório
Write-Host "2. Inicializando repositório Git..." -ForegroundColor Yellow
git init

# Configurar usuário
Write-Host "3. Configurando usuário Git..." -ForegroundColor Yellow
git config user.name "Paulo Henrique"
git config user.email "oluaphms@users.noreply.github.com"

# Adicionar remote
Write-Host "4. Configurando remote do GitHub..." -ForegroundColor Yellow
git remote remove origin 2>$null
git remote add origin https://github.com/oluaphms/APP-Smartponto.git
git remote -v

# Adicionar todos os arquivos
Write-Host "`n5. Adicionando arquivos..." -ForegroundColor Yellow
git add .

# Verificar status
Write-Host "`n6. Status do repositório:" -ForegroundColor Yellow
git status --short

# Fazer commit
Write-Host "`n7. Fazendo commit..." -ForegroundColor Yellow
git commit -m "Initial commit: SmartaPonto - Sistema de Ponto Eletrônico

- Sistema completo de ponto eletrônico
- Integração com Supabase
- Interface moderna e responsiva
- Recursos de IA para insights
- Geolocalização e validação de ponto"

# Renomear branch para main
Write-Host "`n8. Configurando branch main..." -ForegroundColor Yellow
git branch -M main

# Push para GitHub
Write-Host "`n9. Enviando para GitHub..." -ForegroundColor Yellow
Write-Host "   (Você pode precisar fazer login no GitHub)" -ForegroundColor Gray
git push -u origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ SUCESSO! Projeto enviado para GitHub!" -ForegroundColor Green
    Write-Host "   URL: https://github.com/oluaphms/APP-Smartponto" -ForegroundColor Cyan
} else {
    Write-Host "`n⚠️  Se houver erro de autenticação:" -ForegroundColor Yellow
    Write-Host "   1. Use um Personal Access Token do GitHub" -ForegroundColor White
    Write-Host "   2. Ou configure SSH keys" -ForegroundColor White
    Write-Host "   3. Ou use: git push -u origin main" -ForegroundColor White
}
