import '../src/loadEnv.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../src/db/index.js';

const email = 'oluaphms@gmail.com';
const password = 'TestLogin123!';
const companyId = 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b';
const userId = 'dc1c2aad-302e-448b-aa63-8f890d25c95e';

async function main(): Promise<void> {
  const hash = await bcrypt.hash(password, 10);
  await pool.queryTrustedBootstrap(
    `update public.users set password_hash = $1 where id::text = $2`,
    [hash, userId],
  );
  console.log('password_updated');

  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email, password }),
  });
  const loginBody = (await loginRes.json()) as Record<string, unknown>;
  const token = String(loginBody.token || '');
  let claims: Record<string, unknown> | null = null;
  if (token) {
    claims = jwt.decode(token) as Record<string, unknown>;
  }

  const usersUrl =
    'http://localhost:3000/api/data/users?filters=' +
    encodeURIComponent(
      JSON.stringify([
        { column: 'company_id', operator: 'eq', value: companyId },
        { column: 'id', operator: 'eq', value: userId },
      ]),
    ) +
    '&columns=id%2Cemail&limit=1';

  const usersRes = await fetch(usersUrl, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const usersBody = await usersRes.json();

  const meRes = await fetch('http://localhost:3000/api/auth/me', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const meBody = await meRes.json();

  console.log(
    JSON.stringify(
      {
        loginStatus: loginRes.status,
        loginOk: loginBody.ok,
        hasToken: Boolean(token),
        claims: claims
          ? {
              sub: claims.sub,
              companyId: claims.companyId,
              role: claims.role,
              companySessionVersion: claims.companySessionVersion,
              jti: claims.jti,
            }
          : null,
        usersStatus: usersRes.status,
        usersBody,
        meStatus: meRes.status,
        meOk: (meBody as { ok?: boolean }).ok,
      },
      null,
      2,
    ),
  );

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
