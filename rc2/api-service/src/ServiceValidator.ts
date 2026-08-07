import net from 'node:net';
import { fetchHealthJson } from '@pontowebdesk/api-runtime';
import { API_PORT, SERVICE_NAME, type ApiServicePaths } from './ServiceConfig.js';
import { ServiceController } from './ServiceController.js';
import type { ScExecutor } from './scExec.js';

export interface ServiceValidationResult {
  ok: boolean;
  errors: string[];
  checks: Record<string, boolean>;
}

export interface ServiceValidatorOptions {
  checkPort?: boolean;
}

export class ServiceValidator {
  private readonly controller: ServiceController;

  constructor(
    sc: ScExecutor,
    _paths: ApiServicePaths,
    private readonly healthPort: number,
    private readonly options: ServiceValidatorOptions = {},
  ) {
    this.controller = new ServiceController(sc);
  }

  async validate(): Promise<ServiceValidationResult> {
    const errors: string[] = [];
    const checks: Record<string, boolean> = {};

    const status = this.controller.query();
    checks.service_installed = status.installed;
    if (!status.installed) {
      errors.push(`${SERVICE_NAME} not installed`);
    }

    checks.service_running = status.state === 'RUNNING';
    if (status.installed && status.state !== 'RUNNING') {
      errors.push(`Service state: ${status.state}`);
    }

    checks.api_port_3000 = await probeTcp('127.0.0.1', API_PORT, 1500);
    if (this.options.checkPort !== false && !checks.api_port_3000) {
      errors.push(`Port ${API_PORT} not accepting connections`);
    }

    for (const route of ['/api/health/live', '/api/health/ready', '/api/version'] as const) {
      try {
        const r = await fetchHealthJson(this.healthPort, route);
        const key = `health_${route.replace(/\//g, '_')}`;
        checks[key] = r.status >= 200 && r.status < 500;
        if (route === '/api/health/ready' && r.status !== 200) {
          errors.push(`Ready check failed: ${r.status}`);
          checks[key] = false;
        }
        if (route !== '/api/health/ready' && r.status !== 200) {
          errors.push(`${route} returned ${r.status}`);
          checks[key] = false;
        }
      } catch (e) {
        const key = `health_${route.replace(/\//g, '_')}`;
        checks[key] = false;
        errors.push(`${route}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return { ok: errors.length === 0, errors, checks };
  }
}

function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}
