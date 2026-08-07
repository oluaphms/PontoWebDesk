/**
 * Caminhos compartilhados — staging RC2 Professional (RC2.4.0).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.join(SCRIPTS_DIR, '..');

/** Artefato de staging (pré-Inno). */
export const STAGING_PRODUCT_DIR = path.join(REPO_ROOT, 'dist-installer', 'PontoWebDesk-Professional');

const STAGING_DIRS = [
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
