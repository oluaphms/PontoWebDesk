import fs from 'node:fs';
import path from 'node:path';
import type { LayoutManifest } from '@pontowebdesk/api-runtime';

export function minimalLayoutManifest(overrides: Partial<LayoutManifest> = {}): LayoutManifest {
  return {
    manifestVersion: '1.0.0-test',
    productName: 'PontoWebDesk Professional Test',
    productVersion: '0.0.0-test',
    layout: { productFolderName: 'PontoWebDesk' },
    programData: {
      directories: {
        config: 'Config',
        logs: 'Logs',
        storage: 'Storage',
        pgdata: 'Database/pgdata',
        backups: 'Backups',
      },
    },
    components: {
      backend: {
        path: 'Backend',
        version: '1.0.0',
        requiredFiles: ['node/node.exe', 'server/dist/server.js'],
      },
      frontend: { path: 'Frontend', version: '1.0.0', requiredFiles: ['www/index.html'] },
      database: {
        path: 'Database',
        version: '16.8',
        requiredFiles: ['bin/postgres.exe'],
        binSubdir: 'bin',
        toolsSubdir: 'tools',
      },
      agent: { path: 'Agent', version: '1.0.0', requiredFiles: ['rep-agent.exe'] },
      apiService: { path: 'Bin', version: '0.0.0', requiredFiles: ['api-service-host.js'] },
      migrations: {
        path: 'Migrations',
        version: '1.0.0',
        requiredFiles: ['manifest.json'],
        migrateRunner: 'Bin/apply-installed-database.mjs',
      },
    },
    ...overrides,
  };
}

export function writeInstalledLayoutFixture(params: {
  installRoot: string;
  programDataRoot: string;
  touchFiles?: boolean;
}): void {
  const { installRoot, programDataRoot, touchFiles = false } = params;
  fs.mkdirSync(installRoot, { recursive: true });
  fs.mkdirSync(programDataRoot, { recursive: true });
  fs.writeFileSync(
    path.join(installRoot, 'layout.manifest.json'),
    `${JSON.stringify(minimalLayoutManifest(), null, 2)}\n`,
  );
  fs.writeFileSync(path.join(installRoot, 'VERSION'), '0.0.0-test\n');

  if (!touchFiles) return;

  const touch = (rel: string) => {
    const abs = path.join(installRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '');
  };
  touch('Backend/node/node.exe');
  touch('Backend/server/dist/server.js');
  touch('Bin/api-service-host.js');
  touch('Frontend/www/index.html');
  touch('Database/bin/postgres.exe');
  touch('Agent/rep-agent.exe');
  touch('Migrations/manifest.json');
  touch('Bin/apply-installed-database.mjs');
  fs.mkdirSync(path.join(programDataRoot, 'Logs'), { recursive: true });
  fs.mkdirSync(path.join(programDataRoot, 'Config', 'templates'), { recursive: true });
  fs.writeFileSync(
    path.join(programDataRoot, 'Config', 'templates', 'backend.env.default'),
    'NODE_ENV=production\nPORT=3000\n',
    'utf8',
  );
}
