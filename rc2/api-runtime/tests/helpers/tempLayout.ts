import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ApiRuntimePaths } from '../../src/types.ts';
import { defaultApiRuntimePaths } from '../../src/paths.ts';

export function createTempLayout(partial?: Partial<{
  withBackend: boolean;
  withEnv: boolean;
  envContent: string;
  withStorage: boolean;
}>): { root: string; paths: ApiRuntimePaths; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-api-rt-'));
  const pf = path.join(root, 'PF', 'PontoWebDesk');
  const pd = path.join(root, 'PD', 'PontoWebDesk');

  const backendRoot = path.join(pf, 'Backend');
  const entry = path.join(backendRoot, 'server', 'dist', 'server.js');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  if (partial?.withBackend !== false) {
    fs.writeFileSync(entry, '// mock server\n', 'utf8');
    fs.mkdirSync(path.join(backendRoot, 'node'), { recursive: true });
    fs.writeFileSync(path.join(backendRoot, 'node', 'node.exe'), '', 'utf8');
  }

  fs.mkdirSync(path.join(pd, 'Config'), { recursive: true });
  fs.mkdirSync(path.join(pd, 'Logs'), { recursive: true });

  const envBody =
    partial?.envContent ??
    `PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=pontowebdesk
DATABASE_URL=postgresql://u:p@127.0.0.1:5432/pontowebdesk
`;

  if (partial?.withEnv !== false) {
    fs.writeFileSync(path.join(pd, 'Config', 'backend.env'), envBody, 'utf8');
  }

  if (partial?.withStorage !== false) {
    fs.mkdirSync(path.join(pd, 'Storage', 'uploads'), { recursive: true });
  }

  fs.writeFileSync(
    path.join(pf, 'layout.manifest.json'),
    `${JSON.stringify(
      {
        manifestVersion: '1.0.0-test',
        productName: 'Test',
        productVersion: '0.0.0',
        programData: {
          directories: {
            config: 'Config',
            logs: 'Logs',
            storage: 'Storage',
            pgdata: 'Database/pgdata',
          },
        },
        components: {
          backend: { path: 'Backend', version: '1', requiredFiles: [] },
          frontend: { path: 'Frontend', version: '1', requiredFiles: [] },
          database: { path: 'Database', version: '16.8', requiredFiles: [], binSubdir: 'bin', toolsSubdir: 'tools' },
          agent: { path: 'Agent', version: '1', requiredFiles: [] },
          apiService: { path: 'Bin', version: '1', requiredFiles: [] },
        },
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(path.join(pf, 'VERSION'), '0.0.0\n');

  const paths = defaultApiRuntimePaths({
    programFilesRoot: pf,
    programDataRoot: pd,
  });

  return {
    root,
    paths,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
