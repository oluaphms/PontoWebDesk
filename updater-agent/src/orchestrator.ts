import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from './logger.js';
import type {
  BackupManager,
  ControlPlaneClient,
  Downloader,
  HealthChecker,
  Installer,
  OrchestratorResult,
  ReportStage,
  SignatureVerifier,
} from './types.js';

export type OrchestratorDeps = {
  client: ControlPlaneClient;
  downloader: Downloader;
  verifier: SignatureVerifier;
  backup: BackupManager;
  installer: Installer;
  health: HealthChecker;
  stagingDir: string;
};

async function report(
  client: ControlPlaneClient,
  executionId: string,
  executionToken: string,
  stage: ReportStage,
  extra: {
    currentVersion?: string | null;
    message?: string;
    errorCode?: string;
    health?: Parameters<ControlPlaneClient['report']>[0]['health'];
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  await client.report({
    executionId,
    executionToken,
    stage,
    currentVersion: extra.currentVersion,
    message: extra.message,
    errorCode: extra.errorCode,
    health: extra.health,
    metadata: extra.metadata,
  });
}

/**
 * Ciclo completo do Updater:
 * heartbeat → claim → download → verify → backup → install → restart → health
 * Em falha após backup: rollback automático + report.
 * Nada disso roda no navegador.
 */
export async function runOnce(deps: OrchestratorDeps): Promise<OrchestratorResult> {
  const { client, downloader, verifier, backup, installer, health, stagingDir } = deps;

  const beat = await client.heartbeat();
  if (!beat.availableRequest) {
    logger.debug('Nenhuma solicitação aprovada disponível');
    return { status: 'idle' };
  }

  logger.info('Solicitação disponível', {
    requestId: beat.availableRequest.requestId,
    kind: beat.availableRequest.kind,
    targetVersion: beat.availableRequest.targetVersion,
  });

  const execution = await client.claim();
  if (!execution) {
    logger.warn('Claim retornou vazio apesar do heartbeat');
    return { status: 'idle' };
  }

  const { executionId, executionToken, release, kind, requestId, targetVersion } = execution;
  let backupId: string | null = null;
  const workDir = join(stagingDir, executionId);

  try {
    await mkdir(workDir, { recursive: true });

    await report(client, executionId, executionToken, 'downloading', {
      message: `Baixando ${release.version}`,
      metadata: { artifactUrl: release.artifactUrl },
    });
    const downloaded = await downloader.download(release, workDir);

    await report(client, executionId, executionToken, 'verified', {
      message: 'Validando assinatura e checksum',
    });
    await verifier.verify(downloaded.filePath, release);

    const bak = await backup.backup(targetVersion);
    backupId = bak.backupId;
    await report(client, executionId, executionToken, 'backup_completed', {
      message: 'Backup pré-update concluído',
      metadata: { backupId },
    });

    await report(client, executionId, executionToken, 'installing', {
      message: `Instalando ${targetVersion}`,
    });
    await installer.install(downloaded.filePath, release);

    await report(client, executionId, executionToken, 'restarting', {
      message: 'Reiniciando serviços',
    });
    await installer.restartServices();

    await report(client, executionId, executionToken, 'health_check', {
      message: 'Validando health pós-restart',
    });
    const healthResult = await health.waitHealthy(targetVersion);
    if (healthResult.status !== 'healthy') {
      throw Object.assign(new Error('HEALTH_CHECK_FAILED'), {
        code: 'HEALTH_CHECK_FAILED',
        health: healthResult,
      });
    }

    const currentVersion = await health.currentVersion();
    await report(client, executionId, executionToken, 'completed', {
      currentVersion,
      message:
        kind === 'rollback'
          ? `Rollback concluído em ${targetVersion}`
          : `Atualização concluída em ${targetVersion}`,
      health: healthResult,
    });

    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    return { status: 'completed', requestId, version: targetVersion };
  } catch (error) {
    const errorCode =
      (error as { code?: string }).code ||
      (error instanceof Error ? error.message : 'UPDATE_FAILED');
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Falha na atualização — iniciando rollback', {
      error: message,
      errorCode,
      backupId,
    });

    if (backupId) {
      try {
        await report(client, executionId, executionToken, 'rolling_back', {
          message: 'Rollback automático após falha',
          errorCode,
        });
        await backup.restore(backupId);
        await installer.restartServices();
        const restoredVersion = await health.currentVersion();
        const restoredHealth = await health.waitHealthy(restoredVersion ?? '');
        await report(client, executionId, executionToken, 'failed', {
          currentVersion: restoredVersion,
          message: `Rollback aplicado após: ${message}`,
          errorCode,
          health: restoredHealth,
          metadata: { backupId, rolledBack: true },
        });
        await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
        return { status: 'rolled_back', requestId, errorCode };
      } catch (rollbackError) {
        const rbMsg = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        logger.error('Rollback falhou', { rbMsg });
        await report(client, executionId, executionToken, 'failed', {
          message: `Falha e rollback falhou: ${message} / ${rbMsg}`,
          errorCode: 'ROLLBACK_FAILED',
          metadata: { originalError: errorCode, backupId },
        }).catch(() => undefined);
        return { status: 'failed', requestId, errorCode: 'ROLLBACK_FAILED' };
      }
    }

    await report(client, executionId, executionToken, 'failed', {
      message,
      errorCode,
    }).catch(() => undefined);
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    return { status: 'failed', requestId, errorCode };
  }
}

export async function runLoop(deps: OrchestratorDeps, pollIntervalMs: number, signal?: AbortSignal): Promise<void> {
  logger.info('Updater Service iniciado', { pollIntervalMs });
  while (!signal?.aborted) {
    try {
      const result = await runOnce(deps);
      if (result.status !== 'idle') {
        logger.info('Ciclo concluído', result);
      }
    } catch (error) {
      logger.error('Erro no ciclo do updater', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, pollIntervalMs);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }
  logger.info('Updater Service encerrado');
}
