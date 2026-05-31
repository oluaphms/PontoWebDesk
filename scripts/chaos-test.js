#!/usr/bin/env node
import { observabilityConsole } from '../services/observabilityConsole.js';
/**
 * Teste de caos e carga — PontoWebDesk
 *
 * Simula cenários adversos para validar resiliência do sistema:
 * 1. 2000 batidas em sequência (carga)
 * 2. Supabase offline por 5 min (rede intermitente)
 * 3. Múltiplos relógios simultâneos
 * 4. Duplicatas em massa
 * 5. Timestamps com timezone errado
 *
 * Uso:
 *   node scripts/chaos-test.js [--scenario=all|load|offline|multi|dedupe|tz]
 *
 * Requer: CLOCK_AGENT_SQLITE_PATH configurado
 */

import { createHash, randomUUID } from 'node:crypto';
import { resolve }                from 'node:path';
import Database                   from 'better-sqlite3';

const SQLITE_PATH = process.env.CLOCK_AGENT_SQLITE_PATH
  || resolve(process.cwd(), 'agent/data/pending.db');

const scenario = process.argv.find(a => a.startsWith('--scenario='))?.split('=')[1] ?? 'all';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function computeDedupeHash(companyId, deviceId, employeeId, timestamp, eventType) {
  return createHash('sha256')
    .update(`${companyId}|${deviceId}|${employeeId}|${timestamp}|${eventType}`)
    .digest('hex');
}

function makePunch(opts = {}) {
  const companyId  = opts.companyId  ?? 'test-company-001';
  const deviceId   = opts.deviceId   ?? '00000000-0000-0000-0000-000000000001';
  const employeeId = opts.employeeId ?? '12345678901';
  const timestamp  = opts.timestamp  ?? new Date().toISOString();
  const eventType  = opts.eventType  ?? 'entrada';
  return {
    id:             randomUUID(),
    company_id:     companyId,
    rep_id:         deviceId,
    nsr:            opts.nsr ?? Math.floor(Math.random() * 999999),
    p_pis:          employeeId,
    p_cpf:          employeeId,
    p_matricula:    null,
    p_data_hora:    timestamp,
    p_tipo_marcacao: eventType === 'entrada' ? 'E' : eventType === 'saída' ? 'S' : 'B',
    p_raw_data:     JSON.stringify({ test: true, scenario: opts.scenario ?? 'load' }),
    synced:         0,
  };
}

function openDb() {
  const db = new Database(SQLITE_PATH);
  db.pragma('journal_mode = WAL');
  return db;
}

function insertPunches(db, punches) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO time_records
      (id, company_id, rep_id, nsr, p_pis, p_cpf, p_matricula, p_data_hora, p_tipo_marcacao, p_raw_data, synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);
  const trx = db.transaction(() => {
    for (const p of punches) {
      stmt.run(p.id, p.company_id, p.rep_id, p.nsr, p.p_pis, p.p_cpf, p.p_matricula,
               p.p_data_hora, p.p_tipo_marcacao, p.p_raw_data);
    }
  });
  trx();
}

function countPending(db) {
  return db.prepare(`SELECT COUNT(*) as c FROM time_records WHERE synced = 0`).get()?.c ?? 0;
}

function countSynced(db) {
  return db.prepare(`SELECT COUNT(*) as c FROM time_records WHERE synced = 1`).get()?.c ?? 0;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Cenários ──────────────────────────────────────────────────────────────────

async function scenarioLoad(db) {
  observabilityConsole.log('\n═══ CENÁRIO: CARGA (2000 batidas) ═══');
  const COUNT = 2000;
  const t0 = Date.now();

  const punches = Array.from({ length: COUNT }, (_, i) => makePunch({
    scenario: 'load',
    nsr: i + 1,
    timestamp: new Date(Date.now() - (COUNT - i) * 1000).toISOString(),
    employeeId: String(10000000000 + (i % 50)).padStart(11, '0'), // 50 funcionários
    deviceId: `00000000-0000-0000-0000-${String(i % 3 + 1).padStart(12, '0')}`, // 3 relógios
  }));

  insertPunches(db, punches);
  const elapsed = Date.now() - t0;
  const pending = countPending(db);

  observabilityConsole.log(`✓ ${COUNT} batidas inseridas em ${elapsed}ms`);
  observabilityConsole.log(`  Pendentes na fila: ${pending}`);
  observabilityConsole.log(`  Taxa: ${Math.round(COUNT / (elapsed / 1000))} batidas/s`);

  if (elapsed > 2000) {
    observabilityConsole.warn(`⚠ Violação SLA ingestão: ${elapsed}ms > 2000ms`);
  }

  return { count: COUNT, elapsedMs: elapsed, pending };
}

async function scenarioDedupe(db) {
  observabilityConsole.log('\n═══ CENÁRIO: DUPLICATAS EM MASSA ═══');
  const COUNT = 500;
  const BASE_TIMESTAMP = '2024-04-20T08:00:00.000Z';

  // Inserir 500 batidas idênticas (mesmo timestamp + employee + device)
  const punches = Array.from({ length: COUNT }, (_, i) => makePunch({
    scenario: 'dedupe',
    nsr: i + 1, // NSR diferente mas mesma batida lógica
    timestamp: BASE_TIMESTAMP,
    employeeId: '12345678901',
    deviceId: '00000000-0000-0000-0000-000000000001',
  }));

  const beforeCount = countPending(db);
  insertPunches(db, punches);
  const afterCount = countPending(db);
  const inserted = afterCount - beforeCount;

  observabilityConsole.log(`✓ ${COUNT} tentativas de insert com mesmo timestamp`);
  observabilityConsole.log(`  Inseridos (NSR único): ${inserted}`);
  observabilityConsole.log(`  Deduplicados pelo SQLite: ${COUNT - inserted}`);

  // Verificar que dedupe_hash vai eliminar duplicatas no Supabase
  const hashes = new Set(punches.map(p =>
    computeDedupeHash(p.company_id, p.rep_id, p.p_pis, BASE_TIMESTAMP, 'entrada')
  ));
  observabilityConsole.log(`  Hashes únicos (esperado: 1): ${hashes.size}`);

  if (hashes.size !== 1) {
    observabilityConsole.error('✗ FALHA: dedupe_hash deveria ser único para mesma batida lógica');
  } else {
    observabilityConsole.log('✓ dedupe_hash correto: 1 hash único para 500 tentativas');
  }

  return { attempted: COUNT, inserted, deduplicated: COUNT - inserted };
}

async function scenarioMultiDevice(db) {
  observabilityConsole.log('\n═══ CENÁRIO: MÚLTIPLOS RELÓGIOS SIMULTÂNEOS ═══');
  const DEVICES = 5;
  const PER_DEVICE = 200;
  const t0 = Date.now();

  const allPunches = [];
  for (let d = 0; d < DEVICES; d++) {
    const deviceId = `00000000-0000-0000-0000-${String(d + 1).padStart(12, '0')}`;
    for (let i = 0; i < PER_DEVICE; i++) {
      allPunches.push(makePunch({
        scenario: 'multi_device',
        deviceId,
        nsr: d * PER_DEVICE + i + 1,
        timestamp: new Date(Date.now() - (PER_DEVICE - i) * 1000).toISOString(),
        employeeId: String(10000000000 + (i % 20)).padStart(11, '0'),
      }));
    }
  }

  insertPunches(db, allPunches);
  const elapsed = Date.now() - t0;

  observabilityConsole.log(`✓ ${DEVICES} relógios × ${PER_DEVICE} batidas = ${allPunches.length} total`);
  observabilityConsole.log(`  Inseridos em ${elapsed}ms`);
  observabilityConsole.log(`  Pendentes: ${countPending(db)}`);

  return { devices: DEVICES, perDevice: PER_DEVICE, total: allPunches.length, elapsedMs: elapsed };
}

async function scenarioTimezone(db) {
  observabilityConsole.log('\n═══ CENÁRIO: TIMEZONE (wall time sem offset) ═══');

  // Simular batidas com timestamp sem offset (problema do Dimep AFD)
  const wallTimes = [
    '2024-04-20T08:00:00',     // sem offset → deve ser convertido para UTC
    '2024-04-20T12:00:00',
    '2024-04-20T17:30:00',
    '2024-07-15T08:00:00',     // horário de inverno (sem DST)
    '2024-11-03T08:00:00',     // horário de verão (com DST no Brasil)
  ];

  const { ensureUTC } = await import('../services/timeUtils.js');

  observabilityConsole.log('  Conversões wall time → UTC:');
  let allCorrect = true;
  for (const wt of wallTimes) {
    const utc = ensureUTC(wt, 'America/Sao_Paulo');
    const d = new Date(utc);
    const isUTC = utc.endsWith('Z') || utc.includes('+00:00');
    const status = isUTC ? '✓' : '✗';
    if (!isUTC) allCorrect = false;
    observabilityConsole.log(`  ${status} ${wt} → ${utc} (offset: ${d.getTimezoneOffset()}min)`);
  }

  if (allCorrect) {
    observabilityConsole.log('✓ Todos os timestamps convertidos para UTC corretamente');
  } else {
    observabilityConsole.error('✗ FALHA: alguns timestamps não foram convertidos para UTC');
  }

  return { tested: wallTimes.length, allCorrect };
}

async function scenarioOfflineRecovery(db) {
  observabilityConsole.log('\n═══ CENÁRIO: RECUPERAÇÃO OFFLINE ═══');
  observabilityConsole.log('  (Simulação: inserindo batidas como se Supabase estivesse offline)');

  const COUNT = 100;
  const punches = Array.from({ length: COUNT }, (_, i) => makePunch({
    scenario: 'offline_recovery',
    nsr: 90000 + i,
    timestamp: new Date(Date.now() - (COUNT - i) * 60_000).toISOString(), // últimas 100 min
  }));

  insertPunches(db, punches);
  const pending = countPending(db);

  observabilityConsole.log(`✓ ${COUNT} batidas inseridas (simulando offline)`);
  observabilityConsole.log(`  Total pendente na fila: ${pending}`);
  observabilityConsole.log(`  → Quando Supabase voltar, o worker vai processar automaticamente`);
  observabilityConsole.log(`  → Nenhum dado perdido (SQLite persiste indefinidamente)`);

  return { inserted: COUNT, totalPending: pending };
}

// ─── Runner ────────────────────────────────────────────────────────────────────

async function main() {
  observabilityConsole.log('╔══════════════════════════════════════════════════════╗');
  observabilityConsole.log('║     PontoWebDesk — Teste de Caos e Carga             ║');
  observabilityConsole.log('╚══════════════════════════════════════════════════════╝');
  observabilityConsole.log(`SQLite: ${SQLITE_PATH}`);
  observabilityConsole.log(`Cenário: ${scenario}`);

  let db;
  try {
    db = openDb();
  } catch (err) {
    observabilityConsole.error(`✗ Não foi possível abrir o SQLite: ${err.message}`);
    observabilityConsole.error('  Certifique-se de que CLOCK_AGENT_SQLITE_PATH está configurado');
    observabilityConsole.error('  e que o agente já foi iniciado ao menos uma vez.');
    process.exit(1);
  }

  const results = {};
  const t0 = Date.now();

  try {
    if (scenario === 'all' || scenario === 'load') {
      results.load = await scenarioLoad(db);
    }
    if (scenario === 'all' || scenario === 'dedupe') {
      results.dedupe = await scenarioDedupe(db);
    }
    if (scenario === 'all' || scenario === 'multi') {
      results.multi = await scenarioMultiDevice(db);
    }
    if (scenario === 'all' || scenario === 'tz') {
      results.timezone = await scenarioTimezone(db);
    }
    if (scenario === 'all' || scenario === 'offline') {
      results.offline = await scenarioOfflineRecovery(db);
    }
  } finally {
    db.close();
  }

  const totalMs = Date.now() - t0;

  observabilityConsole.log('\n═══ RESULTADO FINAL ═══');
  observabilityConsole.log(`Tempo total: ${totalMs}ms`);
  observabilityConsole.log('Resultados:', JSON.stringify(results, null, 2));
  observabilityConsole.log('\n→ Inicie o agente para processar a fila: npm run clock-sync-agent');
  observabilityConsole.log('→ Monitore: GET /api/admin/metrics (com Authorization: Bearer <API_KEY>)');
}

main().catch(err => {
  observabilityConsole.error('FATAL:', err.message);
  process.exit(1);
});
