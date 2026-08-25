/**
 * Caminhos compartilhados — staging RC2 Professional (RC2.4.0).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.join(SCRIPTS_DIR, '..');

/** Artefato de staging (pré-Inno). */
export const STAGING_PRODUCT_DIR = path.join(REPO_ROOT, 'dist-installer', 'PontoWebDesk-Professional');

export const STAGING_DIRS = [
  'Backend',
  'Backend/node',
  'Backend/server',
  'Backend/shared',
  'Frontend/www',
  'Database',
  'Agent',
  'Bin',
  'Config',
  'Config/templates',
  'Migrations',
  'Bootstrap',
  'Bootstrap/dist',
];

/** Layout esperado em ProgramData após install (metadado no staging). */
export const EXPECTED_PROGRAMDATA_FILE = 'Config/expected-programdata.json';

export const COMPONENT_PATHS = {
  backend: 'Backend',
  frontend: 'Frontend',
  database: 'Database',
  agent: 'Agent',
  apiService: 'Bin',
};

export const MANIFEST_FILE = 'layout.manifest.json';
export const VERSION_FILE = 'VERSION';

/** Raízes obrigatórias para considerar o stage completo (RC2 Professional). */
export const STAGING_REQUIRED_ROOTS = [
  'Backend',
  'Frontend/www',
  'Database',
  'Agent',
  'Bin',
  'Bootstrap',
  'Migrations',
];

/** Arquivos obrigatórios na raiz do staging. */
export const STAGING_REQUIRED_FILES = [VERSION_FILE, MANIFEST_FILE];

/** Caminho padrão quando RC2_DATABASE_RUNTIME_DIR não está definido. */
export const DEFAULT_DATABASE_RUNTIME_DIR = path.join(
  REPO_ROOT,
  'rc2',
  'database-runtime-builder',
  'dist-runtime',
  'Database',
);

/** Arquivos mínimos do runtime PostgreSQL redistribuível. */
export const DATABASE_RUNTIME_REQUIRED_FILES = [
  'bin/postgres.exe',
  'VERSION',
  'manifest.json',
];

/** Arquivos críticos — verify falha e Inno Setup recusa compilar se ausentes no staging. */
export const STAGING_CRITICAL_FILES = [
  'Backend/node/node.exe',
  'Backend/server/dist/server.js',
  'Frontend/www/index.html',
  'Database/bin/postgres.exe',
  'Database/VERSION',
  'Database/manifest.json',
  'Bin/api-service-host.js',
  'Bin/serve-frontend.mjs',
  'Bin/apply-installed-database.mjs',
  'Bin/PontoWebDeskServiceHost.exe',
  'Bootstrap/dist/index.js',
  'Bootstrap/package.json',
  'Bootstrap/node_modules/@pontowebdesk/api-service/package.json',
  'Bootstrap/node_modules/@pontowebdesk/api-runtime/package.json',
  'Agent/rep-agent.exe',
  'Migrations/manifest.json',
  VERSION_FILE,
  MANIFEST_FILE,
];
