import '../src/loadEnv.js';
import jwt from 'jsonwebtoken';
import { pool } from '../src/db/index.js';
import { authenticateLogin } from '../src/services/authLoginService.js';
import { readCompanySessionGate } from '../src/master/commercial/companySessionRevocation.js';
import { ensureCommercialValidityForOperationalCompany } from '../src/master/commercial/CommercialProjectionService.js';
import { isTokenRevoked } from '../src/services/tokenRevocationService.js';

const companyId = 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b';
const email = process.env.DIAG_EMAIL || 'oluaphms@gmail.com';
const password = process.env.DIAG_PASSWORD || '';

async function main(): Promise<void> {
  console.log('=== BEFORE ensure ===');
  const before = await readCompanySessionGate(companyId);
  console.log(before);

  console.log('=== ensureCommercialValidity ===');
  const snap = await ensureCommercialValidityForOperationalCompany(companyId);
  console.log({
    commercialBlocked: snap?.commercialBlocked,
    reason: snap?.commercialBlockReason,
    licenseStatus: snap?.licenseStatus,
    subscriptionStatus: snap?.subscriptionStatus,
  });

  console.log('=== AFTER ensure ===');
  const after = await readCompanySessionGate(companyId);
  console.log(after);

  if (!password) {
    console.log('Set DIAG_PASSWORD to run live login simulation');
    await pool.end();
    return;
  }

  const result = await authenticateLogin({ identifier: email, password });
  if ('status' in result) {
    console.log('LOGIN FAILED', result);
    await pool.end();
    return;
  }

  const secret = String(process.env.JWT_SECRET || '').trim();
  const decoded = jwt.verify(result.token, secret) as {
    jti?: string;
    companySessionVersion?: number;
    companyId?: string;
    sub?: string;
  };
  console.log('=== JWT claims ===', {
    jti: decoded.jti,
    companySessionVersion: decoded.companySessionVersion,
    companyId: decoded.companyId,
    sub: decoded.sub,
  });

  const gate = await readCompanySessionGate(companyId);
  const tokenVersion =
    decoded.companySessionVersion == null ? 0 : Number(decoded.companySessionVersion);
  const jtiRevoked = await isTokenRevoked(decoded.jti);
  console.log('=== POST-LOGIN GATE CHECK ===', {
    gate,
    tokenVersion,
    versionRevoked: tokenVersion < (gate?.companySessionVersion ?? 0),
    jtiRevoked,
    commercialBlocked: gate?.commercialBlocked,
  });

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
