import { describe, expect, it } from 'vitest';
import { parsePostgresVersionLine } from './PostgresDiscovery.js';

describe('parsePostgresVersionLine', () => {
  it('interpreta postgres (PostgreSQL) 16.8', () => {
    const p = parsePostgresVersionLine('postgres (PostgreSQL) 16.8');
    expect(p).toEqual({ major: 16, minor: 8, patch: 0, versionFull: '16.8' });
  });

  it('rejeita formato antigo sem parenteses', () => {
    expect(parsePostgresVersionLine('PostgreSQL 16.8')).toBeNull();
  });
});
