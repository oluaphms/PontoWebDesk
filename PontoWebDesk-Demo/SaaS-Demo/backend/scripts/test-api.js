import { observabilityConsole } from '../../services/observabilityConsole.js';
/* eslint-disable no-console */
const base = process.env.API_BASE_URL || 'http://localhost:3000';
const identifier = process.env.TEST_LOGIN || 'admin@local.test';
const password = process.env.TEST_PASSWORD || '123456';

async function run() {
  const loginPath = process.env.TEST_LOGIN_PATH || '/api/auth/login';
  const loginRes = await fetch(`${base}${loginPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password, email: identifier }),
  });
  const loginData = await loginRes.json().catch(() => ({}));
  observabilityConsole.log('[test-api] login:', loginRes.status, loginData);

  const token = loginData?.token;
  const headers = {
    Authorization: token ? `Bearer ${token}` : '',
    'Content-Type': 'application/json',
  };

  // Só `type` — user_id e company_id vêm do JWT
  const punchRes = await fetch(`${base}/api/punches`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 'entrada',
      punch_hash: `test-${Date.now()}`,
    }),
  });
  observabilityConsole.log('[test-api] punch:', punchRes.status, await punchRes.json().catch(() => ({})));

  const batchRes = await fetch(`${base}/api/punches/batch`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      punches: Array.from({ length: 2 }).map((_, i) => ({
        client_id: `c-${Date.now()}-${i}`,
        type: i % 2 === 0 ? 'entrada' : 'saida',
        punch_hash: `batch-${Date.now()}-${i}`,
      })),
    }),
  });
  observabilityConsole.log('[test-api] batch:', batchRes.status, await batchRes.json().catch(() => ({})));
}

run().catch((err) => {
  observabilityConsole.error('[test-api] fatal', err);
  process.exit(1);
});

