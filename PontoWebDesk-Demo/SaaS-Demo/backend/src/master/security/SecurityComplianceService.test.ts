// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildSecurityComplianceSnapshot } from './SecurityComplianceService.js';

describe('SecurityComplianceService', () => {
  it('retorna checklist completo com status honestos', async () => {
    const snapshot = await buildSecurityComplianceSnapshot();
    expect(snapshot.items).toHaveLength(10);
    expect(snapshot.items.map((item) => item.id)).toEqual([
      'pentest',
      'owasp',
      'lgpd',
      'encryption',
      'backup',
      'restore',
      'audit',
      'rate_limit',
      'session_rotation',
      'mfa',
    ]);
    expect(['A', 'B', 'C', 'D']).toContain(snapshot.grade);
    expect(snapshot.score.total).toBe(10);
    const mfa = snapshot.items.find((item) => item.id === 'mfa');
    expect(mfa?.status === 'optional' || mfa?.status === 'partial').toBe(true);
    const session = snapshot.items.find((item) => item.id === 'session_rotation');
    expect(session?.status).toBe('ok');
  });
});
