import { spawnSync } from 'node:child_process';

export function netStopService(serviceName: string): { ok: boolean; message: string } {
  if (process.platform !== 'win32') {
    return { ok: true, message: 'SKIP_NON_WIN32' };
  }
  const r = spawnSync('net', ['stop', serviceName], {
    encoding: 'utf8',
    windowsHide: true,
    shell: true,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status === 0) return { ok: true, message: 'STOPPED' };
  if (/1060|1062|has not been started/i.test(out)) {
    return { ok: true, message: 'NOT_RUNNING' };
  }
  return { ok: false, message: out.trim() || `exit ${r.status}` };
}

export const WINDOWS_SERVICE_NAMES = {
  postgresql: 'PontoWebDeskPostgreSQL',
  api: 'PontoWebDeskApi',
  web: 'PontoWebDeskFrontend',
  repAgent: 'PontoWebDeskAgent',
} as const;
