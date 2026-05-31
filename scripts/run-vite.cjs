const { observabilityConsole } = require('../services/observabilityConsole.cjs');
/**
 * Roda o Vite do projeto com NODE_PATH apontando para node_modules.
 * Se vite nao estiver instalado, tenta instalar com npm install.
 */
const path = require('path')
const { spawnSync } = require('child_process')
const fs = require('fs')

const projectRoot = path.resolve(__dirname, '..')
const nodeModules = path.join(projectRoot, 'node_modules')
const viteBin = path.join(nodeModules, 'vite', 'bin', 'vite.js')

// Garantir que o Vite rode sempre em modo desenvolvimento ao usar `npm run dev`,
// mesmo que o ambiente tenha NODE_ENV=production configurado globalmente.
// Não sobrescrevemos NODE_PATH para evitar múltiplas cópias de React.
const env = { ...process.env, NODE_ENV: 'development' }

if (!fs.existsSync(viteBin)) {
  observabilityConsole.error('Vite nao encontrado. Instalando vite e @vitejs/plugin-react...')
  const install = spawnSync('npm', ['install', 'vite', '@vitejs/plugin-react', '--save-dev', '--include=dev', '--no-audit', '--no-fund'], {
    cwd: projectRoot,
    stdio: 'inherit'
  })
  if (install.status !== 0 || !fs.existsSync(viteBin)) {
    observabilityConsole.error('Falha ao instalar. Rode manualmente: npm install vite @vitejs/plugin-react --save-dev')
    process.exit(1)
  }
}

// Remove --port / --port=N para garantir que a porta seja sempre a do vite.config.ts (strictPort: 3010)
const raw = process.argv.slice(2)
const filtered = []
for (let i = 0; i < raw.length; i++) {
  if (raw[i] === '--port') {
    i++
    continue
  }
  if (String(raw[i]).startsWith('--port=')) continue
  filtered.push(raw[i])
}

const result = spawnSync(process.execPath, [viteBin, ...filtered], {
  cwd: projectRoot,
  stdio: 'inherit',
  env
})
process.exit(result.status ?? 1)
