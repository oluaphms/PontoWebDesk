# Script para forcar instalacao das dependencias
Write-Host "=== Corrigindo e instalando dependencias ===" -ForegroundColor Cyan

# Remove variaveis de ambiente problematicas
Write-Host "1. Removendo variaveis de ambiente problematicas..." -ForegroundColor Yellow
Remove-Item Env:\NPM_CONFIG_OFFLINE -ErrorAction SilentlyContinue
$env:NPM_CONFIG_OFFLINE = "false"
$env:HTTP_PROXY = $null
$env:HTTPS_PROXY = $null

# Limpa node_modules e package-lock.json
Write-Host "2. Limpando instalacoes anteriores..." -ForegroundColor Yellow
if (Test-Path "node_modules") {
    Remove-Item -Path "node_modules" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "   node_modules removido" -ForegroundColor Green
}
if (Test-Path "package-lock.json") {
    Remove-Item -Path "package-lock.json" -Force -ErrorAction SilentlyContinue
    Write-Host "   package-lock.json removido" -ForegroundColor Green
}

# Tenta instalar
Write-Host "3. Instalando dependencias..." -ForegroundColor Yellow
npm install --offline=false --prefer-offline=false --no-audit --no-fund

# Verifica se vite foi instalado
Write-Host "4. Verificando instalacao..." -ForegroundColor Yellow
if (Test-Path "node_modules\vite") {
    Write-Host "SUCESSO: VITE instalado!" -ForegroundColor Green
    Write-Host "Agora voce pode executar: npm run dev" -ForegroundColor Green
} else {
    Write-Host "VITE NAO foi instalado. Tentando instalar explicitamente..." -ForegroundColor Yellow
    npm install vite@6.4.1 --save-dev --offline=false
    
    if (Test-Path "node_modules\vite") {
        Write-Host "SUCESSO: Vite instalado na segunda tentativa!" -ForegroundColor Green
    } else {
        Write-Host "FALHA: Vite ainda nao foi instalado" -ForegroundColor Red
        Write-Host "Por favor, remova a variavel NPM_CONFIG_OFFLINE das variaveis de ambiente do sistema" -ForegroundColor Yellow
    }
}
