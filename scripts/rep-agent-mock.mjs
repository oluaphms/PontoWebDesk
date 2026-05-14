#!/usr/bin/env node
/**
 * Mock local para testar o rep-agent.mjs sem relógio físico e sem o SaaS deployado.
 *
 * Sobe DOIS servidores HTTP locais:
 *   - Mock relógio (default http://127.0.0.1:8181)
 *       • POST qualquer rota → responde { error: "Invalid command: none", code: 400 }
 *         (simula o comportamento real do dispositivo Control iD em modo AFD).
 *       • GET  /afd ...     → responde AFD em texto puro (formato NSR12+DATA8+HORA4+PIS11).
 *   - Mock SaaS    (default http://127.0.0.1:8282)
 *       • POST /api/rep/punch → registra o body recebido e responde { success: true }.
 *
 * Uso:
 *   node scripts/rep-agent-mock.mjs
 *
 * Variáveis opcionais:
 *   MOCK_CLOCK_PORT       (default 8181)
 *   MOCK_SAAS_PORT        (default 8282)
 *   MOCK_AFD_FILE         caminho para arquivo AFD customizado (substitui o default)
 *   MOCK_AFD_404          se "1", o relógio responde 404 em todas as rotas AFD
 *                         (use para testar o fallback MANUAL_IMPORT_REQUIRED)
 *   MOCK_SAAS_DUPLICATE   se "1", o SaaS responde com { success: false, duplicate: true }
 *
 * Encerre com Ctrl+C.
 */

import http from 'node:http';
import { promises as fs } from 'node:fs';

const CLOCK_PORT = parseInt(process.env.MOCK_CLOCK_PORT || '8181', 10);
const SAAS_PORT = parseInt(process.env.MOCK_SAAS_PORT || '8282', 10);
const AFD_404 = /^(1|true|yes)$/i.test(String(process.env.MOCK_AFD_404 || ''));
const SAAS_DUPLICATE = /^(1|true|yes)$/i.test(String(process.env.MOCK_SAAS_DUPLICATE || ''));

const DEFAULT_AFD = [
  // NSR(12) + DATA(8) + HORA(4) + PIS(11) — 35 chars/linha
  '00000012345620260513080012345678901',
  '00000012345720260513120012345678901',
  '00000012345820260513130012345678901',
  '00000012345920260513170099988877766',
  '00000012346020260513180099988877766',
].join('\n') + '\n';

let afdContent = DEFAULT_AFD;
if (process.env.MOCK_AFD_FILE) {
  try {
    afdContent = await fs.readFile(process.env.MOCK_AFD_FILE, 'utf8');
    console.log(`[mock-clock] AFD carregado de ${process.env.MOCK_AFD_FILE} (${afdContent.length} bytes)`);
  } catch (e) {
    console.error(`[mock-clock] falha ao ler ${process.env.MOCK_AFD_FILE}: ${e?.message || e}`);
    process.exit(1);
  }
}

const AFD_PATHS = new Set([
  '/afd',
  '/rep/afd',
  '/download/afd',
  '/api/afd',
  '/files/afd',
  '/get_afd',
]);

const clock = http.createServer((req, res) => {
  const url = req.url || '/';
  console.log(`[mock-clock] ${req.method} ${url}`);

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid command: none', code: 400 }));
    });
    return;
  }

  if (req.method === 'GET' && AFD_PATHS.has(url.split('?')[0])) {
    if (AFD_404) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(afdContent);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

const received = [];
const saas = http.createServer((req, res) => {
  const url = req.url || '/';

  if (req.method === 'POST' && url === '/api/rep/punch') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let payload = null;
      try { payload = JSON.parse(body); } catch { /* noop */ }
      received.push(payload);
      console.log('[mock-saas] punch recebido:', payload);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (SAAS_DUPLICATE) {
        res.end(JSON.stringify({ success: false, duplicate: true }));
      } else {
        res.end(JSON.stringify({ success: true, id: `mock-${received.length}` }));
      }
    });
    return;
  }

  if (req.method === 'GET' && url === '/__received') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: received.length, punches: received }, null, 2));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

clock.listen(CLOCK_PORT, '127.0.0.1', () => {
  console.log(
    `[mock-clock] escutando em http://127.0.0.1:${CLOCK_PORT}` +
      (AFD_404 ? ' (modo MOCK_AFD_404 ligado — todas as rotas AFD respondem 404)' : '')
  );
});

saas.listen(SAAS_PORT, '127.0.0.1', () => {
  console.log(
    `[mock-saas]  escutando em http://127.0.0.1:${SAAS_PORT}` +
      (SAAS_DUPLICATE ? ' (modo MOCK_SAAS_DUPLICATE ligado — respostas sempre duplicate)' : '')
  );
  console.log('[mock] inspecione punches recebidos em GET /__received');
});

const shutdown = () => {
  console.log('\n[mock] shutdown.');
  try { clock.close(); } catch { /* noop */ }
  try { saas.close(); } catch { /* noop */ }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
