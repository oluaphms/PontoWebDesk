import http from 'node:http';
import net from 'node:net';
import {
  FRONTEND_HOST,
  FRONTEND_PORT,
  FRONTEND_SERVICE_NAME,
  type FrontendServicePaths,
} from './FrontendServiceConfig.js';
import { FrontendServiceController } from './FrontendServiceController.js';
import type { ScExecutor } from '../scExec.js';

export interface FrontendServiceValidationResult {
  ok: boolean;
  errors: string[];
  checks: Record<string, boolean>;
}

export interface FrontendServiceValidatorOptions {
  host?: string;
  port?: number;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
}

export class FrontendServiceValidator {
  private readonly controller: FrontendServiceController;
  private readonly host: string;
  private readonly port: number;
  private readonly waitTimeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(
    sc: ScExecutor,
    _paths: FrontendServicePaths,
    options: FrontendServiceValidatorOptions = {},
  ) {
    this.controller = new FrontendServiceController(sc);
    this.host = options.host ?? FRONTEND_HOST;
    this.port = options.port ?? FRONTEND_PORT;
    this.waitTimeoutMs = options.waitTimeoutMs ?? 60_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
  }

  async waitForReady(): Promise<FrontendServiceValidationResult> {
    const deadline = Date.now() + this.waitTimeoutMs;
    let last: FrontendServiceValidationResult = {
      ok: false,
      errors: ['not started'],
      checks: {},
    };
    while (Date.now() < deadline) {
      last = await this.validateOnce();
      if (last.ok) return last;
      await sleep(this.pollIntervalMs);
    }
    return {
      ok: false,
      errors: [...last.errors, `timeout after ${this.waitTimeoutMs}ms waiting for frontend`],
      checks: last.checks,
    };
  }

  async validateOnce(): Promise<FrontendServiceValidationResult> {
    const errors: string[] = [];
    const checks: Record<string, boolean> = {};

    const status = this.controller.query();
    checks.service_installed = status.installed;
    if (!status.installed) {
      errors.push(`${FRONTEND_SERVICE_NAME} not installed`);
    }

    checks.service_running = status.state === 'RUNNING';
    if (status.installed && status.state !== 'RUNNING') {
      errors.push(`Service state: ${status.state}`);
    }

    checks.tcp_3010 = await probeTcp(this.host, this.port, 1500);
    if (!checks.tcp_3010) {
      errors.push(`Port ${this.port} not accepting connections`);
    }

    if (checks.tcp_3010) {
      const httpOk = await probeHttpOk(this.host, this.port, '/');
      checks.http_root_200 = httpOk;
      if (!httpOk) {
        errors.push(`GET http://${this.host}:${this.port}/ did not return 2xx`);
      }
    } else {
      checks.http_root_200 = false;
    }

    return { ok: errors.length === 0, errors, checks };
  }

  async validate(): Promise<FrontendServiceValidationResult> {
    return this.waitForReady();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

function probeHttpOk(host: string, port: number, reqPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: reqPath, timeout: 5000 }, (res) => {
      res.resume();
      resolve(res.statusCode != null && res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}
