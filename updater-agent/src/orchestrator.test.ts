// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { runOnce } from './orchestrator.js';
import type {
  BackupManager,
  ControlPlaneClient,
  Downloader,
  HealthChecker,
  Installer,
  SignatureVerifier,
} from './types.js';

function makeManifest(version = '1.2.0') {
  return {
    releaseId: 'rel_1',
    component: 'platform' as const,
    channel: 'stable' as const,
    version,
    artifactUrl: 'https://example.com/a.zip',
    sha256: 'a'.repeat(64),
    signature: null,
    signatureAlgorithm: 'sha256',
    signerKeyId: null,
    artifactSize: 10,
    rollbackReleaseId: 'rel_0',
  };
}

describe('orchestrator runOnce', () => {
  it('fica idle quando não há solicitação', async () => {
    const client: ControlPlaneClient = {
      heartbeat: async () => ({ availableRequest: null, serverTime: new Date().toISOString() }),
      claim: async () => null,
      report: async () => ({ ok: true, finished: false }),
    };
    const result = await runOnce({
      client,
      downloader: { download: async () => ({ filePath: '', size: 0 }) },
      verifier: { verify: async () => undefined },
      backup: { backup: async () => ({ backupId: '', path: '' }), restore: async () => undefined },
      installer: { install: async () => undefined, restartServices: async () => undefined },
      health: {
        waitHealthy: async () => ({ status: 'healthy' }),
        currentVersion: async () => '1.0.0',
      },
      stagingDir: '/tmp/updater-test',
    });
    expect(result.status).toBe('idle');
  });

  it('executa o fluxo completo até completed', async () => {
    const stages: string[] = [];
    const client: ControlPlaneClient = {
      heartbeat: async () => ({
        availableRequest: {
          requestId: 'upd_1',
          kind: 'update',
          targetVersion: '1.2.0',
          fromVersion: '1.1.0',
        },
        serverTime: new Date().toISOString(),
      }),
      claim: async () => ({
        requestId: 'upd_1',
        executionId: 'uex_1',
        executionToken: 'tok',
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        kind: 'update',
        fromVersion: '1.1.0',
        targetVersion: '1.2.0',
        release: makeManifest(),
      }),
      report: async (p) => {
        stages.push(p.stage);
        return { ok: true, finished: p.stage === 'completed' || p.stage === 'failed' };
      },
    };
    const downloader: Downloader = {
      download: async () => ({ filePath: '/tmp/a.zip', size: 10 }),
    };
    const verifier: SignatureVerifier = { verify: async () => undefined };
    const backup: BackupManager = {
      backup: async () => ({ backupId: 'bak_1', path: '/tmp/bak' }),
      restore: async () => undefined,
    };
    const installer: Installer = {
      install: async () => undefined,
      restartServices: async () => undefined,
    };
    const health: HealthChecker = {
      waitHealthy: async () => ({ status: 'healthy', details: {} }),
      currentVersion: async () => '1.2.0',
    };

    const result = await runOnce({
      client,
      downloader,
      verifier,
      backup,
      installer,
      health,
      stagingDir: '/tmp/updater-test-ok',
    });

    expect(result.status).toBe('completed');
    expect(stages).toEqual([
      'downloading',
      'verified',
      'backup_completed',
      'installing',
      'restarting',
      'health_check',
      'completed',
    ]);
  });

  it('faz rollback automático quando health falha', async () => {
    const stages: string[] = [];
    const restore = vi.fn(async () => undefined);
    const client: ControlPlaneClient = {
      heartbeat: async () => ({
        availableRequest: {
          requestId: 'upd_2',
          kind: 'update',
          targetVersion: '2.0.0',
          fromVersion: '1.0.0',
        },
        serverTime: new Date().toISOString(),
      }),
      claim: async () => ({
        requestId: 'upd_2',
        executionId: 'uex_2',
        executionToken: 'tok',
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        kind: 'update',
        fromVersion: '1.0.0',
        targetVersion: '2.0.0',
        release: makeManifest('2.0.0'),
      }),
      report: async (p) => {
        stages.push(p.stage);
        return { ok: true, finished: p.stage === 'failed' || p.stage === 'completed' };
      },
    };

    const result = await runOnce({
      client,
      downloader: { download: async () => ({ filePath: '/tmp/b.zip', size: 1 }) },
      verifier: { verify: async () => undefined },
      backup: { backup: async () => ({ backupId: 'bak_2', path: '/tmp/bak2' }), restore },
      installer: { install: async () => undefined, restartServices: async () => undefined },
      health: {
        waitHealthy: async (expected) =>
          expected === '2.0.0'
            ? { status: 'unhealthy', details: { error: 'boom' } }
            : { status: 'healthy' },
        currentVersion: async () => '1.0.0',
      },
      stagingDir: '/tmp/updater-test-rb',
    });

    expect(result.status).toBe('rolled_back');
    expect(restore).toHaveBeenCalledWith('bak_2');
    expect(stages).toContain('rolling_back');
    expect(stages).toContain('failed');
  });
});
