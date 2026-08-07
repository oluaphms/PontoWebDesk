import { describe, expect, it } from 'vitest';
import { RuntimeValidator } from '../src/RuntimeValidator.ts';
import { createTempLayout } from './helpers/tempLayout.js';

describe('RuntimeValidator', () => {
  it('PASS layout mínimo válido (sem DB check)', async () => {
    const { paths, cleanup } = createTempLayout();
    try {
      const v = await new RuntimeValidator(paths, { checkDatabase: false }).validate();
      expect(v.ok).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('FAIL sem backend entry', async () => {
    const { paths, cleanup } = createTempLayout({ withBackend: false });
    try {
      const v = await new RuntimeValidator(paths, { checkDatabase: false }).validate();
      expect(v.ok).toBe(false);
      expect(v.errors.some((e) => e.code === 'BACKEND_ENTRY_MISSING')).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('FAIL sem backend.env', async () => {
    const { paths, cleanup } = createTempLayout({ withEnv: false });
    try {
      const v = await new RuntimeValidator(paths, { checkDatabase: false }).validate();
      expect(v.errors.some((e) => e.code === 'BACKEND_ENV_MISSING')).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('WARNING storage ausente', async () => {
    const { paths, cleanup } = createTempLayout({ withStorage: false });
    try {
      const v = await new RuntimeValidator(paths, { checkDatabase: false }).validate();
      expect(v.warnings.some((w) => w.code === 'STORAGE_DIR_MISSING')).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('FAIL database unreachable quando check ativo', async () => {
    const { paths, cleanup } = createTempLayout({
      envContent: `PGHOST=127.0.0.1
PGPORT=1
PGDATABASE=pontowebdesk
DATABASE_URL=postgresql://u:p@127.0.0.1:1/pontowebdesk
`,
    });
    try {
      const v = await new RuntimeValidator(paths, { checkDatabase: true, databaseTimeoutMs: 200 }).validate();
      expect(v.errors.some((e) => e.code === 'DATABASE_UNREACHABLE')).toBe(true);
    } finally {
      cleanup();
    }
  });
});
