# Script to install dependencies with offline mode disabled
# Run this script to fix the NPM_CONFIG_OFFLINE issue

Write-Host "Fixing npm offline mode and installing dependencies..." -ForegroundColor Yellow

# Set offline mode to false for this session
$env:NPM_CONFIG_OFFLINE = "false"

# Clear any proxy settings that might interfere
$env:HTTP_PROXY = $null
$env:HTTPS_PROXY = $null
$env:http_proxy = $null
$env:https_proxy = $null

# Remove node_modules and package-lock.json for clean install
if (Test-Path "node_modules") {
    Write-Host "Removing existing node_modules..." -ForegroundColor Yellow
    Remove-Item -Path "node_modules" -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path "package-lock.json") {
    Write-Host "Removing package-lock.json..." -ForegroundColor Yellow
    Remove-Item -Path "package-lock.json" -Force -ErrorAction SilentlyContinue
}

# Install dependencies
Write-Host "Installing dependencies (this may take a few minutes)..." -ForegroundColor Green
npm install

# Verify vite is installed
if (Test-Path "node_modules\vite") {
    Write-Host "`nSUCCESS: Dependencies installed successfully!" -ForegroundColor Green
    Write-Host "You can now run: npm run dev" -ForegroundColor Green
} else {
    Write-Host "`nWARNING: vite may not be installed. Try running:" -ForegroundColor Yellow
    Write-Host "  `$env:NPM_CONFIG_OFFLINE = 'false'; npm install vite@^6.4.1 --save-dev" -ForegroundColor Yellow
}
