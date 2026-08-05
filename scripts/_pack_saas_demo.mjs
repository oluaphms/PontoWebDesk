/**
 * Empacota SaaS-Demo (não altera o projeto fonte).
 * Uso: node scripts/_pack_saas_demo.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(ROOT, 'SaaS-Demo');
const require = createRequire(path.join(ROOT, 'backend', 'package.json'));

const SKIP_DIR = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  '.git',
  'logs',
  '_logs',
  '.cache',
  'cache',
  '.turbo',
  '.vite',
  '.idea',
  '.vscode',
  '.cursor',
  '.kiro',
  '.qodo',
  '.tmp-ui',
  'SaaS-Demo',
]);

const SKIP_FILE_RE =
  /\.(log|tmp|temp|swp|swo)$/i;

const copied = [];
const skipped = [];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function shouldSkipEntry(name, isDir) {
  if (isDir && SKIP_DIR.has(name)) return true;
  if (!isDir && SKIP_FILE_RE.test(name)) return true;
  if (!isDir && (name === '.DS_Store' || name === 'Thumbs.db')) return true;
  return false;
}

function copyTree(src, dest, { relBase = '' } = {}) {
  if (!fs.existsSync(src)) {
    skipped.push({ path: relBase || src, reason: 'origem inexistente' });
    return;
  }
  ensureDir(dest);
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (shouldSkipEntry(ent.name, ent.isDirectory())) {
      skipped.push({
        path: path.join(relBase, ent.name).replace(/\\/g, '/'),
        reason: ent.isDirectory() ? 'excluído por regra (node_modules/dist/cache/IDE/etc.)' : 'arquivo temporário/log',
      });
      continue;
    }
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    const rel = path.join(relBase, ent.name).replace(/\\/g, '/');
    if (ent.isDirectory()) {
      copyTree(s, d, { relBase: rel });
    } else if (ent.isSymbolicLink()) {
      skipped.push({ path: rel, reason: 'symlink ignorado' });
    } else {
      ensureDir(path.dirname(d));
      fs.copyFileSync(s, d);
      copied.push(rel);
    }
  }
}

function writeFile(rel, content) {
  const abs = path.join(DEST, rel);
  ensureDir(path.dirname(abs));
  fs.writeFileSync(abs, content, 'utf8');
  copied.push(rel.replace(/\\/g, '/'));
}

function patchTextFile(rel, replacer) {
  const abs = path.join(DEST, rel);
  if (!fs.existsSync(abs)) return;
  const before = fs.readFileSync(abs, 'utf8');
  const after = replacer(before);
  if (after !== before) fs.writeFileSync(abs, after, 'utf8');
}

console.log('[pack] Limpando SaaS-Demo anterior…');
if (fs.existsSync(DEST)) fs.rmSync(DEST, { recursive: true, force: true });
ensureDir(DEST);

// --- Backend ---
console.log('[pack] Copiando backend…');
copyTree(path.join(ROOT, 'backend'), path.join(DEST, 'backend'), { relBase: 'backend' });

// --- Frontend (raiz Vite → frontend/) ---
console.log('[pack] Copiando frontend…');
const feDirs = [
  'src',
  'components',
  'modules',
  'services',
  'hooks',
  'lib',
  'utils',
  'public',
  'api',
  'shared', // src-level? root shared is separate; root has shared/master-contract
  'state',
  'eslint',
];
for (const d of feDirs) {
  const src = path.join(ROOT, d);
  if (!fs.existsSync(src)) {
    skipped.push({ path: d, reason: 'não existe na origem (frontend)' });
    continue;
  }
  // root shared/ is master-contract — copied separately below; skip duplicating into frontend/shared if it's the contract package
  if (d === 'shared') {
    // Frontend may import from ./shared only for master-contract via package.json file: — we put contract at SaaS-Demo/shared
    // Also check if there's nothing else
    continue;
  }
  copyTree(src, path.join(DEST, 'frontend', d), { relBase: `frontend/${d}` });
}

const feFiles = [
  'App.tsx',
  'index.tsx',
  'index.html',
  'index.css',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'vite.config.ts',
  'vite.config.dev.ts',
  'vite.devApiPlugins.ts',
  'postcss.config.js',
  'postcss.config.cjs',
  'tailwind.config.js',
  'tailwind.config.ts',
  'tailwind.config.cjs',
  '.npmrc',
  '.nvmrc',
  '.node-version',
  'architecture-lint.config.json',
  '.dependency-cruiser.cjs',
  'eslint.config.js',
  'firebase.json',
  'firestore.rules',
  'firestore.indexes.json',
];
for (const f of feFiles) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) {
    skipped.push({ path: f, reason: 'não existe na origem (frontend root)' });
    continue;
  }
  const destRel = path.join('frontend', f).replace(/\\/g, '/');
  ensureDir(path.dirname(path.join(DEST, destRel)));
  fs.copyFileSync(src, path.join(DEST, destRel));
  copied.push(destRel);
}

// Env frontend
for (const f of ['.env', '.env.development', '.env.production', '.env.local', '.env.example', '.env.local.example']) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) continue;
  const destRel = path.join('frontend', f).replace(/\\/g, '/');
  fs.copyFileSync(src, path.join(DEST, destRel));
  copied.push(destRel);
}

// --- shared/master-contract (dep file:) ---
console.log('[pack] Copiando shared/master-contract…');
copyTree(path.join(ROOT, 'shared', 'master-contract'), path.join(DEST, 'shared', 'master-contract'), {
  relBase: 'shared/master-contract',
});

// Patch frontend package.json file: dep
patchTextFile('frontend/package.json', (t) =>
  t.replace(/"file:shared\/master-contract"/g, '"file:../shared/master-contract"'),
);

// Patch vite.config.ts absolute node_modules aliases → relative (still works after npm install in frontend)
patchTextFile('frontend/vite.config.ts', (t) =>
  t
    .replace(/path\.resolve\(projectRoot, 'node_modules\/([^']+)'\)/g, "path.resolve(projectRoot, 'node_modules', '$1')")
    .replace(/path\.resolve\(projectRoot, 'node_modules\/([^']+)\/([^']+)'\)/g, "path.resolve(projectRoot, 'node_modules', '$1', '$2')"),
);

// Backend env already copied; normalize DATABASE_URL for Docker network in SaaS-Demo copies
console.log('[pack] Ajustando .env do demo (caminhos relativos / Docker)…');

const demoRootEnv = `# ============================================
# PontoWebDesk — SaaS Demo (Docker)
# ============================================
# Stack: frontend :3010 | API :3000 | PostgreSQL :5432
# NÃO use este arquivo em produção real.

COMPOSE_PROJECT_NAME=pontowebdesk-saas-demo

POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=pontowebdesk
POSTGRES_PORT=5432

# Host machine → containers
FRONTEND_URL=http://localhost:3010
APP_URL=http://localhost:3010
VITE_APP_ENV=development
VITE_DATA_PROVIDER=LOCAL_API
VITE_API_URL=http://localhost:3000/api
VITE_APP_URL=http://localhost:3010
VITE_LOCAL_REALTIME_POLL_MS=12000

# API (valores usados pelo serviço backend no compose)
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://postgres:postgres@postgres:5432/pontowebdesk
PGHOST=postgres
PGPORT=5432
PGUSER=postgres
PGPASSWORD=postgres
PGDATABASE=pontowebdesk

JWT_SECRET=demo_only_change_me_saas_demo_jwt_secret_32b
JWT_EXPIRES_IN=2h
AUTH_REVALIDATE_DB=true
RATE_LIMIT_REDIS_REQUIRED=false
AUTH_COOKIE_SECURE=false
MASTER_PERSISTENCE=postgres
DATA_PROVIDER=LOCAL_API
OPERATIONAL_AUTH_PROVIDER=LOCAL_API
CORS_ORIGINS=http://localhost:3010,http://localhost:5173,http://127.0.0.1:3010

MASTER_JWT_SECRET=demo_only_master_jwt_secret_change_me_32b
MASTER_OWNER_1_EMAIL=owner1@demo.local
MASTER_OWNER_1_PASSWORD=DemoOwner1!
MASTER_OWNER_1_NAME=Owner Demo 1
MASTER_OWNER_2_EMAIL=owner2@demo.local
MASTER_OWNER_2_PASSWORD=DemoOwner2!
MASTER_OWNER_2_NAME=Owner Demo 2

API_KEY=0137fd1c88fbe0e1d7f32a518f045467062e28176331e05bcfb1088df2899e5f
REP_BRIDGE_LEGACY_ENABLED=true
`;
writeFile('.env', demoRootEnv);

// Backend .env for container (and local override docs)
writeFile(
  'backend/.env',
  `# Gerado para SaaS-Demo — Postgres do docker-compose
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://postgres:postgres@postgres:5432/pontowebdesk
PGHOST=postgres
PGPORT=5432
PGUSER=postgres
PGPASSWORD=postgres
PGDATABASE=pontowebdesk
JWT_SECRET=demo_only_change_me_saas_demo_jwt_secret_32b
JWT_EXPIRES_IN=2h
AUTH_REVALIDATE_DB=true
RATE_LIMIT_REDIS_REQUIRED=false
AUTH_COOKIE_SECURE=false
MASTER_PERSISTENCE=postgres
DATA_PROVIDER=LOCAL_API
OPERATIONAL_AUTH_PROVIDER=LOCAL_API
CORS_ORIGINS=http://localhost:3010,http://localhost:5173,http://127.0.0.1:3010
FRONTEND_URL=http://localhost:3010
APP_URL=http://localhost:3010
MASTER_JWT_SECRET=demo_only_master_jwt_secret_change_me_32b
MASTER_OWNER_1_EMAIL=owner1@demo.local
MASTER_OWNER_1_PASSWORD=DemoOwner1!
MASTER_OWNER_1_NAME=Owner Demo 1
MASTER_OWNER_2_EMAIL=owner2@demo.local
MASTER_OWNER_2_PASSWORD=DemoOwner2!
MASTER_OWNER_2_NAME=Owner Demo 2
API_KEY=0137fd1c88fbe0e1d7f32a518f045467062e28176331e05bcfb1088df2899e5f
REP_BRIDGE_LEGACY_ENABLED=true
`,
);

writeFile(
  'backend/.env.development',
  fs.readFileSync(path.join(DEST, 'backend/.env'), 'utf8'),
);

writeFile(
  'frontend/.env.development',
  `# SaaS-Demo frontend
VITE_APP_ENV=development
VITE_DATA_PROVIDER=LOCAL_API
VITE_API_URL=http://localhost:3000/api
VITE_APP_URL=http://localhost:3010
VITE_LOCAL_REALTIME_POLL_MS=12000
`,
);
writeFile(
  'frontend/.env',
  `# SaaS-Demo frontend
VITE_APP_ENV=development
VITE_DATA_PROVIDER=LOCAL_API
VITE_API_URL=http://localhost:3000/api
VITE_APP_URL=http://localhost:3010
VITE_LOCAL_REALTIME_POLL_MS=12000
`,
);

// Dockerfiles + compose
writeFile(
  'backend/Dockerfile',
  `FROM node:20-bookworm-slim

WORKDIR /app

# Dependência local file:../shared/master-contract
COPY shared/master-contract /app/shared/master-contract
COPY backend/package.json backend/package-lock.json* /app/backend/

WORKDIR /app/backend
RUN npm install --include=dev

COPY backend/ /app/backend/
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/server.js"]
`,
);

writeFile(
  'frontend/Dockerfile',
  `FROM node:20-bookworm-slim

WORKDIR /app

COPY shared/master-contract /app/shared/master-contract
COPY frontend/package.json frontend/package-lock.json* /app/frontend/

WORKDIR /app/frontend
RUN npm install --include=dev

COPY frontend/ /app/frontend/

EXPOSE 3010
# Dev server Vite (demo) — hot reload não é necessário; porta fixa 3010
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3010"]
`,
);

writeFile(
  'docker-compose.yml',
  `name: pontowebdesk-saas-demo

services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: \${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-postgres}
      POSTGRES_DB: \${POSTGRES_DB:-pontowebdesk}
    ports:
      - "\${POSTGRES_PORT:-5432}:5432"
    volumes:
      - saas_demo_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER:-postgres} -d \${POSTGRES_DB:-pontowebdesk}"]
      interval: 5s
      timeout: 5s
      retries: 20

  backend:
    build:
      context: .
      dockerfile: backend/Dockerfile
    restart: unless-stopped
    env_file:
      - .env
      - backend/.env
    environment:
      DATABASE_URL: postgres://\${POSTGRES_USER:-postgres}:\${POSTGRES_PASSWORD:-postgres}@postgres:5432/\${POSTGRES_DB:-pontowebdesk}
      PGHOST: postgres
      PGPORT: "5432"
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy

  frontend:
    build:
      context: .
      dockerfile: frontend/Dockerfile
    restart: unless-stopped
    env_file:
      - .env
      - frontend/.env
    environment:
      VITE_API_URL: http://localhost:3000/api
      VITE_APP_URL: http://localhost:3010
      VITE_DATA_PROVIDER: LOCAL_API
    ports:
      - "3010:3010"
    depends_on:
      - backend

volumes:
  saas_demo_pgdata:
`,
);

ensureDir(path.join(DEST, 'database'));
ensureDir(path.join(DEST, 'scripts'));

// --- Database detect + backup ---
console.log('[pack] Detectando banco e tentando backup…');
let dbInfo = { engine: 'PostgreSQL', source: null, backup: null, note: '' };
const dotenv = require('dotenv');
let databaseUrl = '';
try {
  const p = dotenv.parse(fs.readFileSync(path.join(ROOT, 'backend', '.env.development')));
  databaseUrl = p.DATABASE_URL || '';
  dbInfo.source = databaseUrl.replace(/:\/\/[^@]+@/, '://***@');
} catch {
  dbInfo.note = 'Não foi possível ler backend/.env.development';
}

const backupPath = path.join(DEST, 'database', 'backup_demo.sql');
let backupOk = false;

function tryPgDump(url) {
  try {
    const u = new URL(url);
    const host = u.hostname;
    const port = u.port || '5432';
    const user = decodeURIComponent(u.username || 'postgres');
    const pass = decodeURIComponent(u.password || '');
    const db = (u.pathname || '/pontowebdesk').replace(/^\//, '') || 'pontowebdesk';
    const env = { ...process.env, PGPASSWORD: pass };
    // Docker Desktop pode estar off — tenta pg_dump local
    const r = spawnSync(
      'pg_dump',
      ['-h', host, '-p', port, '-U', user, '-d', db, '--no-owner', '--no-acl', '-F', 'p'],
      { env, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
    );
    if (r.status === 0 && r.stdout && r.stdout.length > 1000) {
      fs.writeFileSync(backupPath, r.stdout, 'utf8');
      return true;
    }
    // docker exec se container conhecido
    const docker = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
    if (docker.status === 0 && docker.stdout) {
      const names = docker.stdout.split(/\r?\n/).filter(Boolean);
      const cand = names.find((n) => /pg|postgres|pontoweb/i.test(n)) || names[0];
      if (cand) {
        const d = spawnSync(
          'docker',
          ['exec', '-e', `PGPASSWORD=${pass}`, cand, 'pg_dump', '-U', user, '-d', db, '--no-owner', '--no-acl'],
          { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
        );
        if (d.status === 0 && d.stdout && d.stdout.length > 1000) {
          fs.writeFileSync(backupPath, d.stdout, 'utf8');
          dbInfo.note = `Backup via docker exec (${cand})`;
          return true;
        }
      }
    }
  } catch (e) {
    dbInfo.note = String(e.message || e);
  }
  return false;
}

if (databaseUrl && tryPgDump(databaseUrl)) {
  backupOk = true;
  dbInfo.backup = 'database/backup_demo.sql';
  copied.push('database/backup_demo.sql');
} else {
  // Fallback: copiar backup existente do projeto se útil
  const fallbacks = ['backup_antes_work_shifts.sql', 'backup_pre_security.sql'];
  for (const f of fallbacks) {
    const src = path.join(ROOT, f);
    if (fs.existsSync(src) && fs.statSync(src).size > 1000) {
      fs.copyFileSync(src, backupPath);
      backupOk = true;
      dbInfo.backup = 'database/backup_demo.sql';
      dbInfo.note = `Docker/pg_dump indisponível; copiado fallback ${f} do projeto`;
      copied.push('database/backup_demo.sql');
      break;
    }
  }
}

if (!backupOk) {
  writeFile(
    'database/backup_demo.sql',
    `-- Placeholder: backup não gerado automaticamente.
-- Execute scripts\\exportar_backup.bat com o PostgreSQL de origem ligado.
SELECT 1;
`,
  );
  dbInfo.note = (dbInfo.note || '') + ' | placeholder criado';
}

writeFile(
  'scripts/exportar_backup.bat',
  `@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

REM Exporta o banco de origem (máquina de desenvolvimento) para database\\backup_demo.sql
REM Ajuste HOST/PORTA/USER/DB se necessário.

set PGHOST=127.0.0.1
set PGPORT=55432
set PGUSER=postgres
set PGPASSWORD=postgres
set PGDATABASE=pontowebdesk
set OUT=%cd%\\database\\backup_demo.sql

echo [exportar_backup] Tentando pg_dump em %PGHOST%:%PGPORT%/%PGDATABASE% ...
where pg_dump >nul 2>&1
if %ERRORLEVEL%==0 (
  pg_dump -h %PGHOST% -p %PGPORT% -U %PGUSER% -d %PGDATABASE% --no-owner --no-acl -F p -f "%OUT%"
  if %ERRORLEVEL%==0 (
    echo [exportar_backup] OK: %OUT%
    exit /b 0
  )
)

echo [exportar_backup] Tentando via Docker (container postgres)...
for /f "tokens=*" %%c in ('docker ps --format "{{.Names}}" ^| findstr /i "pg postgres pontoweb"') do (
  docker exec -e PGPASSWORD=%PGPASSWORD% %%c pg_dump -U %PGUSER% -d %PGDATABASE% --no-owner --no-acl > "%OUT%"
  if %ERRORLEVEL%==0 (
    echo [exportar_backup] OK via %%c: %OUT%
    exit /b 0
  )
)

echo [exportar_backup] FALHA: instale PostgreSQL client tools ou inicie o container e rode de novo.
exit /b 1
`,
);

writeFile(
  'scripts/restaurar_banco.bat',
  `@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

if not exist "database\\backup_demo.sql" (
  echo [restaurar_banco] database\\backup_demo.sql nao encontrado.
  echo Rode scripts\\exportar_backup.bat antes, ou copie um dump SQL.
  exit /b 1
)

echo [restaurar_banco] Subindo apenas o Postgres...
docker compose up -d postgres
if errorlevel 1 (
  echo Falha no docker compose. Docker Desktop esta rodando?
  exit /b 1
)

echo [restaurar_banco] Aguardando Postgres ficar pronto...
set /a tries=0
:wait
set /a tries+=1
docker compose exec -T postgres pg_isready -U postgres -d pontowebdesk >nul 2>&1
if errorlevel 1 (
  if %tries% GEQ 40 (
    echo Timeout aguardando Postgres.
    exit /b 1
  )
  timeout /t 2 /nobreak >nul
  goto wait
)

echo [restaurar_banco] Restaurando database\\backup_demo.sql ...
type "database\\backup_demo.sql" | docker compose exec -T postgres psql -U postgres -d pontowebdesk
if errorlevel 1 (
  echo Aviso: psql retornou erro (comum com dumps parciais). Verifique o log acima.
) else (
  echo [restaurar_banco] Concluido.
)
exit /b 0
`,
);

writeFile(
  'scripts/iniciar.bat',
  `@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

echo ============================================
echo  PontoWebDesk SaaS Demo
echo ============================================
echo.

where docker >nul 2>&1
if errorlevel 1 (
  echo ERRO: Docker nao encontrado no PATH.
  echo Instale o Docker Desktop e tente novamente.
  pause
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo ERRO: Docker Desktop nao esta em execucao.
  echo Abra o Docker Desktop, aguarde ficar "Running" e rode de novo.
  pause
  exit /b 1
)

echo [iniciar] docker compose up -d --build
docker compose up -d --build
if errorlevel 1 (
  echo Falha ao subir os containers.
  pause
  exit /b 1
)

echo [iniciar] Aguardando servicos (25s)...
timeout /t 25 /nobreak >nul

echo [iniciar] Abrindo http://localhost:3010
start "" "http://localhost:3010"

echo.
echo Frontend: http://localhost:3010
echo API:      http://localhost:3000/api/health
echo.
echo Se o banco estiver vazio, rode: scripts\\restaurar_banco.bat
echo.
pause
`,
);

writeFile(
  'scripts/parar.bat',
  `@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
echo [parar] docker compose down
docker compose down
echo Concluido.
pause
`,
);

writeFile(
  'database/README.md',
  `# Banco de dados — SaaS Demo

## Motor detectado

- **PostgreSQL 16** (mesmo motor do ambiente local do projeto: \`backend/.env.development\` apontava para \`127.0.0.1:55432\`).

## Arquivo de backup

- \`backup_demo.sql\` — dump em SQL texto (\`pg_dump -F p\`).

## Como restaurar

1. Com Docker Desktop ligado, na pasta \`SaaS-Demo\`:

\`\`\`bat
scripts\\restaurar_banco.bat
\`\`\`

Isso sobe o serviço \`postgres\` e aplica o SQL via \`psql\`.

2. Manualmente:

\`\`\`bat
docker compose up -d postgres
type database\\backup_demo.sql | docker compose exec -T postgres psql -U postgres -d pontowebdesk
\`\`\`

## Como regenerar o backup (máquina de origem)

\`\`\`bat
scripts\\exportar_backup.bat
\`\`\`

Ajuste \`PGHOST\`/\`PGPORT\` no BAT se o Postgres local usar outra porta (ex.: 55432).

## Credenciais do compose

| Item | Valor |
|------|--------|
| User | postgres |
| Password | postgres |
| Database | pontowebdesk |
| Porta no host | 5432 |
`,
);

writeFile(
  'README.md',
  `# PontoWebDesk — SaaS Demo (portátil)

Pacote **independente** para demonstração em qualquer PC com **Docker Desktop**.

## Pré-requisitos

1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado e em execução (Linux engine).
2. Portas livres no host: **3010** (frontend), **3000** (API), **5432** (PostgreSQL).
3. ~4 GB livres (imagens Node + Postgres + build).

## Como iniciar

1. Copie a pasta \`SaaS-Demo\` para o HD/pendrive.
2. Abra \`SaaS-Demo\` no Explorer.
3. Dê duplo clique em \`scripts\\iniciar.bat\`.

O script executa \`docker compose up -d --build\`, aguarda os serviços e abre **http://localhost:3010**.

### URLs

| Serviço | URL |
|---------|-----|
| Frontend | http://localhost:3010 |
| API health | http://localhost:3000/api/health |

### Credenciais Master (demo)

- \`owner1@demo.local\` / \`DemoOwner1!\`
- \`owner2@demo.local\` / \`DemoOwner2!\`

(Defina/altere em \`.env\` e \`backend/.env\` se quiser.)

## Como restaurar o banco

Se a aplicação subir sem dados (ou após volume limpo):

\`\`\`bat
scripts\\restaurar_banco.bat
\`\`\`

Detalhes: \`database/README.md\`.

Para gerar um dump novo a partir do PC de desenvolvimento:

\`\`\`bat
scripts\\exportar_backup.bat
\`\`\`

## Como parar

\`\`\`bat
scripts\\parar.bat
\`\`\`

Equivale a \`docker compose down\` (mantém o volume do Postgres, salvo se você usar \`down -v\`).

## Estrutura

\`\`\`
SaaS-Demo/
  backend/          # API Express
  frontend/         # App Vite/React
  shared/           # @pontowebdesk/master-contract
  database/         # backup SQL + README
  scripts/          # iniciar / parar / restaurar / exportar
  docker-compose.yml
  .env
  README.md
\`\`\`

## Notas

- Este pacote **não depende** da pasta original do repositório.
- \`node_modules\`, \`dist\`, \`.git\` e caches **não** são incluídos — o Compose instala deps no build da imagem.
- Uso exclusivo para **demonstração**; não é hardening de produção.
`,
);

// Manifest
const manifest = {
  generatedAt: new Date().toISOString(),
  database: dbInfo,
  copiedCount: copied.length,
  skippedCount: skipped.length,
  copied: copied.sort(),
  skipped: skipped.slice(0, 500),
};
writeFile('_MANIFEST.json', JSON.stringify(manifest, null, 2));

console.log('[pack] OK');
console.log(JSON.stringify({ copied: copied.length, skipped: skipped.length, database: dbInfo, dest: DEST }, null, 2));
