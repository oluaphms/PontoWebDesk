// @vitest-environment node
/** Compat: redireciona para masterAuth.test.ts — arquivo legado Fase 19. */
import { describe, expect, it } from 'vitest';
import { requireMasterAuth, requireMasterRole } from './requireMasterRole.js';

describe('requireMasterRole reexports', () => {
  it('exporta requireMasterAuth e requireMasterRole', () => {
    expect(typeof requireMasterAuth).toBe('function');
    expect(typeof requireMasterRole).toBe('function');
  });
});
