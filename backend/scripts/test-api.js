/* eslint-disable no-console */
const base = process.env.API_BASE_URL || 'http://localhost:3000';
const identifier = process.env.TEST_LOGIN || 'admin@local.test';
const password = process.env.TEST_PASSWORD || '123456';

async function run() {
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  const loginData = await loginRes.json().catch(() => ({}));
  console.log('[test-api] login:', loginRes.status, loginData);

  const token = loginData?.token;
  const headers = {
    Authorization: token ? `Bearer ${token}` : '',
    'Content-Type': 'application/json',
  };

  const punchRes = await fetch(`${base}/api/punches`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      company_id: 'demo-company',
      user_id: 'demo-user',
      type: 'entrada',
      timestamp: new Date().toISOString(),
      punch_hash: `test-${Date.now()}`,
    }),
  });
  console.log('[test-api] punch:', punchRes.status, await punchRes.json().catch(() => ({})));

  const batchRes = await fetch(`${base}/api/punches/batch`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      punches: Array.from({ length: 2 }).map((_, i) => ({
        client_id: `c-${Date.now()}-${i}`,
        company_id: 'demo-company',
        user_id: 'demo-user',
        type: i % 2 === 0 ? 'entrada' : 'saida',
        timestamp: new Date().toISOString(),
        punch_hash: `batch-${Date.now()}-${i}`,
      })),
    }),
  });
  console.log('[test-api] batch:', batchRes.status, await batchRes.json().catch(() => ({})));
}

run().catch((err) => {
  console.error('[test-api] fatal', err);
  process.exit(1);
});

