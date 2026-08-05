import { describe, expect, it } from 'vitest';
import { compareSemver, isValidSemver, parseSemver } from './semver.js';

describe('Master update SemVer', () => {
  it('aceita versões SemVer estritas', () => {
    expect(isValidSemver('1.2.3')).toBe(true);
    expect(isValidSemver('2.0.0-beta.1')).toBe(true);
    expect(parseSemver('rep-agent.mjs')).toBeNull();
    expect(isValidSemver('2026-07-18T20:00:00Z')).toBe(false);
  });

  it('compara versões estáveis', () => {
    expect(compareSemver('1.9.9', '2.0.0')).toBeLessThan(0);
    expect(compareSemver('2.1.0', '2.0.9')).toBeGreaterThan(0);
    expect(compareSemver('2.1.0', '2.1.0')).toBe(0);
  });

  it('considera prerelease anterior à versão estável', () => {
    expect(compareSemver('2.0.0-beta.1', '2.0.0')).toBeLessThan(0);
    expect(compareSemver('2.0.0-beta.2', '2.0.0-beta.1')).toBeGreaterThan(0);
  });

  it('não classifica versões inválidas', () => {
    expect(compareSemver('unknown', '2.0.0')).toBeNull();
    expect(compareSemver('1.0.0', 'rep-agent.mjs')).toBeNull();
  });
});

