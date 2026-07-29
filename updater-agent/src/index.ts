#!/usr/bin/env node
/**
 * PontoWebDesk Updater Service
 * Agente LOCAL/HYBRID — fora do navegador.
 *
 * Comandos:
 *   node dist/index.js once   — um ciclo (heartbeat → claim → update)
 *   node dist/index.js run    — loop contínuo (serviço Windows)
 */
import { loadConfig } from './config.js';
import { createControlPlaneClient } from './controlPlaneClient.js';
import { createDownloader } from './downloader.js';
import { createSignatureVerifier } from './signatureVerifier.js';
import { createBackupManager } from './backupManager.js';
import { createInstaller } from './installer.js';
import { createHealthChecker } from './healthChecker.js';
import { configureLogFile, logger } from './logger.js';
import { runLoop, runOnce } from './orchestrator.js';

function buildDeps(config: ReturnType<typeof loadConfig>) {
  const health = createHealthChecker({
    healthUrl: config.healthUrl,
    versionFile: config.versionFile,
    timeoutMs: config.healthTimeoutMs,
    pollMs: config.healthPollMs,
  });
  const client = createControlPlaneClient(config, () => health.currentVersion());
  return {
    client,
    downloader: createDownloader(),
    verifier: createSignatureVerifier(),
    backup: createBackupManager(config.installDir, config.backupDir),
    installer: createInstaller({
      installDir: config.installDir,
      stagingDir: config.stagingDir,
      versionFile: config.versionFile,
      serviceNames: config.serviceNames,
    }),
    health,
    stagingDir: config.stagingDir,
  };
}

async function main(): Promise<void> {
  const command = (process.argv[2] ?? 'run').toLowerCase();
  const config = loadConfig();
  configureLogFile(config.logFile);
  const deps = buildDeps(config);

  if (command === 'once') {
    const result = await runOnce(deps);
    logger.info('Resultado', result);
    process.exit(result.status === 'failed' || result.status === 'rolled_back' ? 1 : 0);
  }

  if (command === 'run') {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    // node-windows / sc.exe enviam SIGINT/SIGTERM; também escuta mensagem do serviço.
    process.on('message', (msg) => {
      if (msg === 'shutdown') stop();
    });
    await runLoop(deps, config.pollIntervalMs, controller.signal);
    return;
  }

  logger.error('Comando desconhecido. Use: once | run');
  process.exit(2);
}

main().catch((error) => {
  logger.error('Updater fatal', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
