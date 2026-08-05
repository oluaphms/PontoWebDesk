/**
 * Diagnóstico somente leitura do gate comercial (sem alterar regras).
 */
import '../src/loadEnv.js';
import { readCompanySessionGate } from '../src/master/commercial/companySessionRevocation.js';
import { pool } from '../src/db/index.js';

const companyId = process.argv[2] || 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b';

console.log('### CALLING readCompanySessionGate ###', companyId);
try {
  const gate = await readCompanySessionGate(companyId);
  console.log('### GATE_RESULT ###', JSON.stringify(gate, null, 2));
} catch (error) {
  console.log('### GATE_THREW ###', {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
    code: (error as { code?: unknown })?.code ?? null,
    cause:
      error instanceof Error && error.cause
        ? error.cause instanceof Error
          ? { message: error.cause.message, code: (error.cause as { code?: unknown }).code }
          : String(error.cause)
        : null,
  });
}
await pool.end();
