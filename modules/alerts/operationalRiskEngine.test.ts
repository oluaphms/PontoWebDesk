import { describe, expect, it } from 'vitest';
import { evaluateCompanyRisk } from './operationalRiskEngine';

describe('evaluateCompanyRisk', () => {
  it('critical quando existe alerta critical', () => {
    const r = evaluateCompanyRisk({
      alerts: [{ severity: 'critical' }, { severity: 'high' }],
      sla: null,
    });
    expect(r.risk).toBe('critical');
    expect(r.critical).toBe(1);
  });

  it('high quando high > limiar do SLA', () => {
    const r = evaluateCompanyRisk({
      alerts: [
        { severity: 'high' },
        { severity: 'high' },
        { severity: 'high' },
        { severity: 'high' },
      ],
      sla: { max_inconsistencies: 3 },
    });
    expect(r.risk).toBe('high');
    expect(r.high).toBe(4);
  });

  it('medium quando volume total > 5 sem critical nem high excessivo', () => {
    const alerts = Array.from({ length: 6 }, () => ({ severity: 'low' }));
    const r = evaluateCompanyRisk({ alerts, sla: null });
    expect(r.risk).toBe('medium');
  });

  it('ok sem alertas', () => {
    const r = evaluateCompanyRisk({ alerts: [], sla: null });
    expect(r.risk).toBe('ok');
    expect(r.total_alerts).toBe(0);
  });
});
