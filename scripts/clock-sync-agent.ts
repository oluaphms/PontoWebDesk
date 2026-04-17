/**
 * Agente local (Node.js): sincroniza relógios cadastrados em `devices` a cada 1 minuto.
 *
 * Variáveis: `.env` e `.env.local` na raiz (este script carrega os dois; `.env.local` sobrescreve).
 *   SUPABASE_URL (ou use VITE_SUPABASE_URL — o agente replica para SUPABASE_URL se faltar)
 *   SUPABASE_SERVICE_ROLE_KEY — obrigatória; Dashboard > API > service_role (não use anon no agente)
 *
 * Opcionais: SUPABASE_TIME_LOGS_TABLE, SUPABASE_DEVICES_TABLE, SUPABASE_SYNC_LOGS_TABLE
 * Após gravar em clock_event_logs, promove para time_records (RPC rep_ingest_punch) — migração 20260416200000.
 * CLOCK_SYNC_SKIP_ESPELHO=1 desativa essa etapa.
 *
 * Uso: npm run clock-sync-agent
 */

import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../.env.local') });

const _u = (process.env.SUPABASE_URL || '').trim();
const _v = (process.env.VITE_SUPABASE_URL || '').trim();
if (!_u && _v) {
  process.env.SUPABASE_URL = _v;
}

const { runSyncCycle } = await import('../src/services/sync.service.ts');

const INTERVAL_MS = 60_000;

/** Soma contadores de promoção ao espelho de todos os dispositivos no ciclo. */
function aggregateEspelhoCycle(
  devices: Array<{
    espelho?: {
      processed: number;
      timeRecords: number;
      userNotFound: number;
      duplicate: number;
      errors: number;
    };
  }>
): {
  processed: number;
  timeRecords: number;
  userNotFound: number;
  duplicate: number;
  errors: number;
} | null {
  let processed = 0;
  let timeRecords = 0;
  let userNotFound = 0;
  let duplicate = 0;
  let errors = 0;
  let any = false;
  for (const d of devices) {
    const e = d.espelho;
    if (!e) continue;
    any = true;
    processed += e.processed;
    timeRecords += e.timeRecords;
    userNotFound += e.userNotFound;
    duplicate += e.duplicate;
    errors += e.errors;
  }
  return any ? { processed, timeRecords, userNotFound, duplicate, errors } : null;
}

function requireEnv(name: string): string {
  const v = (process.env[name] || '').trim();
  if (!v) {
    console.error(`[clock-sync-agent] Variável obrigatória ausente: ${name}`);
    process.exit(1);
  }
  return v;
}

async function tick(): Promise<void> {
  const url = requireEnv('SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const result = await runSyncCycle({
    supabase: { url, serviceKey },
  });

  if (result.devices.length === 0) {
    console.log(
      '[clock-sync-agent] Nenhum dispositivo para sincronizar (tabela `devices` vazia ou sem active=true / company_id+brand+ip válidos).'
    );
  } else {
    for (const d of result.devices) {
      if (d.ok) {
        const base = `[clock-sync-agent] OK ${d.deviceId} importados=${d.imported} dup=${d.skippedDuplicates}`;
        if (d.espelho) {
          const e = d.espelho;
          console.log(
            `${base} espelho: timeRecords=${e.timeRecords} duplicate=${e.duplicate} userNotFound=${e.userNotFound} errors=${e.errors} (processados=${e.processed})`
          );
        } else {
          console.log(base);
        }
      } else {
        console.error(`[clock-sync-agent] ERRO ${d.deviceId}: ${d.error}`);
      }
    }
  }
  const espelhoCiclo = aggregateEspelhoCycle(result.devices);
  let cicloMsg = `[clock-sync-agent] Ciclo ${result.finishedAt} — ${result.devices.length} dispositivo(s) processado(s). Próximo em ${INTERVAL_MS / 1000}s (Ctrl+C encerra).`;
  if (espelhoCiclo) {
    cicloMsg += ` Espelho (ciclo): timeRecords=${espelhoCiclo.timeRecords} duplicate=${espelhoCiclo.duplicate} userNotFound=${espelhoCiclo.userNotFound} errors=${espelhoCiclo.errors}, processados=${espelhoCiclo.processed}.`;
  }
  console.log(cicloMsg);
}

async function main(): Promise<void> {
  console.log('[clock-sync-agent] Iniciando (intervalo', INTERVAL_MS / 1000, 's)');
  await tick();
  setInterval(() => {
    tick().catch((e) => console.error('[clock-sync-agent] falha no ciclo:', e));
  }, INTERVAL_MS);
}

main().catch((e) => {
  console.error('[clock-sync-agent]', e);
  process.exit(1);
});
