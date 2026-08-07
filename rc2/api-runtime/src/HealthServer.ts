import http from 'node:http';
import type { RuntimeValidationResult } from './types.js';

export interface HealthServerOptions {
  port: number;
  productVersion: string;
  getValidation: () => Promise<RuntimeValidationResult> | RuntimeValidationResult;
}

export class HealthServer {
  private server: http.Server | null = null;

  constructor(private readonly options: HealthServerOptions) {}

  getPort(): number {
    return this.options.port;
  }

  async start(): Promise<void> {
    if (this.server) return;

    this.server = http.createServer(async (req, res) => {
      const url = req.url?.split('?')[0] ?? '/';
      try {
        if (url === '/api/health/live') {
          json(res, 200, { status: 'live' });
          return;
        }
        if (url === '/api/version') {
          json(res, 200, {
            product: 'PontoWebDesk',
            component: 'api-runtime',
            version: this.options.productVersion,
          });
          return;
        }
        if (url === '/api/health/ready') {
          const validation = await this.options.getValidation();
          if (validation.ok) {
            json(res, 200, { status: 'ready', warnings: validation.warnings.length });
          } else {
            json(res, 503, {
              status: 'not_ready',
              errors: validation.errors,
            });
          }
          return;
        }
        json(res, 404, { error: 'not_found' });
      } catch (e) {
        json(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.options.port, '127.0.0.1', () => resolve());
      this.server!.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server!.close((err) => (err ? reject(err) : resolve()));
    });
    this.server = null;
  }
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(`${JSON.stringify(body)}\n`);
}

export async function fetchHealthJson(
  port: number,
  path: string,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: data });
        }
      });
    });
    req.on('error', reject);
  });
}
