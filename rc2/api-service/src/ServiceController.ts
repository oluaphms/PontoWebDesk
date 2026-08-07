import { SERVICE_NAME } from './ServiceConfig.js';
import { netExecutor, parseScQueryState, type ScExecutor } from './scExec.js';

export type ServiceRunState = 'RUNNING' | 'STOPPED' | 'NOT_INSTALLED' | 'UNKNOWN';

export interface ServiceStatus {
  installed: boolean;
  state: ServiceRunState;
  raw?: string;
}

export class ServiceController {
  constructor(private readonly sc: ScExecutor) {}

  query(): ServiceStatus {
    const r = this.sc(['query', SERVICE_NAME]);
    if (r.exitCode !== 0 || /1060/.test(r.stdout + r.stderr)) {
      return { installed: false, state: 'NOT_INSTALLED', raw: r.stdout + r.stderr };
    }
    const parsed = parseScQueryState(r.stdout);
    let state: ServiceRunState = 'UNKNOWN';
    if (parsed === 'RUNNING') state = 'RUNNING';
    else if (parsed === 'STOPPED') state = 'STOPPED';
    return { installed: true, state, raw: r.stdout };
  }

  start(): { ok: boolean; message: string } {
    const q = this.query();
    if (!q.installed) return { ok: false, message: 'SERVICE_NOT_INSTALLED' };
    if (q.state === 'RUNNING') return { ok: true, message: 'ALREADY_RUNNING' };
    const r = netExecutor('start', SERVICE_NAME);
    if (r.exitCode !== 0) {
      const scStart = this.sc(['start', SERVICE_NAME]);
      if (scStart.exitCode !== 0) {
        return { ok: false, message: scStart.stderr || scStart.stdout || r.stderr };
      }
    }
    return { ok: true, message: 'STARTED' };
  }

  stop(): { ok: boolean; message: string } {
    const q = this.query();
    if (!q.installed) return { ok: false, message: 'SERVICE_NOT_INSTALLED' };
    if (q.state === 'STOPPED') return { ok: true, message: 'ALREADY_STOPPED' };
    const r = netExecutor('stop', SERVICE_NAME);
    if (r.exitCode !== 0) {
      const scStop = this.sc(['stop', SERVICE_NAME]);
      if (scStop.exitCode !== 0) {
        return { ok: false, message: scStop.stderr || scStop.stdout || r.stderr };
      }
    }
    return { ok: true, message: 'STOPPED' };
  }

  restart(): { ok: boolean; message: string } {
    const s = this.stop();
    if (!s.ok && s.message !== 'ALREADY_STOPPED') return s;
    return this.start();
  }
}
