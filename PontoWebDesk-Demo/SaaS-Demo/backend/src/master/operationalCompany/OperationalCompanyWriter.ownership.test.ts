// @vitest-environment node
/**
 * Garante ownership: SQL de escrita em public.companies só no writer canônico.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = fileURLToPath(new URL('../..', import.meta.url)); // backend/src
const WRITER_REL = join('master', 'operationalCompany', 'OperationalCompanyWriter.ts');

const WRITE_PATTERNS = [
  /(?:`|'|" )\s*insert\s+into\s+public\.companies/i,
  /`[^`]*insert\s+into\s+public\.companies/i,
  /`[^`]*update\s+public\.companies/i,
  /`[^`]*UPDATE\s+public\.companies/i,
  /`[^`]*delete\s+from\s+public\.companies/i,
];

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkTsFiles(full, out);
      continue;
    }
    if (!name.endsWith('.ts')) continue;
    if (name.endsWith('.test.ts') || name.endsWith('.spec.ts')) continue;
    out.push(full);
  }
  return out;
}

describe('OperationalCompanyWriter ownership', () => {
  it('é a única porta de escrita SQL em public.companies no src/', () => {
    const files = walkTsFiles(SRC_ROOT);
    const offenders: Array<{ file: string; match: string }> = [];

    for (const file of files) {
      const rel = relative(SRC_ROOT, file).replace(/\\/g, '/');
      if (rel === WRITER_REL.replace(/\\/g, '/')) continue;
      const text = readFileSync(file, 'utf8');
      // Apenas template literals SQL (crase) — ignora strings de log/diagnóstico.
      const sqlChunks = text.match(/`[^`]*`/gs) ?? [];
      for (const chunk of sqlChunks) {
        for (const re of [
          /insert\s+into\s+public\.companies/i,
          /update\s+public\.companies/i,
          /delete\s+from\s+public\.companies/i,
        ]) {
          const m = chunk.match(re);
          if (m) offenders.push({ file: rel, match: m[0] });
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
