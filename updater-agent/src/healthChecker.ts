import { existsSync, readFileSync } from 'node:fs';
import type { AgentHealth, HealthChecker } from './types.js';
import { logger } from './logger.js';
import { compareSemver } from './semver.js';

export function createHealthChecker(options: {
  healthUrl: string;
  versionFile: string;
  timeoutMs: number;
  pollMs: number;
}): HealthChecker {
  return {
    async currentVersion() {
      if (!existsSync(options.versionFile)) return null;
      const value = readFileSync(options.versionFile, 'utf8').trim().split(/\r?\n/)[0] ?? '';
      return value || null;
    },

    async waitHealthy(expectedVersion) {
      const deadline = Date.now() + options.timeoutMs;
      let lastError = 'HEALTH_TIMEOUT';

      while (Date.now() < deadline) {
        try {
          const response = await fetch(options.healthUrl, {
            signal: AbortSignal.timeout(5_000),
          });
          const text = await response.text();
          let json: Record<string, unknown> = {};
          try {
            json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
          } catch {
            json = {};
          }

          if (!response.ok) {
            lastError = `HEALTH_HTTP_${response.status}`;
          } else {
            const status = String(json.status ?? '').toLowerCase();
            const ready = status === 'ok' || status === 'healthy' || status === 'ready';
            const current = await this.currentVersion();
            const versionOk =
              !expectedVersion ||
              (current != null && compareSemver(current, expectedVersion) === 0);

            if (ready && versionOk) {
              const health: AgentHealth = {
                status: 'healthy',
                details: {
                  healthUrl: options.healthUrl,
                  currentVersion: current,
                  expectedVersion,
                  response: json,
                },
              };
              logger.info('Health OK', health.details);
              return health;
            }
            lastError = versionOk ? 'HEALTH_NOT_READY' : 'VERSION_MISMATCH_AFTER_INSTALL';
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
        await new Promise((r) => setTimeout(r, options.pollMs));
      }

      return {
        status: 'unhealthy',
        details: { error: lastError, expectedVersion, healthUrl: options.healthUrl },
      };
    },
  };
}
