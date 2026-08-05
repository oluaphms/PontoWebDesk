import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRegisteredSecret } from '../src/security/secrets/secretRegistry.js';
import { rotateManagedSecret } from '../src/security/secrets/secretProvider.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const name = String(process.env.SECRET_NAME || process.argv[2] || '').trim();
if (!name) {
  process.stderr.write('[rotate-secret] Informe SECRET_NAME ou argumento.\n');
  process.exit(1);
}

try {
  assertRegisteredSecret(name);
  const result = await rotateManagedSecret(name);
  process.stdout.write(JSON.stringify({ ok: true, secret: name, provider: result.provider, rotated: true }) + '\n');
} catch (error) {
  process.stderr.write(`[rotate-secret] Falhou: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
