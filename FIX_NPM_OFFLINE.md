# 🔧 Fix: NPM Installation Issues

## Problems Identified
1. **NPM_CONFIG_OFFLINE=true** - Environment variable preventing package downloads
2. **Proxy Configuration** - Misconfigured proxy pointing to `127.0.0.1:9`
3. **Permission Issues** - npm cache and config files have permission problems

## ⚠️ IMPORTANT: Permanent Fix Required

You need to remove the `NPM_CONFIG_OFFLINE` environment variable permanently. The temporary fixes won't persist across terminal sessions.

### Option 1: Remove via System Settings (Easiest - Recommended)
1. Press `Win + R`, type `sysdm.cpl`, press Enter
2. Go to "Advanced" tab → "Environment Variables"
3. Under "User variables", look for `NPM_CONFIG_OFFLINE`
4. If found, select it and click "Delete"
5. Also check "System variables" and remove it if present
6. Click OK and **restart your terminal/PowerShell completely**
7. Run: `npm install`

### Option 2: Remove via PowerShell (Run PowerShell as Administrator)
```powershell
# Remove from User environment variables
[System.Environment]::SetEnvironmentVariable("NPM_CONFIG_OFFLINE", $null, "User")

# Remove from System environment variables (if present)
[System.Environment]::SetEnvironmentVariable("NPM_CONFIG_OFFLINE", $null, "Machine")

# Restart your terminal after this!
```

### Option 3: Manual Edit (If above don't work)
1. Press `Win + X` → "System"
2. Click "Advanced system settings"
3. Click "Environment Variables"
4. Find and delete `NPM_CONFIG_OFFLINE` from both User and System variables
5. Restart your computer (or at least restart all terminal windows)

## After Removing the Environment Variable

1. **Close ALL terminal/PowerShell windows**
2. **Open a NEW PowerShell window**
3. Navigate to your project:
   ```powershell
   cd "d:\APP Smartponto"
   ```
4. Clear proxy settings (if needed):
   ```powershell
   $env:HTTP_PROXY = $null
   $env:HTTPS_PROXY = $null
   npm config delete proxy
   npm config delete https-proxy
   ```
5. Install dependencies:
   ```powershell
   npm install
   ```

## Verify Fix
After fixing, verify:
```powershell
# Check offline mode (should be false or null)
npm config get offline

# Check if you can access registry
npm ping
```

## Alternative Solutions

### Use pnpm (if npm still has issues)
```powershell
# Install pnpm globally (if npm works for this)
npm install -g pnpm

# Then use pnpm instead
pnpm install
pnpm run dev
```

### Use Yarn (if npm still has issues)
```powershell
# Install yarn globally
npm install -g yarn

# Then use yarn instead
yarn install
yarn dev
```

## If Permission Errors Persist

If you get `EPERM` errors, you may need to:
1. Run PowerShell as Administrator
2. Check if antivirus is blocking npm cache
3. Temporarily disable antivirus and try again
4. Or change npm cache location:
   ```powershell
   npm config set cache "D:\npm-cache" --global
   ```
