/**
 * Ponto de entrada do agente local PontoWebDesk: fila offline + sync periódico → Supabase.
 *
 * Variáveis: `.env` / `.env.local` na raiz do projeto (ver `agent/config`).
 * Uso: npm run clock-sync-agent
 */

import { loadAgentConfig, type AgentConfig } from './config';
import { OfflineQueue } from './queue';
import { AgentLogger } from './services/agentLogger';
import { aggregateEspelhoCycle, runAgentTick } from './services/syncRunner.service';

async function tick(cfg: AgentConfig): Promise<void> {
  const queue = new OfflineQueue(cfg.sqliteDbPath);
  const log = new AgentLogger(cfg.jsonLogs);

  const result = await runAgentTick(cfg, queue, log);

  if (result.devices.length === 0) {
    log.info('Nenhum dispositivo ativo para sincronizar');
  }

  // Resumo do ciclo
  const espelhoCiclo = aggregateEspelhoCycle(result.devices);
  if (espelhoCiclo) {
    log.log('info', 'agent', `Ciclo completo: ${result.devices.length} device(s), ${espelhoCiclo.timeRecords} time_records`, {
      finishedAt: result.finishedAt,
      nextInSeconds: cfg.intervalMs / 1000,
      espelho: espelhoCiclo,
    });
  } else {
    log.log('info', 'agent', `Ciclo completo: ${result.devices.length} device(s)`, {
      finishedAt: result.finishedAt,
      nextInSeconds: cfg.intervalMs / 1000,
    });
  }
}

async function main(): Promise<void> {
  const cfg = loadAgentConfig();
  const log = new AgentLogger(cfg.jsonLogs);

  log.configLoaded({
    intervalSeconds: cfg.intervalMs / 1000,
    sqliteDbPath: cfg.sqliteDbPath,
    apiMode: !!cfg.apiBaseUrl,
    logMode: cfg.jsonLogs ? 'json' : 'text',
  });

  log.connOk(`Agente iniciado - próximo ciclo em ${cfg.intervalMs / 1000}s`);

  await tick(cfg);
  setInterval(() => {
    tick(cfg).catch((e) => {
      const logErr = new AgentLogger(cfg.jsonLogs);
      logErr.error(`falha no ciclo: ${e instanceof Error ? e.message : String(e)}`, {
        stack: e instanceof Error ? e.stack : undefined,
      });
    });
  }, cfg.intervalMs);
}

main().catch((e) => {
  const log = new AgentLogger(false); // Force text mode for final error
  log.error(`FATAL: ${e instanceof Error ? e.message : String(e)}`, {
    stack: e instanceof Error ? e.stack : undefined,
  });
  process.exit(1);
});
