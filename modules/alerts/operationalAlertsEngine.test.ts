import { describe, expect, it } from 'vitest';
import { calculateWorkedHours, generateOperationalAlerts } from './operationalAlertsEngine';

describe('calculateWorkedHours', () => {
  it('soma blocos entrada→saída', () => {
    const h = calculateWorkedHours([
      { timestamp: '2026-05-06T12:00:00.000Z', type: 'entrada' },
      { timestamp: '2026-05-06T14:00:00.000Z', type: 'saída' },
    ]);
    expect(h).toBe(2);
  });
});

describe('generateOperationalAlerts', () => {
  const day = '2026-05-06';

  it('REP pendente gera rep_pending_stale', () => {
    const alerts = generateOperationalAlerts({
      records: [],
      repPending: [{ data_hora: '2026-05-06T12:00:00.000Z' }],
      status: 'ok',
      date: day,
    });
    expect(alerts.some((a) => a.type === 'rep_pending_stale')).toBe(true);
  });

  it('status inconsistent gera inconsistency critical', () => {
    const alerts = generateOperationalAlerts({
      records: [],
      repPending: [],
      status: 'inconsistent',
      date: day,
    });
    const inc = alerts.find((a) => a.type === 'inconsistency');
    expect(inc?.severity).toBe('critical');
  });

  it('sem saída final gera missing_exit', () => {
    const alerts = generateOperationalAlerts({
      records: [{ timestamp: '2026-05-06T12:00:00.000Z', type: 'entrada' }],
      repPending: [],
      status: 'ok',
      date: day,
    });
    expect(alerts.some((a) => a.type === 'missing_exit')).toBe(true);
  });
});
