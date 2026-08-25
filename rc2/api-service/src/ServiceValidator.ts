import net from 'node:net';
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
  private readonly healthPort: number;

  constructor(
    sc: ScExecutor,
    _paths: ApiServicePaths,
    healthPort: number = API_PORT,
    private readonly options: ServiceValidatorOptions = {},
  ) {
    this.controller = new ServiceController(sc);
    this.healthPort = healthPort;
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

    if (this.options.checkPort === false) {
      checks.api_port_3000 = true;
    } else {
      checks.api_port_3000 = await probeTcpRetry('127.0.0.1', API_PORT, 30, 1000);
      if (!checks.api_port_3000) {
        errors.push(`Port ${API_PORT} not accepting connections`);
      }
    }

    if (checks.api_port_3000 && this.options.checkPort !== false) {
      for (const route of ['/api/health/live', '/api/health/ready'] as const) {
        try {
          const r = await fetchJson(this.healthPort, route);
          const key = `health_${route.replace(/\//g, '_')}`;
          checks[key] = r.status === 200;
          if (r.status !== 200) {
            errors.push(`${route} returned ${r.status}`);
          }
        } catch (e) {
          const key = `health_${route.replace(/\//g, '_')}`;
          checks[key] = false;
          errors.push(`${route}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    return { ok: errors.length === 0, errors, checks };
  }
}

async function fetchJson(port: number, route: string): Promise<{ status: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, { signal: ctrl.signal });
    return { status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

function probeTcpRetry(host: string, port: number, attempts: number, delayMs: number): Promise<boolean> {
  return (async () => {
    for (let i = 0; i < attempts; i++) {
      if (await probeTcp(host, port, 1500)) return true;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return false;
  })();
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
